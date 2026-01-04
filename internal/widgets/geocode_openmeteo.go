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
	"time"
	"unicode"
)

type GeoPoint struct {
	Lat         float64
	Lon         float64
	DisplayName string
	Timezone    string
}

type geoPayload struct {
	Results []struct {
		ID        int     `json:"id"`
		Name      string  `json:"name"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		Timezone  string  `json:"timezone"`
		Country   string  `json:"country"`
		Admin1    string  `json:"admin1"`
	} `json:"results"`
}

func normalizeGeoLanguage(language string) string {
	lang := strings.ToLower(strings.TrimSpace(language))
	if strings.HasPrefix(lang, "zh") {
		return "zh"
	}
	return "en"
}

func containsCJK(s string) bool {
	for _, r := range s {
		// Han covers most Chinese characters.
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func fetchGeo(ctx context.Context, q string, count int, language string) (geoPayload, error) {
	params := url.Values{}
	params.Set("name", q)
	params.Set("count", fmt.Sprintf("%d", count))
	params.Set("language", language)
	params.Set("format", "json")

	endpoint := "https://geocoding-api.open-meteo.com/v1/search?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return geoPayload{}, err
	}
	req.Header.Set("User-Agent", "Hearth/0.1")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return geoPayload{}, err
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
		return geoPayload{}, fmt.Errorf("open-meteo geocoding: status=%d reason=%s", resp.StatusCode, reason)
	}

	var payload geoPayload
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return geoPayload{}, err
	}
	return payload, nil
}

func SearchCities(ctx context.Context, query string, count int, language string) ([]GeoPoint, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, errors.New("city required")
	}
	// Users may store/display values like "City, Admin, Country".
	// Open-Meteo's geocoding "name" parameter is more reliable with just the city token.
	if i := strings.IndexAny(q, ",，"); i >= 0 {
		q = strings.TrimSpace(q[:i])
		if q == "" {
			return nil, errors.New("city required")
		}
	}
	if count <= 0 {
		count = 8
	}
	if count > 20 {
		count = 20
	}

	// If the user types Chinese, Open-Meteo's English search can fail entirely.
	// In that case, force zh-mode geocoding so we can still resolve it.
	langNorm := normalizeGeoLanguage(language)
	if langNorm != "zh" && containsCJK(q) {
		langNorm = "zh"
	}

	payload, err := fetchGeo(ctx, q, count, map[bool]string{true: "zh", false: "en"}[langNorm == "zh"])
	if err != nil {
		return nil, err
	}
	if len(payload.Results) == 0 {
		return nil, errors.New("city not found")
	}

	// Open-Meteo sometimes returns Traditional city names for language=zh.
	// To guarantee Simplified display, merge:
	// - zh (keeps country/admin localized)
	// - zh-CN (provides simplified city name)
	nameByID := map[int]string{}
	if langNorm == "zh" {
		if payloadCN, err2 := fetchGeo(ctx, q, count, "zh-CN"); err2 == nil {
			for _, r := range payloadCN.Results {
				if r.ID != 0 && strings.TrimSpace(r.Name) != "" {
					nameByID[r.ID] = strings.TrimSpace(r.Name)
				}
			}
		}
	}

	out := make([]GeoPoint, 0, len(payload.Results))
	for _, r := range payload.Results {
		name := strings.TrimSpace(r.Name)
		if langNorm == "zh" {
			if n2, ok := nameByID[r.ID]; ok && strings.TrimSpace(n2) != "" {
				name = strings.TrimSpace(n2)
			}
		}
		dn := name
		if strings.TrimSpace(r.Admin1) != "" && strings.TrimSpace(r.Country) != "" {
			dn = dn + ", " + strings.TrimSpace(r.Admin1) + ", " + strings.TrimSpace(r.Country)
		} else if strings.TrimSpace(r.Country) != "" {
			dn = dn + ", " + strings.TrimSpace(r.Country)
		}
		out = append(out, GeoPoint{Lat: r.Latitude, Lon: r.Longitude, DisplayName: dn, Timezone: strings.TrimSpace(r.Timezone)})
	}

	return out, nil
}

// GeocodeCity resolves a free-form city name to a single lat/lon via Open-Meteo's geocoding API.
// This lets the frontend stay city-only (no manual lat/lon).
func GeocodeCity(ctx context.Context, city string) (GeoPoint, error) {
	list, err := SearchCities(ctx, city, 1, "en")
	if err != nil {
		return GeoPoint{}, err
	}
	if len(list) == 0 {
		return GeoPoint{}, errors.New("city not found")
	}
	return list[0], nil
}

// GeocodeCityLocalized resolves a free-form city name to a single lat/lon via Open-Meteo's geocoding API,
// returning a display name localized to the requested language.
func GeocodeCityLocalized(ctx context.Context, city string, language string) (GeoPoint, error) {
	list, err := SearchCities(ctx, city, 1, language)
	if err != nil {
		return GeoPoint{}, err
	}
	if len(list) == 0 {
		return GeoPoint{}, errors.New("city not found")
	}
	return list[0], nil
}
