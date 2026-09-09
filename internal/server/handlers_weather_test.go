package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/morezhou/hearth/internal/store"
	"github.com/morezhou/hearth/internal/widgets"
)

const handlerWeatherFixture = `{"current":{"temperature_2m":18.5,"weather_code":2,"wind_speed_10m":7.2},"daily":{"time":["2026-09-08"],"weather_code":[3],"temperature_2m_max":[20],"temperature_2m_min":[12]}}`

var handlerWeatherSequence atomic.Int64

type handlerWeatherTransport func(*http.Request) (*http.Response, error)

func (f handlerWeatherTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func handlerWeatherResponse(body string) (*http.Response, error) {
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
}

func newWeatherHandlerServer(t *testing.T) *Server {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	st := store.New(db)
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	return &Server{db: db, store: st}
}

func mockHandlerWeatherHTTP(t *testing.T, transport handlerWeatherTransport) {
	t.Helper()
	previous := widgets.DefaultClient
	widgets.DefaultClient = &http.Client{Transport: transport}
	t.Cleanup(func() { widgets.DefaultClient = previous })
}

func TestWeatherHandlerStoredCoordinatesBypassGeocoding(t *testing.T) {
	s := newWeatherHandlerServer(t)
	lat, lon := 31.2304, 121.4737
	if err := s.saveWeatherSettings(WeatherSettings{City: "Selected Shanghai", Lat: &lat, Lon: &lon}); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	mockHandlerWeatherHTTP(t, func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		if req.URL.Host != "api.open-meteo.com" || req.URL.Query().Get("latitude") != "31.2304" ||
			req.URL.Query().Get("longitude") != "121.4737" || req.URL.Query().Get("current") != "temperature_2m,weather_code,wind_speed_10m" {
			t.Errorf("stored coordinates not used directly: %s", req.URL)
		}
		return handlerWeatherResponse(handlerWeatherFixture)
	})
	for _, query := range []string{"refresh=1", "city=Selected+Shanghai&refresh=1"} {
		w := httptest.NewRecorder()
		s.handleGetWeather(w, httptest.NewRequest(http.MethodGet, "/api/widgets/weather?"+query, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("weather request failed: %d %s", w.Code, w.Body.String())
		}
		var weather widgets.Weather
		if err := json.Unmarshal(w.Body.Bytes(), &weather); err != nil || weather.City != "Selected Shanghai" || weather.Temperature != 18.5 {
			t.Fatalf("invalid weather response: %+v, %v", weather, err)
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("expected one forecast per forced request, got %d", calls.Load())
	}
}

func TestWeatherHandlerCityOnlySkipsTimezone(t *testing.T) {
	s := newWeatherHandlerServer(t)
	sequence := handlerWeatherSequence.Add(1)
	name := fmt.Sprintf("Handler Madison %d", sequence)
	city := name + ", Wisconsin, United States"
	lat := 43.071 + float64(sequence)/1000000
	if err := s.saveWeatherSettings(WeatherSettings{City: city}); err != nil {
		t.Fatal(err)
	}
	var geocoding, forecast atomic.Int32
	mockHandlerWeatherHTTP(t, func(req *http.Request) (*http.Response, error) {
		switch req.URL.Host {
		case "geocoding-api.open-meteo.com":
			geocoding.Add(1)
			body, _ := json.Marshal(map[string]any{"results": []map[string]any{{
				"id": 1, "name": name, "latitude": lat, "longitude": -89.401,
				"admin1": "Wisconsin", "country": "United States",
			}}})
			return handlerWeatherResponse(string(body))
		case "api.open-meteo.com":
			forecast.Add(1)
			if req.URL.Query().Get("current") != "temperature_2m,weather_code,wind_speed_10m" {
				t.Errorf("unexpected timezone enrichment: %s", req.URL)
			}
			return handlerWeatherResponse(handlerWeatherFixture)
		default:
			return nil, errors.New("unexpected provider")
		}
	})
	for range 2 {
		w := httptest.NewRecorder()
		s.handleGetWeather(w, httptest.NewRequest(http.MethodGet, "/api/widgets/weather?lang=en", nil))
		if w.Code != http.StatusOK {
			t.Fatalf("city-only request failed: %d %s", w.Code, w.Body.String())
		}
	}
	if geocoding.Load() != 1 || forecast.Load() != 1 {
		t.Fatalf("city-only cache missed: %d geocoding, %d forecast", geocoding.Load(), forecast.Load())
	}
}

func TestWeatherHandlerOtherCityDoesNotReuseSelectedCoordinates(t *testing.T) {
	s := newWeatherHandlerServer(t)
	lat, lon := 5.0, 6.0
	if err := s.saveWeatherSettings(WeatherSettings{City: "Stored City", Lat: &lat, Lon: &lon}); err != nil {
		t.Fatal(err)
	}
	mockHandlerWeatherHTTP(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "geocoding-api.open-meteo.com" {
			return handlerWeatherResponse(`{"results":[{"id":1,"name":"Other Handler City","latitude":7.5,"longitude":8.5}]}`)
		}
		if req.URL.Query().Get("latitude") != "7.5" || req.URL.Query().Get("longitude") != "8.5" {
			t.Errorf("used obsolete stored coordinates: %s", req.URL)
		}
		return handlerWeatherResponse(handlerWeatherFixture)
	})
	w := httptest.NewRecorder()
	s.handleGetWeather(w, httptest.NewRequest(http.MethodGet, "/api/widgets/weather?city=Other+Handler+City&refresh=1", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("failed alternate city request: %d %s", w.Code, w.Body.String())
	}
}

func TestWeatherHandlerColdNetworkErrorsRemainUpstreamErrors(t *testing.T) {
	s := newWeatherHandlerServer(t)
	mockHandlerWeatherHTTP(t, func(req *http.Request) (*http.Response, error) {
		return nil, errors.New("network offline")
	})
	start := time.Now()
	w := httptest.NewRecorder()
	s.handleGetWeather(w, httptest.NewRequest(http.MethodGet, "/api/widgets/weather?city=Handler+Unreachable+City", nil))
	if w.Code != http.StatusBadGateway || !strings.Contains(w.Body.String(), "network offline") ||
		strings.Contains(w.Body.String(), "city not found") {
		t.Fatalf("misleading cold failure: %d %s", w.Code, w.Body.String())
	}
	if time.Since(start) > 500*time.Millisecond {
		t.Fatal("cold upstream errors retried with blocking backoff")
	}
}

func TestWeatherHandlerRejectsInvalidCoordinateQuery(t *testing.T) {
	s := newWeatherHandlerServer(t)
	mockHandlerWeatherHTTP(t, func(req *http.Request) (*http.Response, error) {
		t.Error("invalid coordinate request reached upstream")
		return nil, errors.New("unexpected request")
	})
	for _, values := range []url.Values{
		{"lat": {"1"}}, {"lon": {"2"}}, {"lat": {""}, "lon": {""}},
		{"lat": {"NaN"}, "lon": {"1"}}, {"lat": {"1"}, "lon": {"Inf"}},
		{"lat": {"91"}, "lon": {"1"}}, {"lat": {"1"}, "lon": {"-181"}},
		{"lat": {"bad"}, "lon": {"1"}},
	} {
		w := httptest.NewRecorder()
		s.handleGetWeather(w, httptest.NewRequest(http.MethodGet, "/api/widgets/weather?"+values.Encode(), nil))
		if w.Code != http.StatusBadRequest {
			t.Errorf("invalid coordinates accepted: %v => %d %s", values, w.Code, w.Body.String())
		}
	}
}

func TestWeatherHandlerRefreshFailureReturnsWarningAndOldData(t *testing.T) {
	s := newWeatherHandlerServer(t)
	var calls atomic.Int32
	mockHandlerWeatherHTTP(t, func(req *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			return handlerWeatherResponse(handlerWeatherFixture)
		}
		return nil, errors.New("forecast unavailable")
	})
	var previous widgets.Weather
	for i := range 2 {
		w := httptest.NewRecorder()
		s.handleGetWeather(w, httptest.NewRequest(http.MethodGet, "/api/widgets/weather?lat=9.125&lon=10.125&refresh=1", nil))
		var weather widgets.Weather
		if err := json.Unmarshal(w.Body.Bytes(), &weather); err != nil || w.Code != http.StatusOK {
			t.Fatalf("refresh discarded good data: %d %s", w.Code, w.Body.String())
		}
		if i == 1 && (weather.Temperature != previous.Temperature || weather.FetchedAt != previous.FetchedAt ||
			!strings.Contains(weather.Warning, "forecast unavailable")) {
			t.Fatalf("refresh warning/values missing: %+v", weather)
		}
		previous = weather
	}
}
