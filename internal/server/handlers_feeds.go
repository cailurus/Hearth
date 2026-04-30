package server

import (
	"log/slog"
	"net/http"
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
		if !strings.HasPrefix(f, "http://") && !strings.HasPrefix(f, "https://") {
			continue
		}
		valid = append(valid, f)
		if len(valid) >= 10 {
			break
		}
	}

	noCache := strings.TrimSpace(r.URL.Query().Get("nocache")) == "1"
	res, err := widgets.FetchRSSFeeds(r.Context(), valid, 8, noCache)
	if err != nil {
		// Partial RSS results are still useful — log and return what we have.
		slog.Warn("rss fetch partial", "error", err)
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleGetDeals(w http.ResponseWriter, r *http.Request) {
	region := validRegion(strings.TrimSpace(r.URL.Query().Get("region")), "us")
	res, err := widgets.FetchGameDeals(r.Context(), region)
	if err != nil {
		slog.Warn("game deals fetch partial", "region", region, "error", err)
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
	res, err := widgets.FetchCurrencyRates(r.Context(), pairs)
	if err != nil {
		slog.Warn("currency fetch partial", "error", err)
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleGetQuote(w http.ResponseWriter, r *http.Request) {
	res, err := widgets.FetchDailyQuote(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}
