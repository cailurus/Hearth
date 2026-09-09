package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

func TestYahooStockSessionsAndPriorClose(t *testing.T) {
	start := time.Date(2026, 9, 7, 13, 30, 0, 0, time.UTC).Unix()
	prior := start - 3*86400
	timestamps := []int64{prior - 86400, prior - 86400 + 22500, prior, prior + 22500, start, start + 900}
	closes := []any{80.0, 90.0, 95.0, 100.0, 105.0, 110.0}
	for _, tt := range []struct {
		name, currency string
		now            int64
		currentStart   int64
		previousClose  float64
		count          int
		wantSeries     []float64
		wantSlots      int
		wantChange     float64
	}{
		{"open", "USD", start + 1800, start, 100, 6, []float64{105, 110}, 26, 10},
		{"after close includes today", "USD", start + 25000, start, 100, 6, []float64{105, 110}, 0, 10},
		{"preopen includes Friday", "USD", start - 1800, start, 90, 4, []float64{95, 100}, 0, 100.0 / 9},
		{"weekend includes Friday", "USD", prior + 86400, start, 90, 4, []float64{95, 100}, 0, 100.0 / 9},
		{"next session metadata", "USD", start + 25000, start + 86400, 100, 6, []float64{105, 110}, 0, 10},
		{"derive actual prior session", "USD", start + 1800, start, 0, 6, []float64{105, 110}, 26, 10},
		{"HKD is not USD", "HKD", start + 1800, start, 100, 6, []float64{105, 110}, 26, 10},
	} {
		t.Run(tt.name, func(t *testing.T) {
			meta := map[string]any{
				"regularMarketPrice": closes[tt.count-1], "currency": tt.currency,
				"regularMarketTime": timestamps[tt.count-1],
				"previousClose":     tt.previousClose, "chartPreviousClose": 70,
				"currentTradingPeriod": map[string]any{"regular": map[string]any{
					"start": tt.currentStart, "end": tt.currentStart + 23400,
				}},
			}
			body := financialYahooFixture(t, meta, timestamps[:tt.count], closes[:tt.count])
			quote, err := decodeYahooChart(body, "0700", false, time.Unix(tt.now, 0))
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(quote.Series, tt.wantSeries) || quote.TotalSlots != tt.wantSlots || math.Abs(quote.ChangePct24h-tt.wantChange) > 1e-9 {
				t.Fatalf("wrong session/change: %#v", quote)
			}
			if quote.Currency != tt.currency || quote.ObservedAt != timestamps[tt.count-1] || quote.FetchedAt != tt.now || quote.Source != "yahoo" {
				t.Fatalf("provider metadata lost: %#v", quote)
			}
			data := map[string]any{}
			if err := json.Unmarshal(financialJSON(t, quote), &data); err != nil {
				t.Fatal(err)
			}
			if data["price"] != quote.Price {
				t.Fatal("canonical price is missing")
			}
			if tt.currency == "HKD" {
				if _, exists := data["priceUsd"]; exists {
					t.Fatal("HKD quote incorrectly labeled as USD")
				}
			} else if data["priceUsd"] != quote.Price {
				t.Fatal("legacy USD alias is missing")
			}
		})
	}
}

func TestYahooCryptoUsesLast24HoursAndProviderTimestamp(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	observedAt := now.Add(-10 * time.Minute).Unix()
	var timestamps []int64
	var closes []any
	for i := range 193 {
		timestamps = append(timestamps, observedAt-int64(192-i)*900)
		closes = append(closes, float64(i+100))
	}
	body := financialYahooFixture(t, map[string]any{
		"regularMarketPrice": 292.0, "regularMarketTime": observedAt,
		"currency": "USD", "previousClose": 10.0, "chartPreviousClose": 5.0,
	}, timestamps, closes)
	quote, err := decodeYahooChart(body, "BTC-USD", true, now)
	if err != nil {
		t.Fatal(err)
	}
	if quote.Symbol != "BTC" || len(quote.Series) != 30 || quote.Series[0] != 196 || quote.Series[29] != 292 || quote.TotalSlots != 0 {
		t.Fatalf("not a full rolling 24h window: %#v", quote)
	}
	wantChange := (292.0 - 196) / 196 * 100
	if math.Abs(quote.ChangePct24h-wantChange) > 1e-9 || quote.ObservedAt != observedAt {
		t.Fatalf("wrong 24h baseline or timestamp: %#v", quote)
	}
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		start, _ := strconv.ParseInt(r.URL.Query().Get("period1"), 10, 64)
		end, _ := strconv.ParseInt(r.URL.Query().Get("period2"), 10, 64)
		if end-start != 48*3600 || r.URL.Query().Get("interval") != "15m" {
			t.Errorf("wrong crypto provider range: %s", r.URL)
		}
		return financialResponse(200, string(body)), nil
	})
	if _, err := fetchYahooChart(context.Background(), "BTC", true); err != nil {
		t.Fatal(err)
	}
}

