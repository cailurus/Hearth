package widgets

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

func frankfurterFixture(r *http.Request) string {
	base := r.URL.Query().Get("from")
	target := r.URL.Query().Get("to")
	if r.URL.Path == "/v1/latest" {
		return fmt.Sprintf(`{"base":%q,"date":"2026-09-08","rates":{%q:7.1}}`, base, target)
	}
	return fmt.Sprintf(`{"base":%q,"rates":{"2026-09-07":{%q:7},"2026-09-08":{%q:7.1}}}`, base, target, target)
}

const frankfurterWeekendHistory = `{"amount":1.0,"base":"USD","start_date":"2026-08-07","end_date":"2026-09-08","rates":{"2026-08-07":{"CNY":6.7476},"2026-08-10":{"CNY":6.7444},"2026-08-11":{"CNY":6.7453},"2026-08-12":{"CNY":6.7432},"2026-08-13":{"CNY":6.743},"2026-08-14":{"CNY":6.7413},"2026-08-17":{"CNY":6.7394},"2026-08-18":{"CNY":6.7423},"2026-08-19":{"CNY":6.7382},"2026-08-20":{"CNY":6.7236},"2026-08-21":{"CNY":6.7206},"2026-08-24":{"CNY":6.7227},"2026-08-25":{"CNY":6.7198},"2026-08-26":{"CNY":6.7205},"2026-08-27":{"CNY":6.7203},"2026-08-28":{"CNY":6.7209},"2026-08-31":{"CNY":6.7197},"2026-09-01":{"CNY":6.7223},"2026-09-02":{"CNY":6.7215},"2026-09-03":{"CNY":6.7191},"2026-09-04":{"CNY":6.7109},"2026-09-07":{"CNY":6.711},"2026-09-08":{"CNY":6.7105}}}`

func TestCurrencyFrankfurterNormalizesWeekendStart(t *testing.T) {
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v1/latest" {
			return financialResponse(200, `{"amount":1.0,"base":"USD","date":"2026-09-08","rates":{"CNY":6.7105}}`), nil
		}
		if r.URL.Path != "/v1/2026-08-09..2026-09-08" {
			t.Errorf("unexpected requested period: %s", r.URL.Path)
		}
		return financialResponse(200, frankfurterWeekendHistory), nil
	})
	before := time.Now().Unix()
	res, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY"})
	after := time.Now().Unix()
	if err != nil {
		t.Fatalf("public v1 working-day normalization rejected: %#v, %v", res, err)
	}
	row := res.Items[0]
	if row.Rate != 6.7105 || row.Date != "2026-09-08" || len(row.Series) != 23 ||
		row.Series[0] != 6.7476 || row.Series[22] != 6.7105 || row.Error != "" {
		t.Fatalf("normalized provider data was changed or lost: %#v", row)
	}
	if row.FetchedAt < before || row.FetchedAt > after || res.FetchedAt != row.FetchedAt {
		t.Fatalf("fetch timestamp does not describe the successful load: %#v", res)
	}
	if math.Abs(row.Change-(6.7105-6.711)/6.711*100) > 1e-10 {
		t.Fatalf("daily change no longer uses the previous reference day: %v", row.Change)
	}
}

func TestCurrencyFrankfurterNormalizedHistoryRemainsBounded(t *testing.T) {
	for _, tt := range []struct {
		name, start, end, rates string
	}{
		{"malformed start", "bad-date", "2026-09-08", `"2026-08-07":{"CNY":7}`},
		{"start too far back", "2026-08-01", "2026-09-08", `"2026-08-01":{"CNY":7}`},
		{"start after request", "2026-08-10", "2026-09-08", `"2026-08-10":{"CNY":7}`},
		{"end mismatch", "2026-08-07", "2026-09-07", `"2026-08-07":{"CNY":7}`},
		{"unbounded old history", "2026-08-07", "2026-09-08", `"1900-01-01":{"CNY":7},"2026-08-07":{"CNY":7}`},
		{"future history", "2026-08-07", "2026-09-08", `"2026-08-07":{"CNY":7},"2026-09-09":{"CNY":7}`},
		{"malformed date", "2026-08-07", "2026-09-08", `"2026-08-99":{"CNY":7}`},
		{"zero boundary rate", "2026-08-07", "2026-09-08", `"2026-08-07":{"CNY":0}`},
		{"declared start absent", "2026-08-07", "2026-09-08", `"2026-08-10":{"CNY":7}`},
		{"multiple earlier reference days", "2026-08-06", "2026-09-08", `"2026-08-06":{"CNY":7},"2026-08-07":{"CNY":7}`},
		{"earlier day without normalized bound", "", "", `"2026-08-07":{"CNY":7}`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/v1/latest" {
					return financialResponse(200, frankfurterFixture(r)), nil
				}
				body := fmt.Sprintf(`{"base":"USD","start_date":%q,"end_date":%q,"rates":{%s,"2026-09-07":{"CNY":7},"2026-09-08":{"CNY":7.1}}}`, tt.start, tt.end, tt.rates)
				return financialResponse(200, body), nil
			})
			if res, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY"}); err == nil || res.Items[0].Error == "" {
				t.Fatalf("invalid normalized history accepted: %#v, %v", res, err)
			}
			if _, ok := currencyTTLCache.GetStale("USD-CNY"); ok {
				t.Fatal("malformed normalized history entered the valid cache")
			}
		})
	}
}

