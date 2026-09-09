package widgets

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

const weatherForecastFixture = `{
	"current":{"temperature_2m":0,"weather_code":0,"wind_speed_10m":0},
	"daily":{"time":["2026-09-08"],"weather_code":[3],"temperature_2m_max":[21.5],"temperature_2m_min":[12.4]}
}`

const weatherGeoFixture = `{"results":[{"id":1,"name":"Madison","latitude":43.07,"longitude":-89.4,"admin1":"Wisconsin","country":"United States","country_code":"US","population":269840}]}`

type weatherTestTransport func(*http.Request) (*http.Response, error)

func (f weatherTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func weatherTestResponse(body string) (*http.Response, error) {
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
}

func setupWeatherTest(t *testing.T, transport weatherTestTransport) {
	t.Helper()
	client, weather, locations, search := DefaultClient, weatherTTLCache, weatherLocationCache, citySearchCache
	DefaultClient = &http.Client{Transport: transport}
	weatherTTLCache, weatherLocationCache, citySearchCache = newWeatherCache(), newWeatherLocationCache(), newCitySearchCache()
	t.Cleanup(func() {
		DefaultClient, weatherTTLCache, weatherLocationCache, citySearchCache = client, weather, locations, search
	})
}

func TestWeatherCityOnlyCachesLocationWithoutTimezone(t *testing.T) {
	var geocoding, forecast atomic.Int32
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		switch req.URL.Host {
		case "geocoding-api.open-meteo.com":
			geocoding.Add(1)
			if req.URL.Query().Get("name") != "Madison" {
				t.Errorf("unexpected city lookup: %s", req.URL)
			}
			return weatherTestResponse(weatherGeoFixture)
		case "api.open-meteo.com":
			forecast.Add(1)
			if req.URL.Query().Get("current") != "temperature_2m,weather_code,wind_speed_10m" {
				t.Errorf("weather unexpectedly requested timezone enrichment: %s", req.URL)
			}
			if req.URL.Query().Get("latitude") != "43.07" || req.URL.Query().Get("longitude") != "-89.4" {
				t.Errorf("wrong weather coordinates: %s", req.URL)
			}
			return weatherTestResponse(weatherForecastFixture)
		default:
			return nil, errors.New("unexpected upstream")
		}
	})
	for range 2 {
		w, err := FetchWeatherForCity(context.Background(), "Madison, Wisconsin, United States", "en")
		if err != nil {
			t.Fatal(err)
		}
		if w.Temperature != 0 || w.WeatherCode != 0 || w.WindSpeed != 0 || len(w.Daily) != 1 ||
			w.Daily[0].TempMaxC != 21.5 || w.FetchedAt == 0 || w.Stale || w.Warning != "" {
			t.Fatalf("valid upstream values/status changed: %+v", w)
		}
		if w.Source != "Open-Meteo" || w.SourceURL != "https://open-meteo.com/" {
			t.Fatalf("missing attribution: %+v", w)
		}
	}
	if geocoding.Load() != 1 || forecast.Load() != 1 {
		t.Fatalf("cache missed: geocoding=%d forecast=%d", geocoding.Load(), forecast.Load())
	}
}

func TestWeatherLocationKeepsCityDisambiguation(t *testing.T) {
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		return weatherTestResponse(`{"results":[
			{"id":1,"name":"Springfield","latitude":42.1,"longitude":-72.6,"admin1":"Massachusetts","country":"United States","population":200000},
			{"id":2,"name":"Springfield","latitude":39.8,"longitude":-89.6,"admin1":"Illinois","country":"United States","population":100000}
		]}`)
	})
	point, _, err := ResolveWeatherLocation(context.Background(), "Springfield, Illinois, United States", "en")
	if err != nil || point.Lat != 39.8 || !strings.Contains(point.DisplayName, "Illinois") {
		t.Fatalf("selected wrong same-named city: %+v, %v", point, err)
	}
}

