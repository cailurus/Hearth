package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

type CurrencyPair struct {
	From      string    `json:"from"`
	To        string    `json:"to"`
	Rate      float64   `json:"rate"`
	Change    float64   `json:"change"`
	Series    []float64 `json:"series"`
	Date      string    `json:"date"`
	FetchedAt int64     `json:"fetchedAt"`
	Error     string    `json:"error,omitempty"`
	Stale     bool      `json:"stale,omitempty"`
	Pending   bool      `json:"pending,omitempty"`
}

type CurrencyResponse struct {
	DataStatus
	FetchedAt int64          `json:"fetchedAt"`
	Items     []CurrencyPair `json:"items"`
}

var currencyTTLCache = newCurrencyCache()

const (
	financialLoadTimeout = 12 * time.Second
	financialPartialWait = 20 * time.Millisecond
)

func newCurrencyCache() *cache.Cache[CurrencyPair] {
	c := cache.New[CurrencyPair](30 * time.Minute)
	c.SetMaxStale(7 * 24 * time.Hour)
	c.SetLoadTimeout(financialLoadTimeout)
	return c
}

// ConfigureFinancialPersistence persists only Frankfurter reference rates.
// Yahoo and CoinGecko data remain exclusively in bounded in-memory caches.
func ConfigureFinancialPersistence(root string) error {
	if strings.TrimSpace(root) == "" {
		return errors.New("financial cache directory is required")
	}
	return currencyTTLCache.SetPersistence(filepath.Join(root, "frankfurter-v1"))
}

// Financial providers share a small concurrency budget, including background refreshes.
var financialRequestSlots = make(chan struct{}, 4)

func financialRequest(ctx context.Context, req *http.Request, before ...func() error) ([]byte, http.Header, int, error) {
	select {
	case financialRequestSlots <- struct{}{}:
		defer func() { <-financialRequestSlots }()
	case <-ctx.Done():
		return nil, nil, 0, ctx.Err()
	}
	for _, check := range before {
		if err := check(); err != nil {
			return nil, nil, 0, err
		}
	}
	resp, err := DefaultClient.Do(req)
	if err != nil {
		return nil, nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	return body, resp.Header, resp.StatusCode, err
}

func validFinancialValue(v float64) bool {
	return v > 0 && !math.IsNaN(v) && !math.IsInf(v, 0)
}

func validCurrencyCode(code string) bool {
	if len(code) != 3 {
		return false
	}
	for _, c := range code {
		if c < 'A' || c > 'Z' {
			return false
		}
	}
	return true
}

type financialLoad[T any] struct {
	key    string
	loader func(context.Context) (T, error)
}

type financialResult[T any] struct {
	value   T
	state   cache.State
	err     error
	pending bool
}

// At most four rows are requested. Buffered completions and independent deadlines
// let their coalesced loads finish after a partial response or caller cancellation.
func loadFinancialRows[T any](ctx context.Context, c *cache.Cache[T], loads []financialLoad[T], usable func(T) bool, force bool) []financialResult[T] {
	results := make([]financialResult[T], len(loads))
	type completion struct {
		index int
		row   financialResult[T]
	}
	done := make(chan completion, len(loads))
	remaining := 0
	haveData := false
	for i, load := range loads {
		if load.loader == nil {
			continue
		}
		if err := ctx.Err(); err != nil {
			results[i].err = err
			continue
		}
		if value, ok := c.GetStale(load.key); ok && usable(value) {
			_, fresh := c.Get(load.key)
			results[i].value = value
			results[i].state.Stale = !fresh
			haveData = true
		}
		results[i].pending = true
		results[i].state.Refreshing = true
		remaining++
		go func(i int, load financialLoad[T]) {
			loadCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), financialLoadTimeout)
			defer cancel()
			value, state, err := c.Load(loadCtx, load.key, load.loader, force)
			done <- completion{i, financialResult[T]{value: value, state: state, err: err}}
		}(i, load)
	}
	wait := financialLoadTimeout + financialPartialWait
	if haveData {
		wait = financialPartialWait
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for remaining > 0 {
		select {
		case result := <-done:
			results[result.index] = result.row
			remaining--
			if !haveData && usable(result.row.value) {
				haveData = true
				timer.Reset(financialPartialWait)
			}
		case <-ctx.Done():
			return results
		case <-timer.C:
			return results
		}
	}
	return results
}

