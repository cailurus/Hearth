package server

import (
	"log"
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
		log.Printf("[rss] fetch: %v", err)
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleGetDeals(w http.ResponseWriter, r *http.Request) {
	region := strings.TrimSpace(r.URL.Query().Get("region"))
	if region == "" {
		region = "us"
	}
	res, err := widgets.FetchGameDeals(r.Context(), region)
	if err != nil {
		log.Printf("[deals] fetch: %v", err)
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
		log.Printf("[currency] fetch: %v", err)
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
