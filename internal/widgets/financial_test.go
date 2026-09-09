package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

type financialRoundTripper func(*http.Request) (*http.Response, error)

func (f financialRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func financialResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

// Financial tests never run in parallel: the production client/cache handles
// are shared globals, while requests within each test intentionally overlap.
func resetFinancialTestState(t *testing.T, transport financialRoundTripper) {
	t.Helper()
	oldClient := DefaultClient
	oldCurrency, oldMarkets := currencyTTLCache, marketsTTLCache
	oldYahooSearch, oldCGSearch, oldCGSymbols := yahooSearchTTLCache, coinGeckoSearchTTLCache, coinGeckoSymbolTTLCache
	DefaultClient = &http.Client{Transport: transport}
	currencyTTLCache, marketsTTLCache = newCurrencyCache(), newMarketsCache()
	yahooSearchTTLCache = newFinancialSearchCache[[]MarketSymbol]()
	coinGeckoSearchTTLCache = newFinancialSearchCache[[]coinGeckoSearchCoin]()
	coinGeckoSymbolTTLCache = cache.New[coinGeckoSymbolEntry](time.Hour)
	coinGeckoBackoff.Lock()
	oldBackoff := coinGeckoBackoff.items
	coinGeckoBackoff.items = make(map[string]coinGeckoCooldown)
	coinGeckoBackoff.Unlock()
	yahooLimiter.mu.Lock()
	yahooLimiter.last = time.Time{}
	yahooLimiter.mu.Unlock()
	t.Cleanup(func() {
		DefaultClient = oldClient
		currencyTTLCache, marketsTTLCache = oldCurrency, oldMarkets
		yahooSearchTTLCache, coinGeckoSearchTTLCache, coinGeckoSymbolTTLCache = oldYahooSearch, oldCGSearch, oldCGSymbols
		coinGeckoBackoff.Lock()
		coinGeckoBackoff.items = oldBackoff
		coinGeckoBackoff.Unlock()
	})
}

func financialJSON(t *testing.T, value any) []byte {
	t.Helper()
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func financialYahooFixture(t *testing.T, meta map[string]any, timestamps []int64, closes []any) []byte {
	t.Helper()
	return financialJSON(t, map[string]any{"chart": map[string]any{
		"result": []any{map[string]any{
			"meta": meta, "timestamp": timestamps,
			"indicators": map[string]any{"quote": []any{map[string]any{"close": closes}}},
		}},
		"error": nil,
	}})
}

func financialStockFixture(t *testing.T, currency string) []byte {
	t.Helper()
	start := time.Date(2026, 9, 7, 13, 30, 0, 0, time.UTC).Unix()
	return financialYahooFixture(t, map[string]any{
		"regularMarketPrice": 110.0, "previousClose": 100.0, "chartPreviousClose": 80.0,
		"regularMarketTime": start + 900, "currency": currency,
		"currentTradingPeriod": map[string]any{"regular": map[string]any{"start": start, "end": start + 23400}},
	}, []int64{start - 3*86400, start - 3*86400 + 23400, start, start + 900},
		[]any{95.0, 100.0, 105.0, 110.0})
}

func finishFinancialTestLoads[T any](c *cache.Cache[T], keys ...string) {
	for _, key := range keys {
		_, _, _ = c.Load(context.Background(), key, func(context.Context) (T, error) {
			var zero T
			return zero, errors.New("test load finished")
		}, true)
	}
}
