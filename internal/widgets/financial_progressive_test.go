package widgets

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func financialWithin200ms[T any](t *testing.T, fetch func() (T, error)) (T, error) {
	t.Helper()
	type result struct {
		value T
		err   error
	}
	done := make(chan result, 1)
	start := time.Now()
	go func() {
		value, err := fetch()
		done <- result{value, err}
	}()
	select {
	case result := <-done:
		if elapsed := time.Since(start); elapsed >= 200*time.Millisecond {
			t.Fatalf("financial response took %s", elapsed)
		}
		return result.value, result.err
	case <-time.After(200 * time.Millisecond):
		t.Fatal("useful financial data waited for a slow sibling")
		var zero T
		return zero, context.DeadlineExceeded
	}
}

func TestCurrencyCachedPairDoesNotWaitForColdSibling(t *testing.T) {
	release := make(chan struct{})
	var once sync.Once
	var calls atomic.Int32
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if deadline, ok := r.Context().Deadline(); !ok || time.Until(deadline) > 12*time.Second {
			t.Error("financial provider load is not bounded to 12 seconds")
		}
		if r.URL.Path == "/v1/latest" {
			<-release
		}
		if err := r.Context().Err(); err != nil {
			t.Errorf("partial response canceled its shared provider load: %v", err)
			return nil, err
		}
		return financialResponse(200, frankfurterFixture(r)), nil
	})
	t.Cleanup(func() {
		once.Do(func() { close(release) })
		finishFinancialTestLoads(currencyTTLCache, "USD-CNY", "EUR-CNY")
	})
	currencyTTLCache.Set("USD-CNY", CurrencyPair{
		From: "USD", To: "CNY", Rate: 7, Series: []float64{6.9, 7}, Date: "2026-09-07", FetchedAt: 123,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	first, err := financialWithin200ms(t, func() (CurrencyResponse, error) {
		return FetchCurrencyRates(ctx, []string{"USD-CNY", "EUR-CNY"})
	})
	if err != nil || !first.Refreshing || first.Warning != "" || first.FetchedAt != 123 ||
		first.Items[0].Rate != 7 || first.Items[0].Pending || !first.Items[1].Pending || first.Items[1].Error != "" {
		t.Fatalf("incorrect warm/pending response: %#v, %v", first, err)
	}
	cancel()
	for range 2 {
		res, err := financialWithin200ms(t, func() (CurrencyResponse, error) {
			return FetchCurrencyRates(context.Background(), []string{"USD-CNY", "EUR-CNY"})
		})
		if err != nil || !res.Items[1].Pending {
			t.Fatalf("pending poll failed: %#v, %v", res, err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("pending polls did not coalesce: calls=%d", calls.Load())
	}
	once.Do(func() { close(release) })
	_, _, err = currencyTTLCache.Load(context.Background(), "EUR-CNY", func(ctx context.Context) (CurrencyPair, error) {
		return fetchFrankfurterPair(ctx, "EUR", "CNY")
	})
	if err != nil {
		t.Fatal(err)
	}
	res, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY", "EUR-CNY"})
	if err != nil || res.Refreshing || res.Items[1].Pending || res.Items[1].Rate != 7.1 || calls.Load() != 2 {
		t.Fatalf("background pair did not become available: %#v calls=%d, %v", res, calls.Load(), err)
	}
	if !first.Items[1].Pending || first.Items[1].Rate != 0 {
		t.Fatal("background completion mutated an already returned response")
	}
}

func TestMarketsCachedSymbolDoesNotWaitForColdSibling(t *testing.T) {
	body := financialStockFixture(t, "USD")
	release := make(chan struct{})
	var once sync.Once
	var calls atomic.Int32
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		<-release
		if err := r.Context().Err(); err != nil {
			t.Errorf("partial response canceled a shared market load: %v", err)
			return nil, err
		}
		return financialResponse(200, string(body)), nil
	})
	t.Cleanup(func() {
		once.Do(func() { close(release) })
		finishFinancialTestLoads(marketsTTLCache, "stock:AAPL", "stock:MSFT", "stock:TSLA", "stock:GOOG")
	})
	for _, symbol := range []string{"AAPL", "MSFT", "TSLA"} {
		marketsTTLCache.Set("stock:"+symbol, MarketQuote{
			Symbol: symbol, Kind: "stock", Price: 100, PriceUSD: 100, Currency: "USD",
			ObservedAt: 122, FetchedAt: 123, Series: []float64{99, 100}, Source: "yahoo",
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	symbols := []string{"AAPL", "MSFT", "TSLA", "GOOG"}
	first, err := financialWithin200ms(t, func() (MarketsResponse, error) {
		return FetchMarkets(ctx, symbols)
	})
	if err != nil || !first.Refreshing || first.Warning != "" || first.FetchedAt != 123 ||
		first.Items[0].Price != 100 || first.Items[0].Pending || !first.Items[3].Pending || first.Items[3].Error != "" {
		t.Fatalf("incorrect warm/pending markets: %#v, %v", first, err)
	}
	cancel()
	for range 2 {
		res, err := financialWithin200ms(t, func() (MarketsResponse, error) {
			return FetchMarkets(context.Background(), symbols)
		})
		if err != nil || !res.Items[3].Pending {
			t.Fatalf("pending market poll failed: %#v, %v", res, err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("market polls did not coalesce: %d calls", calls.Load())
	}
	once.Do(func() { close(release) })
	_, _, err = marketsTTLCache.Load(context.Background(), "stock:GOOG", func(ctx context.Context) (MarketQuote, error) {
		return fetchYahooChart(ctx, "GOOG", false)
	})
	if err != nil {
		t.Fatal(err)
	}
	res, err := FetchMarkets(context.Background(), symbols)
	if err != nil || res.Refreshing || res.Items[3].Pending || res.Items[3].Price != 110 || calls.Load() != 1 {
		t.Fatalf("background quote did not become available: %#v, calls=%d, %v", res, calls.Load(), err)
	}
	if !first.Items[3].Pending || first.Items[3].Price != 0 {
		t.Fatal("background completion mutated the original market response")
	}
}

func TestCurrencyFastColdPairDoesNotWaitForSlowColdPair(t *testing.T) {
	release := make(chan struct{})
	var once sync.Once
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Query().Get("from") == "EUR" {
			<-release
		}
		return financialResponse(200, frankfurterFixture(r)), nil
	})
	t.Cleanup(func() {
		once.Do(func() { close(release) })
		finishFinancialTestLoads(currencyTTLCache, "USD-CNY", "EUR-CNY")
	})
	res, err := financialWithin200ms(t, func() (CurrencyResponse, error) {
		return FetchCurrencyRates(context.Background(), []string{"USD-CNY", "EUR-CNY"})
	})
	if err != nil || !res.Refreshing || res.Items[0].Rate != 7.1 || !res.Items[1].Pending || res.Items[1].Error != "" {
		t.Fatalf("fast cold row was hidden: %#v, %v", res, err)
	}
}

func TestCurrencyForcedWarmDataRemainsPrompt(t *testing.T) {
	release := make(chan struct{})
	var once sync.Once
	var calls atomic.Int32
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		<-release
		return financialResponse(200, frankfurterFixture(r)), nil
	})
	t.Cleanup(func() {
		once.Do(func() { close(release) })
		finishFinancialTestLoads(currencyTTLCache, "USD-CNY")
	})
	currencyTTLCache.Set("USD-CNY", CurrencyPair{
		From: "USD", To: "CNY", Rate: 7, Series: []float64{6.9, 7}, Date: "2026-09-07", FetchedAt: 123,
	})
	res, err := financialWithin200ms(t, func() (CurrencyResponse, error) {
		return FetchCurrencyRates(context.Background(), []string{"USD-CNY"}, true)
	})
	if err != nil || res.Items[0].Rate != 7 || res.Items[0].Pending || !res.Refreshing || calls.Load() != 1 {
		t.Fatalf("force blocked or bypassed useful cached data: %#v, calls=%d, %v", res, calls.Load(), err)
	}
}

func TestCurrencyForceBypassesCacheFailureBackoff(t *testing.T) {
	var online atomic.Bool
	var calls atomic.Int32
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if !online.Load() {
			return financialResponse(503, ""), nil
		}
		return financialResponse(200, frankfurterFixture(r)), nil
	})
	if _, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY"}); err == nil {
		t.Fatal("cold failure became success")
	}
	online.Store(true)
	if _, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY"}); err == nil || calls.Load() != 1 {
		t.Fatal("ordinary retry ignored cache backoff")
	}
	res, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY"}, true)
	if err != nil || res.Items[0].Rate != 7.1 || res.Items[0].Pending || calls.Load() != 3 {
		t.Fatalf("forced refresh did not bypass failure backoff: %#v, calls=%d, %v", res, calls.Load(), err)
	}
}

