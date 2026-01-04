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
)

// ResolveTimezone resolves an IANA timezone name for a given lat/lon using Open-Meteo.
// It uses timezone=auto and reads the resolved timezone from the response.
func ResolveTimezone(ctx context.Context, lat, lon string) (string, error) {
	if lat == "" || lon == "" {
		return "", errors.New("lat/lon required")
	}

	q := url.Values{}
	q.Set("latitude", lat)
	q.Set("longitude", lon)
	// Keep payload small; timezone is returned regardless.
	q.Set("current", "temperature_2m")
	q.Set("timezone", "auto")

	endpoint := "https://api.open-meteo.com/v1/forecast?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Hearth/0.1")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
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
		return "", fmt.Errorf("open-meteo forecast: status=%d reason=%s", resp.StatusCode, reason)
	}

	var payload struct {
		Timezone string `json:"timezone"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", err
	}
	if payload.Timezone == "" {
		return "", errors.New("timezone not found")
	}
	return payload.Timezone, nil
}