func TestWeatherLocationFallbackKeepsFullQuery(t *testing.T) {
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "geocoding-api.open-meteo.com" {
			return nil, errors.New("primary unavailable")
		}
		if req.URL.Host != "nominatim.openstreetmap.org" || req.URL.Query().Get("q") != "Cambridge, Massachusetts, United States" {
			t.Errorf("lost disambiguation or requested timezone: %s", req.URL)
		}
		return weatherTestResponse(`[{"place_id":1,"lat":"42.37","lon":"-71.1","name":"Cambridge","address":{"state":"Massachusetts","country":"United States"}}]`)
	})
	point, _, err := ResolveWeatherLocation(context.Background(), "Cambridge, Massachusetts, United States", "en")
	if err != nil || point.Lat != 42.37 {
		t.Fatalf("fallback failed: %+v, %v", point, err)
	}
}

func TestWeatherColdLookupPreservesNetworkErrors(t *testing.T) {
	outage := errors.New("upstream network offline")
	var calls atomic.Int32
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, outage
	})
	_, err := FetchWeatherForCity(context.Background(), "Madison", "en")
	if err == nil || !errors.Is(err, outage) || strings.Contains(err.Error(), "city not found") {
		t.Fatalf("network failure became no match: %v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected one request per provider, got %d", calls.Load())
	}
	_, err = SearchCitiesOpenMeteo(context.Background(), "长春", 8, "zh")
	if err == nil || !errors.Is(err, outage) || strings.Contains(err.Error(), "city not found") {
		t.Fatalf("multilingual errors were swallowed: %v", err)
	}
}

func TestWeatherCityNotFoundRequiresSuccessfulEmptyResponses(t *testing.T) {
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "nominatim.openstreetmap.org" {
			return weatherTestResponse(`[]`)
		}
		return weatherTestResponse(`{"results":[]}`)
	})
	_, _, err := ResolveWeatherLocation(context.Background(), "Nowhere", "en")
	if !errors.Is(err, ErrCityNotFound) {
		t.Fatalf("expected genuine not found: %v", err)
	}
}

func TestWeatherForcedRetryColdLocationFailure(t *testing.T) {
	var online atomic.Bool
	var locationCalls atomic.Int32
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "api.open-meteo.com" {
			locationCalls.Add(1)
		}
		if !online.Load() {
			return nil, errors.New("network offline")
		}
		if req.URL.Host == "geocoding-api.open-meteo.com" {
			return weatherTestResponse(weatherGeoFixture)
		}
		return weatherTestResponse(weatherForecastFixture)
	})
	if _, err := FetchWeatherForCity(context.Background(), "Madison", "en"); err == nil {
		t.Fatal("expected cold lookup error")
	}
	online.Store(true)
	for range 2 {
		if _, err := FetchWeatherForCity(context.Background(), "Madison", "en", true); err != nil {
			t.Fatalf("manual refresh did not retry failed location: %v", err)
		}
	}
	if locationCalls.Load() != 3 {
		t.Fatalf("manual weather refresh re-resolved usable location: %d location calls", locationCalls.Load())
	}
}