func TestCurrencyFrankfurterNormalizesHolidayStart(t *testing.T) {
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v1/latest" {
			return financialResponse(200, `{"base":"USD","date":"2026-05-06","rates":{"CNY":7.1}}`), nil
		}
		if r.URL.Path != "/v1/2026-04-06..2026-05-06" {
			t.Errorf("unexpected holiday period: %s", r.URL.Path)
		}
		// Easter Monday follows Good Friday and a weekend: the preceding
		// ECB reference day is Thursday, not simply the preceding weekday.
		return financialResponse(200, `{"base":"USD","start_date":"2026-04-02","end_date":"2026-05-06","rates":{"2026-04-02":{"CNY":6.9},"2026-05-05":{"CNY":7},"2026-05-06":{"CNY":7.1}}}`), nil
	})
	res, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY"})
	if err != nil || len(res.Items[0].Series) != 3 || res.Items[0].Date != "2026-05-06" {
		t.Fatalf("holiday normalization rejected: %#v, %v", res, err)
	}
}

func TestCurrencyValidatesPairsAndProviderFailures(t *testing.T) {
	for _, pair := range []string{"", "USD", "US-CNY", "USD-CNY-GBP", "USD-USD", "USD-CN1"} {
		t.Run(pair, func(t *testing.T) {
			resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
				t.Error("invalid pair reached provider")
				return financialResponse(500, ""), nil
			})
			result, err := FetchCurrencyRates(context.Background(), []string{pair})
			if err == nil || len(result.Items) != 1 || result.Items[0].Error == "" || result.FetchedAt != 0 {
				t.Fatalf("invalid pair became success: %#v, %v", result, err)
			}
		})
	}
	for _, tt := range []struct {
		name, latest, history string
		status                int
	}{
		{name: "unsupported", status: 404},
		{name: "missing rate", status: 200, latest: `{"base":"USD","date":"2026-09-08","rates":{}}`},
		{name: "zero rate", status: 200, latest: `{"base":"USD","date":"2026-09-08","rates":{"CNY":0}}`},
		{name: "no reference date", status: 200, latest: `{"base":"USD","rates":{"CNY":7}}`},
		{name: "empty history", status: 200, history: `{"base":"USD","rates":{}}`},
		{name: "missing prior date", status: 200, history: `{"base":"USD","rates":{"2026-09-08":{"CNY":7.1}}}`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
				body := frankfurterFixture(r)
				if r.URL.Path == "/v1/latest" && tt.latest != "" {
					body = tt.latest
				} else if r.URL.Path != "/v1/latest" && tt.history != "" {
					body = tt.history
				}
				return financialResponse(tt.status, body), nil
			})
			result, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY"})
			if err == nil || result.Items[0].Error == "" {
				t.Fatalf("bad payload became success: %#v, %v", result, err)
			}
			if _, ok := currencyTTLCache.GetStale("USD-CNY"); ok {
				t.Fatal("failed pair entered the valid cache")
			}
		})
	}
}

func TestCurrencyPartialSourcesRetainDateAndPairCache(t *testing.T) {
	var goodCalls atomic.Int32
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "api.frankfurter.dev" || !strings.HasPrefix(r.URL.Path, "/v1/") {
			t.Errorf("wrong Frankfurter API: %s", r.URL)
		}
		if r.URL.Query().Get("from") == "EUR" {
			return financialResponse(422, `{"message":"unsupported pair"}`), nil
		}
		goodCalls.Add(1)
		return financialResponse(200, frankfurterFixture(r)), nil
	})
	res, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY", "EUR-CNY"})
	if err != nil || res.Warning == "" || res.Items[0].Rate != 7.1 || res.Items[1].Error == "" {
		t.Fatalf("partial results lost: %#v, %v", res, err)
	}
	good := res.Items[0]
	if good.Date != "2026-09-08" || good.FetchedAt == 0 || res.FetchedAt != good.FetchedAt || len(good.Series) != 2 || good.Change <= 0 {
		t.Fatalf("reference metadata lost: %#v", res)
	}
	reordered, err := FetchCurrencyRates(context.Background(), []string{"EUR-CNY", "USD-CNY"})
	if err != nil || reordered.Items[1].Rate != 7.1 || goodCalls.Load() != 2 {
		t.Fatalf("pair cache depends on widget order: %#v, calls=%d, %v", reordered, goodCalls.Load(), err)
	}
}

