package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/morezhou/hearth/internal/metrics"
	"github.com/morezhou/hearth/internal/widgets"
)

func (s *Server) handleGetWeather(w http.ResponseWriter, r *http.Request) {
	lat := strings.TrimSpace(r.URL.Query().Get("lat"))
	lon := strings.TrimSpace(r.URL.Query().Get("lon"))
	city := strings.TrimSpace(r.URL.Query().Get("city"))
	lang := strings.TrimSpace(r.URL.Query().Get("lang"))
	if city == "" {
		city = s.getStringSetting(kvWeatherCity, "")
	}

	cityLabel := city
	if lat == "" || lon == "" {
		pt, err := widgets.GeocodeCityLocalized(r.Context(), city, lang)
		if err != nil && strings.HasPrefix(strings.ToLower(lang), "zh") {
			pt, err = widgets.GeocodeCityLocalized(r.Context(), city, "en")
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		lat = fmt.Sprintf("%f", pt.Lat)
		lon = fmt.Sprintf("%f", pt.Lon)
		if strings.TrimSpace(pt.DisplayName) != "" {
			cityLabel = pt.DisplayName
		}
	}

	wx, err := widgets.FetchOpenMeteo(r.Context(), lat, lon, cityLabel)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "status=429") {
			writeError(w, http.StatusTooManyRequests, msg)
			return
		}
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	writeJSON(w, http.StatusOK, wx)
}

func (s *Server) handleSearchCity(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("query"))
	lang := strings.TrimSpace(r.URL.Query().Get("lang"))
	if q == "" {
		q = strings.TrimSpace(r.URL.Query().Get("q"))
	}
	if q == "" {
		writeError(w, http.StatusBadRequest, "query required")
		return
	}
	list, err := widgets.SearchCities(r.Context(), q, 8, lang)
	if err != nil && strings.HasPrefix(strings.ToLower(lang), "zh") {
		if list2, err2 := widgets.SearchCities(r.Context(), q, 8, "en"); err2 == nil {
			list = list2
			err = nil
		}
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
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
	writeJSON(w, http.StatusOK, map[string]any{"results": res})
}

func (s *Server) handleGetCityTimezone(w http.ResponseWriter, r *http.Request) {
	city := strings.TrimSpace(r.URL.Query().Get("city"))
	lang := strings.TrimSpace(r.URL.Query().Get("lang"))
	if city == "" {
		city = strings.TrimSpace(r.URL.Query().Get("q"))
	}
	if city == "" {
		writeError(w, http.StatusBadRequest, "city required")
		return
	}
	pt, err := widgets.GeocodeCityLocalized(r.Context(), city, lang)
	if err != nil && strings.HasPrefix(strings.ToLower(lang), "zh") {
		pt, err = widgets.GeocodeCityLocalized(r.Context(), city, "en")
	}
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

func (s *Server) handleGetHostMetrics(w http.ResponseWriter, r *http.Request) {
	m, err := metrics.Collect(r.Context())
	if err != nil {
		log.Printf("[metrics] Collect partial: %v", err)
	}
	writeJSON(w, http.StatusOK, m)
}