func TestYahooMinorUnitsUseISOCurrency(t *testing.T) {
	for _, tt := range []struct{ provider, iso string }{{"GBp", "GBP"}, {"ZAc", "ZAR"}, {"ILA", "ILS"}} {
		body := financialStockFixture(t, tt.provider)
		now := time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)
		row, err := decodeYahooChart(body, "TEST", false, now)
		if err != nil || row.Currency != tt.iso || row.Price != 1.1 || row.Series[len(row.Series)-1] != 1.1 || row.PriceUSD != 0 {
			t.Fatalf("minor units mislabeled: %#v, %v", row, err)
		}
	}
}

func TestYahooRejectsSuccessfulEmptyAndZeroPayloads(t *testing.T) {
	now := time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)
	for _, tt := range []struct {
		name string
		body []byte
	}{
		{"no result", []byte(`{"chart":{"result":[],"error":null}}`)},
		{"provider error", []byte(`{"chart":{"result":null,"error":{"code":"Not Found","description":"bad symbol"}}}`)},
		{"zero price", financialYahooFixture(t, map[string]any{"currency": "USD", "previousClose": 100}, []int64{now.Unix() - 1}, []any{110.0})},
		{"missing currency", financialYahooFixture(t, map[string]any{"regularMarketPrice": 110, "previousClose": 100}, []int64{now.Unix() - 1}, []any{110.0})},
		{"empty series", financialYahooFixture(t, map[string]any{"currency": "USD", "regularMarketPrice": 110, "previousClose": 100}, nil, nil)},
		{"null closes", financialYahooFixture(t, map[string]any{"currency": "USD", "regularMarketPrice": 110, "previousClose": 100}, []int64{now.Unix() - 1}, []any{nil})},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if quote, err := decodeYahooChart(tt.body, "AAPL", false, now); err == nil {
				t.Fatalf("bad provider payload accepted: %#v", quote)
			}
		})
	}
}

func TestMarketsPartialSourcesConcurrentAndNoZeroCache(t *testing.T) {
	body := financialStockFixture(t, "HKD")
	started, release := make(chan struct{}, 4), make(chan struct{})
	var released sync.Once
	defer released.Do(func() { close(release) })
	var calls atomic.Int32
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		started <- struct{}{}
		<-release
		if strings.HasSuffix(r.URL.Path, "/0700.HK") {
			return financialResponse(200, string(body)), nil
		}
		return financialResponse(503, ""), nil
	})
	type result struct {
		data MarketsResponse
		err  error
	}
	done := make(chan result, 1)
	go func() {
		data, err := FetchMarkets(context.Background(), []string{"0700", "AAPL", "MSFT", "TSLA"})
		done <- result{data, err}
	}()
	for range 4 {
		select {
		case <-started:
		case <-time.After(2 * time.Second):
			t.Fatal("symbols waited serially for previous provider response")
		}
	}
	released.Do(func() { close(release) })
	res := <-done
	if res.err != nil || res.data.Warning == "" || res.data.Items[0].Currency != "HKD" || res.data.Items[0].Price != 110 {
		t.Fatalf("partial quote lost: %#v, %v", res.data, res.err)
	}
	for _, row := range res.data.Items[1:] {
		if row.Error == "" {
			t.Fatalf("failure hidden: %#v", row)
		}
		if _, ok := marketsTTLCache.GetStale("stock:" + row.Symbol); ok {
			t.Fatal("failed quote entered valid cache")
		}
	}
	res.data, res.err = FetchMarkets(context.Background(), []string{"TSLA", "MSFT", "AAPL", "0700"})
	if res.err != nil || res.data.Items[3].Price != 110 || calls.Load() != 4 {
		t.Fatalf("per-symbol cache not reused: %#v, calls=%d, %v", res.data, calls.Load(), res.err)
	}
}