func TestWeatherAndLocationStaleFastPathCoalescesRefresh(t *testing.T) {
	started := make(chan string, 2)
	release := make(chan struct{})
	var calls atomic.Int32
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		started <- req.URL.Host
		<-release
		if req.URL.Host == "geocoding-api.open-meteo.com" {
			return weatherTestResponse(weatherGeoFixture)
		}
		return weatherTestResponse(weatherForecastFixture)
	})
	weatherTTLCache = cache.New[Weather](time.Nanosecond)
	weatherLocationCache = cache.New[GeoPoint](time.Nanosecond)
	city := "Madison, Wisconsin, United States"
	key := weatherLocationKey(city, "en")
	weatherLocationCache.Set(key, GeoPoint{Lat: 43.07, Lon: -89.4, DisplayName: city})
	weatherTTLCache.Set("43.07,-89.4", Weather{City: city, Temperature: 17, FetchedAt: 123})
	start := time.Now()
	for range 10 {
		w, err := FetchWeatherForCity(context.Background(), city, "en")
		if err != nil || !w.Stale || !w.Refreshing || w.Temperature != 17 || w.FetchedAt != 123 {
			close(release)
			t.Fatalf("stale data not served: %+v, %v", w, err)
		}
	}
	if time.Since(start) > 500*time.Millisecond {
		close(release)
		t.Fatal("stale weather waited on the upstream")
	}
	for range 2 {
		select {
		case <-started:
		case <-time.After(time.Second):
			close(release)
			t.Fatal("background refresh did not start")
		}
	}
	// Join the existing flights before restoring package globals.
	type refreshResult struct{ err error }
	joined := make(chan refreshResult, 2)
	go func() {
		_, _, err := weatherTTLCache.Load(context.Background(), "43.07,-89.4", func(context.Context) (Weather, error) {
			return Weather{}, errors.New("unexpected duplicate weather refresh")
		}, true)
		joined <- refreshResult{err}
	}()
	go func() {
		_, _, err := weatherLocationCache.Load(context.Background(), key, func(context.Context) (GeoPoint, error) {
			return GeoPoint{}, errors.New("unexpected duplicate location refresh")
		}, true)
		joined <- refreshResult{err}
	}()
	close(release)
	for range 2 {
		if result := <-joined; result.err != nil {
			t.Fatal(result.err)
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("expected two coalesced refreshes, got %d", calls.Load())
	}
	w, ok := weatherTTLCache.GetStale("43.07,-89.4")
	if !ok || w.Temperature != 0 || w.FetchedAt == 123 {
		t.Fatalf("successful refresh did not replace old data: %+v", w)
	}
}

func TestWeatherForcedFailureRetainsValuesAndWarning(t *testing.T) {
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		return nil, errors.New("weather provider offline")
	})
	weatherTTLCache.Set("43.07,-89.4", Weather{Temperature: 17, FetchedAt: 123})
	w, err := FetchOpenMeteo(context.Background(), "43.07000", "-89.4000", "Madison", true)
	if err != nil || w.Temperature != 17 || w.FetchedAt != 123 ||
		!strings.Contains(w.Warning, "weather provider offline") || w.Refreshing {
		t.Fatalf("failed refresh lost usable values/status: %+v, %v", w, err)
	}
	_, err = FetchOpenMeteo(context.Background(), "1", "2", "Cold")
	if err == nil || !strings.Contains(err.Error(), "weather provider offline") {
		t.Fatalf("cold weather error hidden: %v", err)
	}
}

func TestWeatherStaleLocationFailureRetainsCoordinatesAndWarning(t *testing.T) {
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		t.Errorf("stale location or fresh weather waited on another upstream request: %s", req.URL)
		return nil, errors.New("unexpected upstream request")
	})
	weatherLocationCache = cache.New[GeoPoint](time.Nanosecond)
	city := "Madison"
	key := weatherLocationKey(city, "en")
	weatherLocationCache.Set(key, GeoPoint{Lat: 43.07, Lon: -89.4, DisplayName: city})
	weatherTTLCache.Set("43.07,-89.4", Weather{Temperature: 17, FetchedAt: 123})
	_, _, err := weatherLocationCache.Load(context.Background(), key, func(context.Context) (GeoPoint, error) {
		return GeoPoint{}, errors.New("geocoding offline")
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	w, err := FetchWeatherForCity(context.Background(), city, "en")
	if err != nil || !w.Stale || w.Refreshing || w.Temperature != 17 || w.FetchedAt != 123 ||
		!strings.Contains(w.Warning, "location: geocoding offline") {
		t.Fatalf("location failure lost usable weather or warning: %+v, %v", w, err)
	}
}

func TestWeatherColdLoadsAreBounded(t *testing.T) {
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		<-req.Context().Done()
		return nil, req.Context().Err()
	})
	weatherLocationCache.SetLoadTimeout(20 * time.Millisecond)
	weatherTTLCache.SetLoadTimeout(20 * time.Millisecond)
	start := time.Now()
	_, _, err := ResolveWeatherLocation(context.Background(), "Slow City", "en")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("location deadline not preserved: %v", err)
	}
	_, err = FetchOpenMeteo(context.Background(), "1", "2", "Slow City")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("weather deadline not preserved: %v", err)
	}
	if time.Since(start) > 500*time.Millisecond {
		t.Fatal("cold loads exceeded configured bounds")
	}
}

