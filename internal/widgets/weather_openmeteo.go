package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var weatherCache = struct {
	mu    sync.Mutex
	items map[string]Weather
}{
	items: map[string]Weather{},
}

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
func FetchOpenMeteo(ctx context.Context, lat, lon, city string) (Weather, error) {
	if lat == "" || lon == "" {
		return Weather{}, errors.New("weather lat/lon not configured")
	}

	// Reduce repeated calls (frontend may request the same location multiple times).
	// If we get rate-limited by Open-Meteo, fall back to a cached value when available.
	const freshTTL = 5 * time.Minute
	const maxStale = 2 * time.Hour
	key := weatherCacheKey(lat, lon)
	if key != "," {
		weatherCache.mu.Lock()
		if cached, ok := weatherCache.items[key]; ok {
			age := time.Since(time.Unix(cached.FetchedAt, 0))
			if cached.FetchedAt > 0 && age >= 0 && age < freshTTL {
				weatherCache.mu.Unlock()
				// Ensure city label matches the request.
				if strings.TrimSpace(city) != "" {
					cached.City = city
				}
				return cached, nil
			}
		}
		weatherCache.mu.Unlock()
	}

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
	req.Header.Set("User-Agent", "Hearth/0.1")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		if key != "," {
			weatherCache.mu.Lock()
			cached, ok := weatherCache.items[key]
			weatherCache.mu.Unlock()
			if ok {
				age := time.Since(time.Unix(cached.FetchedAt, 0))
				if cached.FetchedAt > 0 && age >= 0 && age < maxStale {
					if strings.TrimSpace(city) != "" {
						cached.City = city
					}
					return cached, nil
				}
			}
		}
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
		upstreamErr := fmt.Errorf("open-meteo forecast: status=%d reason=%s", resp.StatusCode, reason)
		if key != "," {
			weatherCache.mu.Lock()
			cached, ok := weatherCache.items[key]
			weatherCache.mu.Unlock()
			if ok {
				age := time.Since(time.Unix(cached.FetchedAt, 0))
				if cached.FetchedAt > 0 && age >= 0 && age < maxStale {
					if strings.TrimSpace(city) != "" {
						cached.City = city
					}
					return cached, nil
				}
			}
		}
		return Weather{}, upstreamErr
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

	w := Weather{
		City:        city,
		Temperature: payload.Current.Temperature,
		WeatherCode: payload.Current.WeatherCode,
		WindSpeed:   payload.Current.WindSpeed,
		FetchedAt:   time.Now().Unix(),
		Daily:       daily,
	}
	if key != "," {
		weatherCache.mu.Lock()
		weatherCache.items[key] = w
		weatherCache.mu.Unlock()
	}
	return w, nil
}