func TestMarketsAllUnavailableIsError(t *testing.T) {
	resetFinancialTestState(t, func(*http.Request) (*http.Response, error) {
		return financialResponse(200, `{"chart":{"result":[]}}`), nil
	})
	res, err := FetchMarkets(context.Background(), []string{"AAPL", "MSFT", "TSLA", "GOOG"})
	if err == nil || res.FetchedAt != 0 {
		t.Fatalf("all failures returned a successful response: %#v, %v", res, err)
	}
	for _, row := range res.Items {
		if row.Error == "" {
			t.Fatalf("missing per-item error: %#v", row)
		}
	}
}

func TestMarketsStaleReturnsImmediatelyAndRetainsPerItem(t *testing.T) {
	started, release := make(chan struct{}, 4), make(chan struct{})
	var released sync.Once
	defer released.Do(func() { close(release) })
	resetFinancialTestState(t, func(*http.Request) (*http.Response, error) {
		started <- struct{}{}
		<-release
		return financialResponse(503, ""), nil
	})
	marketsTTLCache = cache.New[MarketQuote](time.Nanosecond)
	symbols := []string{"AAPL", "MSFT", "TSLA", "GOOG"}
	for _, sym := range symbols {
		marketsTTLCache.Set("stock:"+sym, MarketQuote{
			Symbol: sym, Kind: "stock", Price: 110, PriceUSD: 110, Currency: "USD",
			ObservedAt: 99, FetchedAt: 100, Series: []float64{100, 110}, Source: "yahoo",
		})
	}
	done := make(chan MarketsResponse, 1)
	go func() {
		res, _ := FetchMarkets(context.Background(), symbols)
		done <- res
	}()
	select {
	case res := <-done:
		if !res.Stale || !res.Refreshing || res.FetchedAt != 100 {
			t.Fatalf("wrong stale status: %#v", res)
		}
	case <-time.After(time.Second):
		t.Fatal("stale markets waited for provider")
	}
	for range 4 {
		<-started
	}
	released.Do(func() { close(release) })
	for _, sym := range symbols {
		_, _, _ = marketsTTLCache.Load(context.Background(), "stock:"+sym, func(context.Context) (MarketQuote, error) {
			return MarketQuote{}, errors.New("provider unavailable")
		}, true)
	}
	res, err := FetchMarkets(context.Background(), symbols)
	if err != nil || res.Warning == "" || res.FetchedAt != 100 {
		t.Fatalf("last-good response lost: %#v, %v", res, err)
	}
	for _, row := range res.Items {
		if row.Price != 110 || row.ObservedAt != 99 || row.Error == "" || !row.Stale {
			t.Fatalf("last-good row lost: %#v", row)
		}
	}
}

func TestCoinGeckoFallbackKeyAndLast24Hours(t *testing.T) {
	for _, key := range []string{"", "demo-test-key"} {
		t.Run("key="+key, func(t *testing.T) {
			prices := make([]float64, 168)
			for i := range prices {
				prices[i] = float64(i + 1)
			}
			marketBody := string(financialJSON(t, []any{map[string]any{
				"id": "bitcoin", "symbol": "btc", "name": "Bitcoin", "current_price": 168,
				"price_change_percentage_24h": 4.2, "last_updated": "2026-09-08T12:34:56.789Z",
				"sparkline_in_7d": map[string]any{"price": prices},
			}}))
			resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
				if r.URL.Host == "query1.finance.yahoo.com" {
					return financialResponse(503, ""), nil
				}
				if got := r.Header.Get("X-CG-Demo-API-Key"); got != key {
					t.Errorf("optional key header=%q, want %q", got, key)
				}
				if strings.HasSuffix(r.URL.Path, "/search") {
					return financialResponse(200, `{"coins":[{"id":"bitcoin","symbol":"btc","name":"Bitcoin"}]}`), nil
				}
				if r.URL.Query().Get("vs_currency") != "usd" {
					t.Errorf("unexpected quote currency: %s", r.URL)
				}
				return financialResponse(200, marketBody), nil
			})
			ctx := WithCoinGeckoAPIKey(context.Background(), key)
			t.Cleanup(func() {
				finishFinancialTestLoads(marketsTTLCache, "stock:AAPL", "stock:MSFT", "stock:TSLA", "crypto:BTC-USD:"+coinGeckoScope(ctx))
			})
			res, err := FetchMarkets(ctx, []string{"BTC-USD", "AAPL", "MSFT", "TSLA"})
			if err != nil || (res.Warning == "" && !res.Refreshing) {
				t.Fatalf("fallback/partial failed: %#v, %v", res, err)
			}
			row := res.Items[0]
			wantObserved := time.Date(2026, 9, 8, 12, 34, 56, 0, time.UTC).Unix()
			if row.Symbol != "BTC" || row.Source != "coingecko" || row.Price != 168 || row.PriceUSD != row.Price || row.Currency != "USD" || row.ObservedAt != wantObserved {
				t.Fatalf("fallback metadata lost: %#v", row)
			}
			if len(row.Series) != 24 || row.Series[0] != 145 || row.Series[23] != 168 || row.ChangePct24h != 4.2 {
				t.Fatalf("fallback chart is not last 24h: %#v", row)
			}
		})
	}
}