func TestWeatherRejectsMissingUpstreamValues(t *testing.T) {
	bodies := []string{
		`{}`,
		`{"current":null}`,
		`{"current":{"temperature_2m":null,"weather_code":0,"wind_speed_10m":0}}`,
		`{"current":{"temperature_2m":0,"weather_code":0,"wind_speed_10m":0},"daily":{"time":["2026-09-08"],"weather_code":[],"temperature_2m_max":[12],"temperature_2m_min":[1]}}`,
		`{"current":{"temperature_2m":0,"weather_code":0,"wind_speed_10m":0},"daily":{"time":["2026-09-08"],"weather_code":[null],"temperature_2m_max":[12],"temperature_2m_min":[1]}}`,
	}
	for _, body := range bodies {
		t.Run(body, func(t *testing.T) {
			setupWeatherTest(t, func(req *http.Request) (*http.Response, error) { return weatherTestResponse(body) })
			if _, err := FetchOpenMeteo(context.Background(), "1", "2", "Invalid"); err == nil {
				t.Fatal("accepted fabricated zero/missing weather")
			}
			if _, ok := weatherTTLCache.GetStale("1,2"); ok {
				t.Fatal("invalid weather was cached")
			}
		})
	}
}

func TestWeatherRejectsInvalidCoordinates(t *testing.T) {
	for _, coords := range [][2]string{{"", "0"}, {"0", ""}, {"91", "0"}, {"0", "-181"}, {"NaN", "0"}, {"0", "Inf"}, {"abc", "1"}} {
		if _, _, err := ParseWeatherCoordinates(coords[0], coords[1]); err == nil {
			t.Errorf("accepted invalid coordinates %v", coords)
		}
	}
	for _, coords := range [][2]string{{"0", "0"}, {"-90", "-180"}, {"90", "180"}} {
		if _, _, err := ParseWeatherCoordinates(coords[0], coords[1]); err != nil {
			t.Errorf("rejected valid coordinates %v: %v", coords, err)
		}
	}
}

func TestWeatherPersistenceRestoresGoodWeatherAndLocation(t *testing.T) {
	var calls atomic.Int32
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		if req.URL.Host == "geocoding-api.open-meteo.com" {
			return weatherTestResponse(weatherGeoFixture)
		}
		return weatherTestResponse(weatherForecastFixture)
	})
	root := t.TempDir()
	if err := ConfigureWeatherPersistence(root); err != nil {
		t.Fatal(err)
	}
	first, err := FetchWeatherForCity(context.Background(), "Madison", "en")
	if err != nil {
		t.Fatal(err)
	}
	weatherTTLCache, weatherLocationCache, citySearchCache = newWeatherCache(), newWeatherLocationCache(), newCitySearchCache()
	if err := ConfigureWeatherPersistence(root); err != nil {
		t.Fatal(err)
	}
	restored, err := FetchWeatherForCity(context.Background(), "Madison", "en")
	if err != nil || calls.Load() != 2 || restored.FetchedAt != first.FetchedAt || restored.Temperature != first.Temperature {
		t.Fatalf("persistence did not avoid upstream: %+v, %v, requests=%d", restored, err, calls.Load())
	}
	for _, namespace := range []string{"weather", "weather-locations", "city-search"} {
		if _, err := os.Stat(filepath.Join(root, namespace)); err != nil {
			t.Fatal(err)
		}
	}
}