func TestCurrencyStaleReturnsBeforeRefreshAndKeepsLastGood(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var released sync.Once
	defer released.Do(func() { close(release) })
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		close(started)
		<-release
		return financialResponse(404, `{"message":"unsupported pair"}`), nil
	})
	currencyTTLCache = cache.New[CurrencyPair](time.Nanosecond)
	good := CurrencyPair{From: "USD", To: "CNY", Rate: 7, Series: []float64{6.9, 7}, Date: "2026-09-07", FetchedAt: 100}
	currencyTTLCache.Set("USD-CNY", good)
	done := make(chan CurrencyResponse, 1)
	go func() {
		res, _ := FetchCurrencyRates(context.Background(), []string{"USD-CNY"})
		done <- res
	}()
	select {
	case res := <-done:
		if res.Items[0].Rate != 7 || !res.Stale || !res.Refreshing || res.FetchedAt != 100 {
			t.Fatalf("bad stale response: %#v", res)
		}
	case <-time.After(time.Second):
		t.Fatal("stale data waited for provider")
	}
	<-started
	released.Do(func() { close(release) })
	_, state, err := currencyTTLCache.Load(context.Background(), "USD-CNY", func(context.Context) (CurrencyPair, error) {
		return CurrencyPair{}, errors.New("unsupported pair")
	}, true)
	if err != nil || state.Err == nil {
		t.Fatalf("last-good load lost refresh error: %#v, %v", state, err)
	}
	res, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY"})
	if err != nil || res.Items[0].Rate != good.Rate || res.Items[0].Error == "" || res.Warning == "" || res.FetchedAt != 100 {
		t.Fatalf("failed refresh erased last-good data: %#v, %v", res, err)
	}
}

func TestCurrencyIndependentRequestsAreConcurrentAndCoalesced(t *testing.T) {
	started, release := make(chan struct{}, 4), make(chan struct{})
	var released sync.Once
	defer released.Do(func() { close(release) })
	var calls, active, peak atomic.Int32
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		current := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); current > old; old = peak.Load() {
			if peak.CompareAndSwap(old, current) {
				break
			}
		}
		if r.URL.Path == "/v1/latest" {
			started <- struct{}{}
			<-release
		}
		return financialResponse(200, frankfurterFixture(r)), nil
	})
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY", "EUR-CNY", "GBP-CNY", "CAD-CNY"})
			if err != nil {
				t.Errorf("fetch failed: %v", err)
			}
		}()
	}
	for range 4 {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("independent pairs serialized")
		}
	}
	released.Do(func() { close(release) })
	wg.Wait()
	if calls.Load() != 8 || peak.Load() != 4 {
		t.Fatalf("coalescing/concurrency mismatch: calls=%d peak=%d", calls.Load(), peak.Load())
	}
}

func TestCurrencyPersistenceDoesNotPersistYahoo(t *testing.T) {
	resetFinancialTestState(t, func(r *http.Request) (*http.Response, error) {
		return financialResponse(200, frankfurterFixture(r)), nil
	})
	root := fmt.Sprintf(".financial-persistence-test-%d", time.Now().UnixNano())
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	if err := ConfigureFinancialPersistence(root); err != nil {
		t.Fatal(err)
	}
	first, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY"})
	if err != nil {
		t.Fatal(err)
	}
	marketsTTLCache.Set("stock:AAPL", MarketQuote{Symbol: "AAPL", Price: 100, Currency: "USD", Source: "yahoo"})
	dirs, err := os.ReadDir(root)
	if err != nil || len(dirs) != 1 || dirs[0].Name() != "frankfurter-v1" {
		t.Fatalf("unexpected financial disk cache: %v, %v", dirs, err)
	}
	files, err := os.ReadDir(filepath.Join(root, "frankfurter-v1"))
	if err != nil || len(files) != 1 {
		t.Fatalf("missing Frankfurter snapshot: %v, %v", files, err)
	}
	currencyTTLCache = newCurrencyCache()
	if err := ConfigureFinancialPersistence(root); err != nil {
		t.Fatal(err)
	}
	DefaultClient = &http.Client{Transport: financialRoundTripper(func(*http.Request) (*http.Response, error) {
		t.Error("persisted valid currency rate unexpectedly refetched")
		return nil, errors.New("offline")
	})}
	reloaded, err := FetchCurrencyRates(context.Background(), []string{"USD-CNY"})
	if err != nil || reloaded.Items[0].Rate != first.Items[0].Rate || reloaded.Items[0].Date != first.Items[0].Date || reloaded.FetchedAt != first.FetchedAt {
		t.Fatalf("persistent reference rate lost: %#v, %v", reloaded, err)
	}
}