func TestMarketsCryptoTimeoutReservesCoinGeckoDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(WithCoinGeckoAPIKey(context.Background(), "timeout-fallback-key"), 300*time.Millisecond)
	defer cancel()
	parentDeadline, _ := ctx.Deadline()
	var yahooCalls, geckoCalls atomic.Int32
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "query1.finance.yahoo.com" {
			yahooCalls.Add(1)
			deadline, ok := r.Context().Deadline()
			if !ok || !deadline.Before(parentDeadline) {
				t.Error("Yahoo was allowed to consume the entire crypto loader deadline")
			}
			<-r.Context().Done()
			return nil, r.Context().Err()
		}
		geckoCalls.Add(1)
		if err := ctx.Err(); err != nil {
			t.Errorf("CoinGecko started after parent expired: %v", err)
		}
		if r.Header.Get("X-CG-Demo-API-Key") != "timeout-fallback-key" {
			t.Error("fallback lost the original context's API key")
		}
		if strings.HasSuffix(r.URL.Path, "/search") {
			return financialResponse(200, `{"coins":[{"id":"bitcoin","symbol":"btc","name":"Bitcoin"}]}`), nil
		}
		if deadline, ok := r.Context().Deadline(); !ok || !deadline.Equal(parentDeadline) {
			t.Error("CoinGecko quote did not receive the original parent deadline")
		}
		return financialResponse(200, `[{"id":"bitcoin","symbol":"btc","current_price":100,"price_change_percentage_24h":1,"last_updated":"2026-09-08T12:00:00Z","sparkline_in_7d":{"price":[99,100]}}]`), nil
	})
	quote, err := fetchMarketQuote(ctx, "BTC", true, false)
	if err != nil || ctx.Err() != nil || quote.Source != "coingecko" || quote.Price != 100 {
		t.Fatalf("healthy fallback lost to Yahoo timeout: %#v, error=%v, parent=%v", quote, err, ctx.Err())
	}
	if yahooCalls.Load() != 1 || geckoCalls.Load() != 2 {
		t.Fatalf("unexpected provider calls: Yahoo=%d CoinGecko=%d", yahooCalls.Load(), geckoCalls.Load())
	}
}

func TestMarketsYahooDeadlineCapPreservesStockPath(t *testing.T) {
	for _, crypto := range []bool{false, true} {
		t.Run(fmt.Sprintf("crypto=%v", crypto), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			parentDeadline, _ := ctx.Deadline()
			resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
				if r.URL.Host != "query1.finance.yahoo.com" {
					return financialResponse(429, ""), nil
				}
				deadline, ok := r.Context().Deadline()
				if !ok {
					t.Error("Yahoo request has no deadline")
				} else if crypto {
					remaining := time.Until(deadline)
					if remaining <= 0 || remaining > 5*time.Second {
						t.Errorf("crypto Yahoo attempt not capped at 5s: %s", remaining)
					}
				} else if !deadline.Equal(parentDeadline) {
					t.Error("stock request deadline was shortened")
				}
				return financialResponse(503, ""), nil
			})
			symbol := "AAPL"
			if crypto {
				symbol = "BTC"
			}
			if _, err := fetchMarketQuote(ctx, symbol, crypto, false); err == nil {
				t.Fatal("provider failure became success")
			}
			if ctx.Err() != nil {
				t.Fatalf("provider attempt canceled the parent context: %v", ctx.Err())
			}
		})
	}
}

