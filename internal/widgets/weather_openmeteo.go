package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

var weatherTTLCache = cache.New[Weather](5 * time.Minute)

func weatherCacheKey(lat, lon string) string {
	return strings.TrimSpace(lat) + "," + strings.TrimSpace(lon)
}

type Weather struct {
	City        string          `json:"city"`
	Temperature float64         `json:"temperatureC"`
	WeatherCode int             `json:"weatherCode"`
	WindSpeed   float64         `json:"windSpeedKph"`
	FetchedAt   int64           `json:"fetchedAt"`
	Daily       []DailyForecast `json:"daily"`
}

type DailyForecast struct {
	Date     string  `json:"date"`
	Code     int     `json:"weatherCode"`
	TempMaxC float64 `json:"tempMaxC"`
	TempMinC float64 `json:"tempMinC"`
}

// FetchOpenMeteo uses Open-Meteo current weather (no API key).
// Uses stale-while-revalidate: if cache is expired but stale data exists,
// returns stale data immediately and refreshes in the background.
func FetchOpenMeteo(ctx context.Context, lat, lon, city string) (Weather, error) {
	if lat == "" || lon == "" {
		return Weather{}, errors.New("weather lat/lon not configured")
	}

	key := weatherCacheKey(lat, lon)
	if key == "," {
		return Weather{}, errors.New("weather lat/lon invalid")
	}

	// Fresh cache hit — return immediately.
	if cached, ok := weatherTTLCache.Get(key); ok {
		result := cached
		if strings.TrimSpace(city) != "" {
			result.City = city
		}
		return result, nil
	}

	// Stale-while-revalidate: if stale data exists, return it and refresh async.
	if stale, ok := weatherTTLCache.GetStale(key); ok {
		result := stale
		if strings.TrimSpace(city) != "" {
			result.City = city
		}
		go fetchAndCacheWeather(key, lat, lon, city)
		return result, nil
	}

	// No cached data at all — must fetch synchronously.
	return fetchWeatherSync(ctx, key, lat, lon, city)
}

func fetchAndCacheWeather(key, lat, lon, city string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	w, err := fetchWeatherFromAPI(ctx, lat, lon, city)
	if err != nil {
		slog.Warn("weather background refresh failed", "error", err)
		return
	}
	weatherTTLCache.Set(key, w)
}

func fetchWeatherSync(ctx context.Context, key, lat, lon, city string) (Weather, error) {
	// Use a longer timeout for the synchronous first-load case.
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	w, err := fetchWeatherFromAPI(ctx, lat, lon, city)
	if err != nil {
		return Weather{}, err
	}
	weatherTTLCache.Set(key, w)
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
		Current struct {
			Temperature float64 `json:"temperature_2m"`
			WeatherCode int     `json:"weather_code"`
			WindSpeed   float64 `json:"wind_speed_10m"`
		} `json:"current"`
		Daily struct {
			Time []string  `json:"time"`
			Code []int     `json:"weather_code"`
			MaxC []float64 `json:"temperature_2m_max"`
			MinC []float64 `json:"temperature_2m_min"`
		} `json:"daily"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return Weather{}, err
	}

	daily := make([]DailyForecast, 0, 7)
	if len(payload.Daily.Time) > 0 {
		n := len(payload.Daily.Time)
		if len(payload.Daily.Code) < n {
			n = len(payload.Daily.Code)
		}
		if len(payload.Daily.MaxC) < n {
			n = len(payload.Daily.MaxC)
		}
		if len(payload.Daily.MinC) < n {
			n = len(payload.Daily.MinC)
		}
		for i := 0; i < n; i++ {
			daily = append(daily, DailyForecast{
				Date:     payload.Daily.Time[i],
				Code:     payload.Daily.Code[i],
				TempMaxC: payload.Daily.MaxC[i],
				TempMinC: payload.Daily.MinC[i],
			})
		}
	}

	return Weather{
		City:        city,
		Temperature: payload.Current.Temperature,
		WeatherCode: payload.Current.WeatherCode,
		WindSpeed:   payload.Current.WindSpeed,
		FetchedAt:   time.Now().Unix(),
		Daily:       daily,
	}, nil
}
