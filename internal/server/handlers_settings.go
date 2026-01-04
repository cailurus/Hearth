package server

import (
	"encoding/json"
	"net/http"
	"time"
)

const (
	kvSiteTitle               = "settings.siteTitle"
	kvLanguage                = "settings.language"            // "zh"|"en"
	kvBackgroundProvider      = "settings.background.provider" // bing|picsum (unsplash kept for backward compatibility)
	kvBackgroundUnsplashQuery = "settings.background.unsplash.query"
	kvBackgroundInterval      = "settings.background.interval" // duration string, 0 means never auto refresh
	kvTimezones               = "settings.timezones"           // JSON array
	kvWeatherCity             = "settings.weather.city"
	kvWeatherLat              = "settings.weather.lat"
	kvWeatherLon              = "settings.weather.lon"
	kvTimeEnabled             = "settings.time.enabled"     // "true"|"false"
	kvTimeTimezone            = "settings.time.timezone"    // IANA timezone
	kvTimeShowSeconds         = "settings.time.showSeconds" // "true"|"false"
	kvTimeMode                = "settings.time.mode"        // digital|clock
)

const defaultWeatherCity = "Shanghai, Shanghai, China"

type Settings struct {
	SiteTitle string `json:"siteTitle"`
	Language  string `json:"language"`

	Background struct {
		Provider      string `json:"provider"`
		UnsplashQuery string `json:"unsplashQuery"`
		Interval      string `json:"interval"`
	} `json:"background"`

	Timezones []string `json:"timezones"`

	Weather struct {
		City string `json:"city"`
	} `json:"weather"`

	Time *TimeSettings `json:"time"`
}

type TimeSettings struct {
	Enabled     bool   `json:"enabled"`
	Timezone    string `json:"timezone"`
	ShowSeconds bool   `json:"showSeconds"`
	Mode        string `json:"mode"` // digital|clock
}

func normalizeIanaTimezone(tz string) string {
	// Keep behavior consistent with the UI defaults.
	const fallback = "Asia/Shanghai"
	if tz == "" {
		return fallback
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return fallback
	}
	return tz
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	st := Settings{}
	st.SiteTitle = s.getStringSetting(kvSiteTitle, "My Home")
	st.Language = s.getStringSetting(kvLanguage, "zh")
	if st.Language != "zh" && st.Language != "en" {
		st.Language = "zh"
	}
	st.Background.Provider = s.getStringSetting(kvBackgroundProvider, "default")
	if st.Background.Provider == "bing" {
		st.Background.Provider = "bing_daily"
	}
	st.Background.UnsplashQuery = s.getStringSetting(kvBackgroundUnsplashQuery, "")
	st.Background.Interval = s.getStringSetting(kvBackgroundInterval, "0")
	st.Weather.City = s.getStringSetting(kvWeatherCity, defaultWeatherCity)

	st.Time = &TimeSettings{}
	// default enabled=true for fresh installs
	st.Time.Enabled = s.getStringSetting(kvTimeEnabled, "true") == "true"
	st.Time.Timezone = normalizeIanaTimezone(s.getStringSetting(kvTimeTimezone, "Asia/Shanghai"))
	st.Time.ShowSeconds = s.getStringSetting(kvTimeShowSeconds, "true") == "true"
	// UI is digital-only.
	st.Time.Mode = "digital"

	if tz := s.getStringSetting(kvTimezones, ""); tz != "" {
		_ = json.Unmarshal([]byte(tz), &st.Timezones)
	}
	if len(st.Timezones) == 0 {
		st.Timezones = []string{"Asia/Shanghai", "America/New_York"}
	}

	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var req Settings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.SiteTitle == "" {
		req.SiteTitle = "My Home"
	}
	if req.Language == "" {
		req.Language = "zh"
	}
	if req.Language != "zh" && req.Language != "en" {
		req.Language = "zh"
	}
	if req.Background.Provider == "" {
		req.Background.Provider = "default"
	}
	if req.Background.Provider == "bing" {
		req.Background.Provider = "bing_daily"
	}
	if req.Weather.City == "" {
		req.Weather.City = defaultWeatherCity
	}
	if req.Time != nil {
		req.Time.Timezone = normalizeIanaTimezone(req.Time.Timezone)
		// UI is digital-only.
		req.Time.Mode = "digital"
	}
	_ = s.store.SetKV(kvSiteTitle, req.SiteTitle)
	_ = s.store.SetKV(kvLanguage, req.Language)
	_ = s.store.SetKV(kvBackgroundProvider, req.Background.Provider)
	_ = s.store.SetKV(kvBackgroundUnsplashQuery, req.Background.UnsplashQuery)
	_ = s.store.SetKV(kvBackgroundInterval, req.Background.Interval)

	if b, err := json.Marshal(req.Timezones); err == nil {
		_ = s.store.SetKV(kvTimezones, string(b))
	}
	_ = s.store.SetKV(kvWeatherCity, req.Weather.City)
	// Keep DB clean: lat/lon are no longer used (city-only weather).
	_ = s.store.SetKV(kvWeatherLat, "")
	_ = s.store.SetKV(kvWeatherLon, "")
	if req.Time != nil {
		if req.Time.Enabled {
			_ = s.store.SetKV(kvTimeEnabled, "true")
		} else {
			_ = s.store.SetKV(kvTimeEnabled, "false")
		}
		if req.Time.ShowSeconds {
			_ = s.store.SetKV(kvTimeShowSeconds, "true")
		} else {
			_ = s.store.SetKV(kvTimeShowSeconds, "false")
		}
		_ = s.store.SetKV(kvTimeTimezone, req.Time.Timezone)
		_ = s.store.SetKV(kvTimeMode, "digital")
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) getStringSetting(key, def string) string {
	v, ok, err := s.store.GetKV(key)
	if err != nil || !ok {
		return def
	}
	if v == "" {
		return def
	}
	return v
}