func TestCoinGeckoSearchCoalescesAndDoesNotConfuseSymbols(t *testing.T) {
	var calls atomic.Int32
	started, release := make(chan struct{}), make(chan struct{})
	var released sync.Once
	defer released.Do(func() { close(release) })
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return financialResponse(200, `{"coins":[{"id":"bitcoin","symbol":"btc","name":"Bitcoin"}]}`), nil
	})
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			coins, err := coinGeckoSearch(context.Background(), " btc ", 10)
			if err != nil || len(coins) != 1 {
				t.Errorf("search failed: %v", err)
			}
		}()
	}
	<-started
	released.Do(func() { close(release) })
	wg.Wait()
	if _, _, err := coinGeckoResolveSymbol(context.Background(), "BTC"); err != nil || calls.Load() != 1 {
		t.Fatalf("resolution did not reuse search: calls=%d, %v", calls.Load(), err)
	}
	if id, _, err := coinGeckoResolveSymbol(context.Background(), "UNKNOWN"); err == nil || id != "" {
		t.Fatalf("nonmatching search result became a different coin: %q, %v", id, err)
	}
}

func TestCoinGeckoRateLimitAndKeyRejectionsDoNotRetry(t *testing.T) {
	for _, tt := range []struct {
		name   string
		status int
		body   string
	}{
		{"rate limit", 429, `{"error":"too many requests"}`},
		{"invalid key", 401, `{"error":"invalid key"}`},
		{"access forbidden", 403, `{"error":"access denied"}`},
		{"HTTP-success key error", 200, `{"status":{"error_code":10010,"error_message":"Invalid API Key"}}`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var calls atomic.Int32
			resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
				calls.Add(1)
				if r.Header.Get("X-CG-Demo-API-Key") != "rejected-test-key" {
					t.Error("key error evaded by dropping authentication")
				}
				res := financialResponse(tt.status, tt.body)
				res.Header.Set("Retry-After", "120")
				return res, nil
			})
			ctx := WithCoinGeckoAPIKey(context.Background(), "rejected-test-key")
			for i := range 3 {
				_, err := coinGeckoSearch(ctx, fmt.Sprintf("different-query-%d", i), 10)
				if err == nil {
					t.Fatal("provider error silently accepted")
				}
				if tt.status == 429 && !strings.Contains(err.Error(), "429") {
					t.Fatalf("rate limiting not explicit: %v", err)
				}
			}
			if calls.Load() != 1 {
				t.Fatalf("aggressive retry after failure: %d calls", calls.Load())
			}
		})
	}
}

func TestMarketSearchPartialErrorsAndNoKeyCompatibility(t *testing.T) {
	var calls atomic.Int32
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if r.Header.Get("X-CG-Demo-API-Key") != "" {
			t.Error("key unexpectedly required")
		}
		if r.URL.Host == "query2.finance.yahoo.com" {
			return financialResponse(200, `{"quotes":[{"symbol":"AAPL","longname":"Apple","quoteType":"EQUITY","exchange":"NMS"}]}`), nil
		}
		return financialResponse(429, ""), nil
	})
	list, err := SearchMarketSymbols(context.Background(), "apple", 12)
	if len(list) != 1 || list[0].Symbol != "AAPL" || err == nil || !strings.Contains(err.Error(), "429") {
		t.Fatalf("partial search concealed error or erased good source: %#v, %v", list, err)
	}
	list, err = SearchMarketSymbols(context.Background(), "apple", 12)
	if len(list) != 1 || err == nil || calls.Load() != 2 {
		t.Fatalf("searches not cached/coalesced: %#v calls=%d %v", list, calls.Load(), err)
	}
}

func TestCoinGeckoRejectsEmptyQuotesAndMissingMetadata(t *testing.T) {
	for _, body := range []string{
		`[]`,
		`[{"id":"bitcoin","current_price":0,"last_updated":"2026-09-08T12:00:00Z","price_change_percentage_24h":0,"sparkline_in_7d":{"price":[1]}}]`,
		`[{"id":"bitcoin","current_price":10,"price_change_percentage_24h":0,"sparkline_in_7d":{"price":[1]}}]`,
		`[{"id":"bitcoin","current_price":10,"last_updated":"2026-09-08T12:00:00Z","price_change_percentage_24h":0,"sparkline_in_7d":{"price":[]}}]`,
		`[{"id":"bitcoin","current_price":10,"last_updated":"2026-09-08T12:00:00Z","sparkline_in_7d":{"price":[1]}}]`,
	} {
		t.Run(body, func(t *testing.T) {
			resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
				if strings.HasSuffix(r.URL.Path, "/search") {
					return financialResponse(200, `{"coins":[{"id":"bitcoin","symbol":"btc","name":"Bitcoin"}]}`), nil
				}
				return financialResponse(200, body), nil
			})
			if rows, err := fetchCoinGecko(context.Background(), []string{"BTC"}); err == nil {
				t.Fatalf("invalid crypto quote accepted: %#v", rows)
			}
		})
	}
}
