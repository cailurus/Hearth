package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

var weatherTTLCache = newWeatherCache()

func newWeatherCache() *cache.Cache[Weather] {
	c := cache.New[Weather](5 * time.Minute)
	c.SetMaxStale(24 * time.Hour)
	c.SetLoadTimeout(8 * time.Second)
	return c
}

// ConfigureWeatherPersistence enables independent weather cache namespaces.
// It is called once at application startup, not when constructing a server.
func ConfigureWeatherPersistence(root string) error {
	if err := weatherTTLCache.SetPersistence(filepath.Join(root, "weather")); err != nil {
		return err
	}
	if err := weatherLocationCache.SetPersistence(filepath.Join(root, "weather-locations")); err != nil {
		return err
	}
	return citySearchCache.SetPersistence(filepath.Join(root, "city-search"))
}

// ValidCoordinates accepts zero coordinates, but never missing or non-finite values.
func ValidCoordinates(lat, lon float64) bool {
	return !math.IsNaN(lat) && !math.IsNaN(lon) && !math.IsInf(lat, 0) && !math.IsInf(lon, 0) &&
		lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

func ParseWeatherCoordinates(lat, lon string) (float64, float64, error) {
	latitude, latErr := strconv.ParseFloat(strings.TrimSpace(lat), 64)
	longitude, lonErr := strconv.ParseFloat(strings.TrimSpace(lon), 64)
	if latErr != nil || lonErr != nil || !ValidCoordinates(latitude, longitude) {
		return 0, 0, errors.New("weather requires valid lat/lon: latitude -90..90, longitude -180..180")
	}
	return latitude, longitude, nil
}

func weatherCacheKey(lat, lon string) string {
	return strings.TrimSpace(lat) + "," + strings.TrimSpace(lon)
}

type Weather struct {
	DataStatus
	City        string          `json:"city"`
	Temperature float64         `json:"temperatureC"`
	WeatherCode int             `json:"weatherCode"`
	WindSpeed   float64         `json:"windSpeedKph"`
	FetchedAt   int64           `json:"fetchedAt"`
	Daily       []DailyForecast `json:"daily"`
	Source      string          `json:"source"`
	SourceURL   string          `json:"sourceUrl"`
}

type DailyForecast struct {
	Date     string  `json:"date"`
	Code     int     `json:"weatherCode"`
	TempMaxC float64 `json:"tempMaxC"`
	TempMinC float64 `json:"tempMinC"`
}

// FetchOpenMeteo uses Open-Meteo current weather (no API key).
// Stale values return immediately with one bounded refresh; force waits for an attempt.
func FetchOpenMeteo(ctx context.Context, lat, lon, city string, force ...bool) (Weather, error) {
	latitude, longitude, err := ParseWeatherCoordinates(lat, lon)
	if err != nil {
		return Weather{}, err
	}
	lat = strconv.FormatFloat(latitude, 'f', -1, 64)
	lon = strconv.FormatFloat(longitude, 'f', -1, 64)
	w, state, err := weatherTTLCache.Load(ctx, weatherCacheKey(lat, lon), func(ctx context.Context) (Weather, error) {
		return fetchWeatherFromAPI(ctx, lat, lon, city)
	}, force...)
	if err != nil {
		return Weather{}, err
	}
	w.DataStatus = statusFromCache(state)
	if strings.TrimSpace(city) != "" {
		w.City = city
	}
	w.Source = "Open-Meteo"
	w.SourceURL = "https://open-meteo.com/"
	return w, nil
}

func FetchWeatherForCity(ctx context.Context, city, language string, force ...bool) (Weather, error) {
	pt, locationStatus, err := ResolveWeatherLocation(ctx, city, language, force...)
	if err != nil {
		return Weather{}, err
	}
	w, err := FetchOpenMeteo(ctx, strconv.FormatFloat(pt.Lat, 'f', -1, 64),
		strconv.FormatFloat(pt.Lon, 'f', -1, 64), pt.DisplayName, force...)
	if err != nil {
		return Weather{}, err
	}
	w.Stale = w.Stale || locationStatus.Stale
	w.Refreshing = w.Refreshing || locationStatus.Refreshing
	if locationStatus.Warning != "" {
		if w.Warning != "" {
			w.Warning += "; "
		}
		w.Warning += "location: " + locationStatus.Warning
	}
	return w, nil
}

func fetchWeatherFromAPI(ctx context.Context, lat, lon, city string) (Weather, error) {
	q := url.Values{}
	q.Set("latitude", lat)
	q.Set("longitude", lon)
	q.Set("current", "temperature_2m,weather_code,wind_speed_10m")
	q.Set("daily", "weather_code,temperature_2m_max,temperature_2m_min")
	q.Set("forecast_days", "7")
	q.Set("timezone", "auto")

	endpoint := "https://api.open-meteo.com/v1/forecast?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Weather{}, err
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	resp, err := DefaultClient.Do(req)
	if err != nil {
		return Weather{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		var payloadErr struct {
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(body, &payloadErr)
		reason := strings.TrimSpace(payloadErr.Reason)
		if reason == "" {
			reason = strings.TrimSpace(string(body))
		}
		if reason == "" {
			reason = resp.Status
		}
		return Weather{}, fmt.Errorf("open-meteo forecast: status=%d reason=%s", resp.StatusCode, reason)
	}

	var payload struct {
		Current *struct {
			Temperature *float64 `json:"temperature_2m"`
			WeatherCode *int     `json:"weather_code"`
			WindSpeed   *float64 `json:"wind_speed_10m"`
		} `json:"current"`
		Daily struct {
			Time []string   `json:"time"`
			Code []*int     `json:"weather_code"`
			MaxC []*float64 `json:"temperature_2m_max"`
			MinC []*float64 `json:"temperature_2m_min"`
		} `json:"daily"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return Weather{}, fmt.Errorf("open-meteo forecast: %w", err)
	}
	if payload.Current == nil || payload.Current.Temperature == nil ||
		payload.Current.WeatherCode == nil || payload.Current.WindSpeed == nil {
		return Weather{}, errors.New("open-meteo forecast: missing current weather")
	}
	n := len(payload.Daily.Time)
	if n == 0 || len(payload.Daily.Code) != n || len(payload.Daily.MaxC) != n || len(payload.Daily.MinC) != n {
		return Weather{}, errors.New("open-meteo forecast: incomplete daily forecast")
	}
	daily := make([]DailyForecast, 0, n)
	for i := 0; i < n; i++ {
		if payload.Daily.Code[i] == nil || payload.Daily.MaxC[i] == nil || payload.Daily.MinC[i] == nil {
			return Weather{}, errors.New("open-meteo forecast: missing daily values")
		}
		if _, err := time.Parse("2006-01-02", payload.Daily.Time[i]); err != nil {
			return Weather{}, errors.New("open-meteo forecast: invalid forecast date")
		}
		daily = append(daily, DailyForecast{
			Date:     payload.Daily.Time[i],
			Code:     *payload.Daily.Code[i],
			TempMaxC: *payload.Daily.MaxC[i],
			TempMinC: *payload.Daily.MinC[i],
		})
	}

	return Weather{
		City:        city,
		Temperature: *payload.Current.Temperature,
		WeatherCode: *payload.Current.WeatherCode,
		WindSpeed:   *payload.Current.WindSpeed,
		FetchedAt:   time.Now().Unix(),
		Daily:       daily,
		Source:      "Open-Meteo",
		SourceURL:   "https://open-meteo.com/",
	}, nil
}