func TestMarketsForceBypassesCacheFailureBackoff(t *testing.T) {
	body := financialStockFixture(t, "USD")
	var online atomic.Bool
	var calls atomic.Int32
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if !online.Load() {
			return financialResponse(503, ""), nil
		}
		return financialResponse(200, string(body)), nil
	})
	symbols := []string{"AAPL", "MSFT", "TSLA", "GOOG"}
	t.Cleanup(func() {
		finishFinancialTestLoads(marketsTTLCache, "stock:AAPL", "stock:MSFT", "stock:TSLA", "stock:GOOG")
	})
	if _, err := FetchMarkets(context.Background(), symbols); err == nil {
		t.Fatal("all failed market rows became success")
	}
	online.Store(true)
	if _, err := FetchMarkets(context.Background(), symbols); err == nil || calls.Load() != 4 {
		t.Fatal("ordinary market retry ignored failure backoff")
	}
	res, err := FetchMarkets(context.Background(), symbols, true)
	if err != nil || res.FetchedAt == 0 {
		t.Fatalf("force did not return recovered rows: %#v, %v", res, err)
	}
	for _, symbol := range symbols {
		_, _, err := marketsTTLCache.Load(context.Background(), "stock:"+symbol, func(ctx context.Context) (MarketQuote, error) {
			return fetchYahooChart(ctx, symbol, false)
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	res, err = FetchMarkets(context.Background(), symbols)
	if err != nil || res.Refreshing || res.Warning != "" || calls.Load() != 8 {
		t.Fatalf("forced market loads did not finish: %#v, calls=%d, %v", res, calls.Load(), err)
	}
}

func TestFinancialAllColdTimeoutsAreErrors(t *testing.T) {
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	currencyTTLCache.SetLoadTimeout(30 * time.Millisecond)
	res, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY", "EUR-CNY"})
	if err == nil || res.FetchedAt != 0 || res.Refreshing {
		t.Fatalf("all timed-out rows became pending success: %#v, %v", res, err)
	}
	for _, row := range res.Items {
		if row.Pending || row.Error == "" {
			t.Fatalf("completed failure mislabeled pending: %#v", row)
		}
	}
}

func TestCoinGeckoForceBypassesCacheButNotProviderCooldown(t *testing.T) {
	for _, status := range []int{503, 429} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var calls atomic.Int32
			resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
				if calls.Add(1) == 1 {
					return financialResponse(status, ""), nil
				}
				if strings.HasSuffix(r.URL.Path, "/search") {
					return financialResponse(200, `{"coins":[{"id":"bitcoin","symbol":"btc","name":"Bitcoin"}]}`), nil
				}
				return financialResponse(200, `[{"id":"bitcoin","symbol":"btc","current_price":100,"price_change_percentage_24h":1,"last_updated":"2026-09-08T12:00:00Z","sparkline_in_7d":{"price":[99,100]}}]`), nil
			})
			if _, err := fetchCoinGecko(context.Background(), []string{"BTC"}); err == nil {
				t.Fatal("provider failure became successful search")
			}
			rows, err := fetchCoinGecko(context.Background(), []string{"BTC"}, true)
			if status == 429 {
				if err == nil || !strings.Contains(err.Error(), "429") || calls.Load() != 1 {
					t.Fatalf("force bypassed CoinGecko cooldown: calls=%d, %v", calls.Load(), err)
				}
			} else if err != nil || len(rows) != 1 || calls.Load() != 3 {
				t.Fatalf("force did not reach nested symbol search: %#v, calls=%d, %v", rows, calls.Load(), err)
			}
		})
	}
}

func TestFinancialPersistenceRejectsEmptyRoot(t *testing.T) {
	for _, root := range []string{"", " \t\n "} {
		if err := ConfigureFinancialPersistence(root); err == nil {
			t.Fatal("empty financial persistence directory was accepted")
		}
	}
}

func TestFinancialCanceledColdRequestDoesNotStartLoads(t *testing.T) {
	resetFinancialTestState(t, func(*http.Request) (*http.Response, error) {
		t.Error("already-canceled request started a new provider load")
		return nil, errors.New("unexpected provider request")
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := FetchCurrencyRates(ctx, []string{"USD-CNY"}); err == nil {
		t.Fatal("canceled cold request became success")
	}
}
