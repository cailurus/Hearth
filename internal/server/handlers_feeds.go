package server

import (
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/morezhou/hearth/internal/widgets"
)

func (s *Server) handleGetRSS(w http.ResponseWriter, r *http.Request) {
	feeds := r.URL.Query()["feed"]
	var valid []string
	for _, f := range feeds {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		parsed, err := url.Parse(f)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			writeError(w, http.StatusBadRequest, "invalid RSS feed URL")
			return
		}
		valid = append(valid, f)
		if len(valid) >= 10 {
			break
		}
	}

	noCache := strings.TrimSpace(r.URL.Query().Get("nocache")) == "1"
	res, err := widgets.FetchRSSFeeds(r.Context(), valid, 8, noCache)
	if err != nil {
		slog.Warn("rss data unavailable", "error", err)
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleGetCurrency(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("pairs"))
	if raw == "" {
		writeError(w, http.StatusBadRequest, "pairs required")
		return
	}
	pairs := splitCSVish(raw)
	if len(pairs) > 4 {
		pairs = pairs[:4]
	}
	force := r.URL.Query().Get("refresh") == "1" || r.URL.Query().Get("nocache") == "1"
	res, err := widgets.FetchCurrencyRates(r.Context(), pairs, force)
	if err != nil {
		slog.Warn("currency data unavailable", "error", err)
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleGetQuote(w http.ResponseWriter, r *http.Request) {
	lang := validLang(r.URL.Query().Get("lang"), s.getStringSetting(kvLanguage, "zh"))
	var res widgets.QuoteResponse
	var err error
	if r.URL.Query().Get("refresh") == "1" {
		res, err = widgets.RefreshDailyQuote(r.Context(), lang)
	} else {
		res, err = widgets.FetchDailyQuote(r.Context(), lang)
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}