// FetchCurrencyRates fetches independent "USD-CNY" pairs (at most four).
// Only complete, validated reference rates and histories enter the cache.
func FetchCurrencyRates(ctx context.Context, pairs []string, force ...bool) (CurrencyResponse, error) {
	if len(pairs) > 4 {
		pairs = pairs[:4]
	}
	out := CurrencyResponse{Items: make([]CurrencyPair, len(pairs))}
	loads := make([]financialLoad[CurrencyPair], len(pairs))
	for i, raw := range pairs {
		pair := strings.ToUpper(strings.TrimSpace(raw))
		parts := strings.Split(pair, "-")
		if len(parts) != 2 || !validCurrencyCode(parts[0]) || !validCurrencyCode(parts[1]) || parts[0] == parts[1] {
			out.Items[i] = CurrencyPair{From: pair, Error: "invalid currency pair: expected distinct ISO codes, e.g. USD-CNY"}
			continue
		}
		out.Items[i] = CurrencyPair{From: parts[0], To: parts[1]}
		loads[i] = financialLoad[CurrencyPair]{
			key: pair,
			loader: func(ctx context.Context) (CurrencyPair, error) {
				return fetchFrankfurterPair(ctx, parts[0], parts[1])
			},
		}
	}
	results := loadFinancialRows(ctx, currencyTTLCache, loads, func(row CurrencyPair) bool {
		return validFinancialValue(row.Rate)
	}, len(force) > 0 && force[0])

	var warnings []string
	available := 0
	for i, result := range results {
		row := out.Items[i]
		if validFinancialValue(result.value.Rate) {
			row = result.value
		}
		if result.err != nil {
			row.Error = result.err.Error()
		} else if result.state.Err != nil {
			row.Error = result.state.Err.Error()
		}
		row.Stale = result.state.Stale
		row.Pending = result.pending && !validFinancialValue(row.Rate)
		out.Items[i] = row
		status := statusFromCache(result.state)
		out.Stale = out.Stale || status.Stale
		out.Refreshing = out.Refreshing || status.Refreshing
		if row.Error != "" {
			warnings = append(warnings, row.From+"-"+row.To+": "+row.Error)
		}
		if validFinancialValue(row.Rate) {
			available++
			if out.FetchedAt == 0 || row.FetchedAt < out.FetchedAt {
				out.FetchedAt = row.FetchedAt
			}
		}
	}
	out.Warning = strings.Join(warnings, "; ")
	if available == 0 {
		return out, errors.New("currency: all requested pairs are unavailable")
	}
	return out, nil
}

const frankfurterBaseURL = "https://api.frankfurter.dev/v1"

func fetchFrankfurterPair(ctx context.Context, from, to string) (CurrencyPair, error) {
	var latest struct {
		Base  string             `json:"base"`
		Date  string             `json:"date"`
		Rates map[string]float64 `json:"rates"`
	}
	latestURL := fmt.Sprintf("%s/latest?from=%s&to=%s", frankfurterBaseURL, from, to)
	if err := frankfurterGet(ctx, latestURL, &latest); err != nil {
		return CurrencyPair{}, err
	}
	date, err := time.Parse("2006-01-02", latest.Date)
	if err != nil || latest.Base != from || !validFinancialValue(latest.Rates[to]) {
		return CurrencyPair{}, fmt.Errorf("frankfurter: invalid or unsupported pair %s-%s", from, to)
	}

	var history struct {
		Base      string                        `json:"base"`
		StartDate string                        `json:"start_date"`
		EndDate   string                        `json:"end_date"`
		Rates     map[string]map[string]float64 `json:"rates"`
	}
	start := date.AddDate(0, 0, -30)
	startDate := start.Format("2006-01-02")
	histURL := fmt.Sprintf("%s/%s..%s?from=%s&to=%s", frankfurterBaseURL, startDate, latest.Date, from, to)
	if err := frankfurterGet(ctx, histURL, &history); err != nil {
		return CurrencyPair{}, err
	}
	if history.Base != from || len(history.Rates) == 0 {
		return CurrencyPair{}, errors.New("frankfurter: missing reference history")
	}
	// v1 moves a weekend/holiday start to the preceding reference day and
	// declares it in start_date. Allow a bounded calendar gap, not arbitrary
	// older history, and retain that single boundary observation.
	historyStart := startDate
	if history.StartDate != "" {
		normalized, err := time.Parse("2006-01-02", history.StartDate)
		if err != nil || normalized.Before(start.AddDate(0, 0, -7)) || normalized.After(start) {
			return CurrencyPair{}, errors.New("frankfurter: invalid reference period")
		}
		historyStart = history.StartDate
	}
	if history.EndDate != "" && history.EndDate != latest.Date {
		return CurrencyPair{}, errors.New("frankfurter: invalid reference period")
	}
	dates := make([]string, 0, len(history.Rates))
	for d, rates := range history.Rates {
		if _, err := time.Parse("2006-01-02", d); err != nil || d < historyStart || d > latest.Date ||
			(d < startDate && d != historyStart) || !validFinancialValue(rates[to]) {
			return CurrencyPair{}, errors.New("frankfurter: invalid reference history")
		}
		dates = append(dates, d)
	}
	sort.Strings(dates)
	if history.StartDate != "" && dates[0] != history.StartDate {
		return CurrencyPair{}, errors.New("frankfurter: missing history boundary")
	}
	series := make([]float64, 0, len(dates))
	var previous float64
	for _, d := range dates {
		series = append(series, history.Rates[d][to])
		if d < latest.Date {
			previous = history.Rates[d][to]
		}
	}
	if !validFinancialValue(previous) || dates[len(dates)-1] != latest.Date {
		return CurrencyPair{}, errors.New("frankfurter: incomplete reference history")
	}
	rate := latest.Rates[to]
	return CurrencyPair{
		From: from, To: to, Rate: rate, Series: series,
		Change: (rate - previous) / previous * 100,
		Date:   latest.Date, FetchedAt: time.Now().Unix(),
	}, nil
}

func frankfurterGet(ctx context.Context, endpoint string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Hearth/1.0")
	body, _, status, err := financialRequest(ctx, req)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("frankfurter: status=%d", status)
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return fmt.Errorf("frankfurter: invalid response: %w", err)
	}
	return nil
}
