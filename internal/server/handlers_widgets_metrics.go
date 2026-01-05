package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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

func splitCSVish(s string) []string {
	parts := strings.FieldsFunc(s, func(r rune) bool {
		switch r {
		case ',', ';', ' ', '\n', '\t':
			return true
		default:
			return false
		}
	})
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out = append(out, p)
	}
	return out
}

func (s *Server) handleGetMarkets(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("symbols"))
	if raw == "" {
		raw = strings.TrimSpace(r.URL.Query().Get("s"))
	}
	if raw == "" {
		writeError(w, http.StatusBadRequest, "symbols required")
		return
	}

	symbols := splitCSVish(raw)
	res, err := widgets.FetchMarkets(r.Context(), symbols)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleSearchMarkets(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("query"))
	if q == "" {
		q = strings.TrimSpace(r.URL.Query().Get("q"))
	}
	list, err := widgets.SearchMarketSymbols(r.Context(), q, 12)
	if err != nil {
		// Search should be resilient; return empty results on upstream failures.
		writeJSON(w, http.StatusOK, map[string]any{"results": []any{}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": list})
}

func normalizeMarketIconSymbol(raw string) string {
	s := strings.ToUpper(strings.TrimSpace(raw))
	if s == "" {
		return ""
	}
	// Keep only A-Z0-9, limit length.
	out := make([]rune, 0, len(s))
	for _, ch := range s {
		if (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') {
			out = append(out, ch)
		}
		if len(out) >= 12 {
			break
		}
	}
	return strings.TrimSpace(string(out))
}

func (s *Server) handleGetMarketIcon(w http.ResponseWriter, r *http.Request) {
	sym := strings.TrimSpace(r.URL.Query().Get("symbol"))
	if sym == "" {
		sym = strings.TrimSpace(r.URL.Query().Get("s"))
	}
	norm := normalizeMarketIconSymbol(sym)
	if norm == "" {
		writeError(w, http.StatusBadRequest, "symbol required")
		return
	}

	// Serve from local cache if present.
	localDir := filepath.Join(s.cfg.DataDir, "icons", "markets")
	localPath := filepath.Join(localDir, norm+".png")
	if st, err := os.Stat(localPath); err == nil && !st.IsDir() {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=604800")
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.ServeFile(w, r, localPath)
		return
	}

	base := strings.TrimRight(strings.TrimSpace(s.cfg.MarketIconBaseURL), "/")
	if base == "" {
		http.NotFound(w, r)
		return
	}

	if err := os.MkdirAll(localDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	client := &http.Client{Timeout: 8 * time.Second}
	candidates := []string{
		fmt.Sprintf("%s/ticker_icons/%s.png", base, norm),
		fmt.Sprintf("%s/crypto_icons/%s.png", base, norm),
	}

	if r.Method == http.MethodHead {
		for _, url := range candidates {
			req, err := http.NewRequestWithContext(r.Context(), http.MethodHead, url, nil)
			if err != nil {
				continue
			}
			resp, err := client.Do(req)
			if err != nil {
				continue
			}
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				w.Header().Set("Content-Type", "image/png")
				w.Header().Set("Cache-Control", "public, max-age=300")
				w.WriteHeader(http.StatusOK)
				return
			}
		}
		http.NotFound(w, r)
		return
	}

	var body []byte
	for _, url := range candidates {
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
		if err != nil {
			continue
		}
		req.Header.Set("Accept", "image/png,image/*;q=0.9,*/*;q=0.1")
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		func() {
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				return
			}
			ct := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
			if ct != "" && !strings.HasPrefix(ct, "image/") {
				return
			}
			b, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
			if err != nil {
				return
			}
			// Very small guard: PNG signature.
			if len(b) < 8 || string(b[:4]) != "\x89PNG" {
				return
			}
			body = b
		}()
		if len(body) > 0 {
			break
		}
	}

	if len(body) == 0 {
		http.NotFound(w, r)
		return
	}

	// Atomic write.
	tmp := localPath + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err == nil {
		_ = os.Rename(tmp, localPath)
	} else {
		_ = os.Remove(tmp)
	}

	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=604800")
	_, _ = w.Write(body)
}

func (s *Server) handleGetHolidays(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("countries"))
	if raw == "" {
		raw = strings.TrimSpace(r.URL.Query().Get("c"))
	}
	if raw == "" {
		writeError(w, http.StatusBadRequest, "countries required")
		return
	}

	countries := splitCSVish(raw)
	res, err := widgets.UpcomingPublicHolidays(r.Context(), countries, time.Now(), 4)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleListHolidayCountries(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("query"))
	if q == "" {
		q = strings.TrimSpace(r.URL.Query().Get("q"))
	}
	limit := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			if n > 0 && n <= 200 {
				limit = n
			}
		}
	}

	list, err := widgets.ListHolidayCountries(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"results": []any{}})
		return
	}

	qUp := strings.ToUpper(strings.TrimSpace(q))
	results := make([]widgets.HolidayCountry, 0, limit)
	for _, c := range list {
		if qUp != "" {
			if !strings.Contains(strings.ToUpper(c.Code), qUp) && !strings.Contains(strings.ToUpper(c.Name), qUp) {
				continue
			}
		}
		results = append(results, c)
		if len(results) >= limit {
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}
