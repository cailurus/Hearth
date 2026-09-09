package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/morezhou/hearth/internal/widgets"
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
	kvTitleSortOrder          = "settings.title.sortOrder"  // int, position of title block among groups
	kvGreetingEnabled         = "settings.greeting.enabled" // "true"|"false"
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

	Weather WeatherSettings `json:"weather"`

	Time *TimeSettings `json:"time"`

	TitleSortOrder int               `json:"titleSortOrder"` // Position of title block among groups, default 0 (top)
	Greeting       *GreetingSettings `json:"greeting"`
}

type WeatherSettings struct {
	City string   `json:"city"`
	Lat  *float64 `json:"lat,omitempty"`
	Lon  *float64 `json:"lon,omitempty"`
}

type GreetingSettings struct {
	Enabled bool `json:"enabled"`
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
	st.Weather = s.weatherSettings()

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

	// Title sort order (default 0 = at top)
	st.TitleSortOrder = s.getIntSetting(kvTitleSortOrder, 0)

	st.Greeting = &GreetingSettings{
		Enabled: s.getStringSetting(kvGreetingEnabled, "true") == "true",
	}

	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
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
	req.Weather.City = strings.TrimSpace(req.Weather.City)
	if req.Weather.City == "" {
		req.Weather.City = defaultWeatherCity
	}
	if (req.Weather.Lat == nil) != (req.Weather.Lon == nil) ||
		(req.Weather.Lat != nil && !widgets.ValidCoordinates(*req.Weather.Lat, *req.Weather.Lon)) {
		writeError(w, http.StatusBadRequest, "weather requires a valid numeric lat/lon pair")
		return
	}
	if req.Time != nil {
		req.Time.Timezone = normalizeIanaTimezone(req.Time.Timezone)
		// UI is digital-only.
		req.Time.Mode = "digital"
	}
	var errs []error
	setKV := func(key, value string) {
		if err := s.store.SetKV(key, value); err != nil {
			errs = append(errs, err)
		}
	}

	setKV(kvSiteTitle, req.SiteTitle)
	setKV(kvLanguage, req.Language)
	setKV(kvBackgroundProvider, req.Background.Provider)
	setKV(kvBackgroundUnsplashQuery, req.Background.UnsplashQuery)
	setKV(kvBackgroundInterval, req.Background.Interval)

	if b, err := json.Marshal(req.Timezones); err == nil {
		setKV(kvTimezones, string(b))
	}
	if err := s.saveWeatherSettings(req.Weather); err != nil {
		errs = append(errs, err)
	}
	if req.Time != nil {
		if req.Time.Enabled {
			setKV(kvTimeEnabled, "true")
		} else {
			setKV(kvTimeEnabled, "false")
		}
		if req.Time.ShowSeconds {
			setKV(kvTimeShowSeconds, "true")
		} else {
			setKV(kvTimeShowSeconds, "false")
		}
		setKV(kvTimeTimezone, req.Time.Timezone)
		setKV(kvTimeMode, "digital")
	}

	setKV(kvTitleSortOrder, fmt.Sprintf("%d", req.TitleSortOrder))

	if req.Greeting != nil {
		if req.Greeting.Enabled {
			setKV(kvGreetingEnabled, "true")
		} else {
			setKV(kvGreetingEnabled, "false")
		}
	}

	if len(errs) > 0 {
		writeError(w, http.StatusInternalServerError, "failed to save settings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type weatherSettingsReader interface {
	QueryRow(string, ...any) *sql.Row
}

func readWeatherSettings(db weatherSettingsReader) (WeatherSettings, error) {
	var city, lat, lon sql.NullString
	err := db.QueryRow(`SELECT
		(SELECT value FROM kv WHERE key = ?),
		(SELECT value FROM kv WHERE key = ?),
		(SELECT value FROM kv WHERE key = ?)`, kvWeatherCity, kvWeatherLat, kvWeatherLon).Scan(&city, &lat, &lon)
	if err != nil {
		return WeatherSettings{}, err
	}
	settings := WeatherSettings{City: strings.TrimSpace(city.String)}
	if settings.City == "" {
		settings.City = defaultWeatherCity
	}
	if latitude, longitude, err := widgets.ParseWeatherCoordinates(lat.String, lon.String); err == nil {
		settings.Lat, settings.Lon = &latitude, &longitude
	}
	return settings, nil
}

func (s *Server) weatherSettings() WeatherSettings {
	settings, err := readWeatherSettings(s.db)
	if err != nil {
		return WeatherSettings{City: defaultWeatherCity}
	}
	return settings
}

func (s *Server) saveWeatherSettings(settings WeatherSettings) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	previous, err := readWeatherSettings(tx)
	if err != nil {
		return err
	}
	if settings.Lat == nil && settings.Lon == nil && settings.City == previous.City {
		// Older clients save only the city; keep a valid selection unless it changed.
		settings.Lat, settings.Lon = previous.Lat, previous.Lon
	}
	lat, lon := "", ""
	if settings.Lat != nil || settings.Lon != nil {
		if settings.Lat == nil || settings.Lon == nil || !widgets.ValidCoordinates(*settings.Lat, *settings.Lon) {
			return errors.New("invalid weather coordinates")
		}
		lat = strconv.FormatFloat(*settings.Lat, 'f', -1, 64)
		lon = strconv.FormatFloat(*settings.Lon, 'f', -1, 64)
	}
	// Update the label and its coordinates atomically, so readers never pair
	// a newly selected city with the previous city's location.
	for _, entry := range [][2]string{{kvWeatherCity, settings.City}, {kvWeatherLat, lat}, {kvWeatherLon, lon}} {
		if _, err := tx.Exec(`INSERT INTO kv (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value=excluded.value`, entry[0], entry[1]); err != nil {
			return err
		}
	}
	return tx.Commit()
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

func (s *Server) getIntSetting(key string, def int) int {
	v, ok, err := s.store.GetKV(key)
	if err != nil || !ok {
		return def
	}
	var i int
	if _, err := fmt.Sscanf(v, "%d", &i); err != nil {
		return def
	}
	return i
}
