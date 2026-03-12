package server

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/morezhou/hearth/internal/widgets"
)

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

	const nvstlyBase = "https://raw.githubusercontent.com/nvstly/icons/main"

	if err := os.MkdirAll(localDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Build the raw symbol with exchange suffix for Parqet (e.g., "0700.HK" for HK stocks)
	parqetSym := norm
	rawSym := strings.TrimSpace(r.URL.Query().Get("symbol"))
	if rawSym == "" {
		rawSym = strings.TrimSpace(r.URL.Query().Get("s"))
	}
	rawUp := strings.ToUpper(strings.TrimSpace(rawSym))
	if strings.HasSuffix(rawUp, ".HK") {
		parqetSym = rawUp // "0700.HK" — Parqet needs the exchange suffix
	} else if norm != "" {
		// Check if pure numeric (HK stock stored without suffix)
		allDigits := true
		for _, ch := range norm {
			if ch < '0' || ch > '9' {
				allDigits = false
				break
			}
		}
		if allDigits {
			parqetSym = norm + ".HK"
		}
	}

	client := &http.Client{Timeout: 8 * time.Second}
	candidates := []string{
		// Parqet: best coverage for stocks (US + HK) and some crypto
		fmt.Sprintf("https://assets.parqet.com/logos/symbol/%s?format=png", parqetSym),
		// nvstly: good crypto coverage fallback
		fmt.Sprintf("%s/ticker_icons/%s.png", nvstlyBase, norm),
		fmt.Sprintf("%s/crypto_icons/%s.png", nvstlyBase, norm),
	}

	const iconUA = "Mozilla/5.0 (compatible; Hearth/1.0; +https://github.com/cailurus/Hearth)"

	if r.Method == http.MethodHead {
		for _, url := range candidates {
			req, err := http.NewRequestWithContext(r.Context(), http.MethodHead, url, nil)
			if err != nil {
				continue
			}
			req.Header.Set("User-Agent", iconUA)
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
		req.Header.Set("User-Agent", iconUA)
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
	res, err := widgets.UpcomingPublicHolidays(r.Context(), countries, time.Now(), 5)
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
