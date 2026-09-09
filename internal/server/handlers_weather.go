package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/morezhou/hearth/internal/widgets"
)

func (s *Server) handleGetWeather(w http.ResponseWriter, r *http.Request) {
	lat := strings.TrimSpace(r.URL.Query().Get("lat"))
	lon := strings.TrimSpace(r.URL.Query().Get("lon"))
	city := strings.TrimSpace(r.URL.Query().Get("city"))
	lang := validLang(strings.TrimSpace(r.URL.Query().Get("lang")), "")
	settings := s.weatherSettings()
	if city == "" {
		city = settings.City
	}
	if r.URL.Query().Has("lat") || r.URL.Query().Has("lon") {
		if _, _, err := widgets.ParseWeatherCoordinates(lat, lon); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	} else if city == settings.City && settings.Lat != nil && settings.Lon != nil {
		lat = strconv.FormatFloat(*settings.Lat, 'f', -1, 64)
		lon = strconv.FormatFloat(*settings.Lon, 'f', -1, 64)
	}
	force := r.URL.Query().Get("refresh") == "1" || r.URL.Query().Get("nocache") == "1"
	var wx widgets.Weather
	var err error
	if lat != "" && lon != "" {
		wx, err = widgets.FetchOpenMeteo(r.Context(), lat, lon, city, force)
	} else {
		wx, err = widgets.FetchWeatherForCity(r.Context(), city, lang, force)
	}
	if err != nil {
		writeWeatherError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, wx)
}

func writeWeatherError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	switch {
	case errors.Is(err, widgets.ErrCityNotFound):
		status = http.StatusNotFound
	case errors.Is(err, context.DeadlineExceeded):
		status = http.StatusGatewayTimeout
	case strings.Contains(err.Error(), "status=429"):
		status = http.StatusTooManyRequests
	}
	writeError(w, status, err.Error())
}

func (s *Server) handleSearchCity(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("query"))
	lang := validLang(strings.TrimSpace(r.URL.Query().Get("lang")), "")
	if q == "" {
		q = strings.TrimSpace(r.URL.Query().Get("q"))
	}
	if q == "" {
		writeError(w, http.StatusBadRequest, "query required")
		return
	}
	list, status, err := widgets.SearchCitiesCached(r.Context(), q, 8, lang)
	if err != nil {
		writeWeatherError(w, err)
		return
	}
	type cityResult struct {
		DisplayName string  `json:"displayName"`
		Lat         float64 `json:"lat"`
		Lon         float64 `json:"lon"`
	}
	res := make([]cityResult, 0, len(list))
	for _, pt := range list {
		res = append(res, cityResult{DisplayName: pt.DisplayName, Lat: pt.Lat, Lon: pt.Lon})
	}
	writeJSON(w, http.StatusOK, struct {
		widgets.DataStatus
		Results []cityResult `json:"results"`
	}{DataStatus: status, Results: res})
}

func (s *Server) handleGetCityTimezone(w http.ResponseWriter, r *http.Request) {
	city := strings.TrimSpace(r.URL.Query().Get("city"))
	lang := validLang(strings.TrimSpace(r.URL.Query().Get("lang")), "")
	if city == "" {
		city = strings.TrimSpace(r.URL.Query().Get("q"))
	}
	if city == "" {
		writeError(w, http.StatusBadRequest, "city required")
		return
	}
	pt, _, err := widgets.ResolveWeatherLocation(r.Context(), city, lang)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tz := strings.TrimSpace(pt.Timezone)
	if tz == "" {
		// Fallback path (older payloads / unexpected upstream changes).
		tz, err = widgets.ResolveTimezone(r.Context(), fmt.Sprintf("%f", pt.Lat), fmt.Sprintf("%f", pt.Lon))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	label := city
	if strings.TrimSpace(pt.DisplayName) != "" {
		label = pt.DisplayName
	}
	writeJSON(w, http.StatusOK, map[string]any{"timezone": tz, "city": label})
}

func (s *Server) handleGetTimezones(w http.ResponseWriter, r *http.Request) {
	st := Settings{}
	if tz := s.getStringSetting(kvTimezones, ""); tz != "" {
		_ = json.Unmarshal([]byte(tz), &st.Timezones)
	}
	if len(st.Timezones) == 0 {
		st.Timezones = []string{"Asia/Shanghai", "America/New_York"}
	}
	writeJSON(w, http.StatusOK, map[string]any{"timezones": st.Timezones})
}
