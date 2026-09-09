package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/morezhou/hearth/internal/widgets"
)

type financialHandlerTransport func(*http.Request) (*http.Response, error)

func (f financialHandlerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

var financialHandlerTestID atomic.Int64

func TestFinancialMarketHandlersForwardOptionalKey(t *testing.T) {
	for _, search := range []bool{false, true} {
		t.Run(fmt.Sprintf("search=%v", search), func(t *testing.T) {
			key := fmt.Sprintf("financial-handler-test-key-%d", financialHandlerTestID.Add(1))
			s := &Server{cfg: Config{CoinGeckoAPIKey: key}}
			oldClient := widgets.DefaultClient
			t.Cleanup(func() { widgets.DefaultClient = oldClient })
			var cgCalls atomic.Int32
			widgets.DefaultClient = &http.Client{Transport: financialHandlerTransport(func(r *http.Request) (*http.Response, error) {
				status, body := 503, ""
				if r.URL.Host == "api.coingecko.com" {
					cgCalls.Add(1)
					if r.Header.Get("X-CG-Demo-API-Key") != key {
						t.Errorf("handler omitted optional Demo key")
					}
					status = 200
					if strings.HasSuffix(r.URL.Path, "/search") {
						body = `{"coins":[{"id":"bitcoin","name":"Bitcoin","symbol":"btc"}]}`
					} else {
						body = `[{"id":"bitcoin","symbol":"btc","current_price":100,"price_change_percentage_24h":1,"last_updated":"2026-09-08T12:00:00Z","sparkline_in_7d":{"price":[99,100]}}]`
					}
				}
				return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
			})}
			if !search {
				t.Cleanup(func() {
					ctx, cancel := context.WithTimeout(widgets.WithCoinGeckoAPIKey(context.Background(), key), 3*time.Second)
					defer cancel()
					for ctx.Err() == nil {
						res, _ := widgets.FetchMarkets(ctx, []string{"BTC", "AAPL", "MSFT", "TSLA"})
						if !res.Refreshing {
							return
						}
						time.Sleep(20 * time.Millisecond)
					}
					t.Error("pending handler loads did not finish")
				})
			}
			w := httptest.NewRecorder()
			if search {
				s.handleSearchMarkets(w, httptest.NewRequest(http.MethodGet, "/api/widgets/markets/search?query=btc", nil))
			} else {
				s.handleGetMarkets(w, httptest.NewRequest(http.MethodGet, "/api/widgets/markets?symbols=BTC,AAPL,MSFT,TSLA", nil))
			}
			if w.Code != http.StatusOK || cgCalls.Load() == 0 {
				t.Fatalf("financial handler failed: %d %s; CoinGecko calls=%d", w.Code, w.Body.String(), cgCalls.Load())
			}
			var response map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || (response["warning"] == nil && response["refreshing"] != true) {
				t.Fatalf("partial-source state missing: %s, %v", w.Body.String(), err)
			}
			if strings.Contains(w.Body.String(), key) {
				t.Fatal("server key exposed in response")
			}
		})
	}
}

func TestFinancialMarketSearchAllFailedIsUpstreamError(t *testing.T) {
	key := fmt.Sprintf("financial-handler-failure-key-%d", financialHandlerTestID.Add(1))
	s := &Server{cfg: Config{CoinGeckoAPIKey: key}}
	oldClient := widgets.DefaultClient
	t.Cleanup(func() { widgets.DefaultClient = oldClient })
	widgets.DefaultClient = &http.Client{Transport: financialHandlerTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 503, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	w := httptest.NewRecorder()
	s.handleSearchMarkets(w, httptest.NewRequest(http.MethodGet, "/api/widgets/markets/search?query=financial-all-failed", nil))
	if w.Code != http.StatusBadGateway {
		t.Fatalf("upstream failure disguised as empty success: %d %s", w.Code, w.Body.String())
	}
}
