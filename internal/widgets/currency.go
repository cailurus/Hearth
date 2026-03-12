package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type CurrencyPair struct {
	From   string    `json:"from"`
	To     string    `json:"to"`
	Rate   float64   `json:"rate"`
	Change float64   `json:"change"` // daily change %
	Series []float64 `json:"series"` // 30-day history
}

type CurrencyResponse struct {
	FetchedAt int64          `json:"fetchedAt"`
	Items     []CurrencyPair `json:"items"`
}

var currencyCache = struct {
	mu    sync.Mutex
	items map[string]CurrencyResponse
}{
	items: map[string]CurrencyResponse{},
}

func currencyCacheKey(pairs []string) string {
	sorted := make([]string, len(pairs))
	copy(sorted, pairs)
	sort.Strings(sorted)
	return strings.Join(sorted, "|")
}

// FetchCurrencyRates fetches current rates and 30-day history for given pairs.
// Pairs are in "USD-CNY" format. Max 4 pairs.
func FetchCurrencyRates(ctx context.Context, pairs []string) (CurrencyResponse, error) {
	if len(pairs) == 0 {
		return CurrencyResponse{FetchedAt: time.Now().Unix(), Items: []CurrencyPair{}}, nil
	}
	if len(pairs) > 4 {
		pairs = pairs[:4]
	}

	const ttl = 30 * time.Minute
	key := currencyCacheKey(pairs)

	currencyCache.mu.Lock()
	if cached, ok := currencyCache.items[key]; ok {
		age := time.Since(time.Unix(cached.FetchedAt, 0))
		if cached.FetchedAt > 0 && age >= 0 && age < ttl {
			currencyCache.mu.Unlock()
			return cached, nil
		}
	}
	currencyCache.mu.Unlock()

	// Parse pairs and group by "from" currency.
	type pairSpec struct {
		from, to string
	}
	var specs []pairSpec
	for _, p := range pairs {
		parts := strings.SplitN(strings.ToUpper(strings.TrimSpace(p)), "-", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			continue
		}
		specs = append(specs, pairSpec{parts[0], parts[1]})
	}
	if len(specs) == 0 {
		return CurrencyResponse{FetchedAt: time.Now().Unix(), Items: []CurrencyPair{}}, nil
	}

	client := &http.Client{Timeout: 10 * time.Second}
	results := make([]CurrencyPair, len(specs))

	var wg sync.WaitGroup
	for i, spec := range specs {
		wg.Add(1)
		go func(idx int, from, to string) {
			defer wg.Done()
			rate, series, change := fetchFrankfurterPair(ctx, client, from, to)
			results[idx] = CurrencyPair{
				From:   from,
				To:     to,
				Rate:   rate,
				Change: change,
				Series: series,
			}
		}(i, spec.from, spec.to)
	}
	wg.Wait()

	out := CurrencyResponse{FetchedAt: time.Now().Unix(), Items: results}

	currencyCache.mu.Lock()
	currencyCache.items[key] = out
	currencyCache.mu.Unlock()

	return out, nil
}

func fetchFrankfurterPair(ctx context.Context, client *http.Client, from, to string) (rate float64, series []float64, change float64) {
	// Fetch latest rate.
	latestURL := fmt.Sprintf("https://api.frankfurter.app/latest?from=%s&to=%s", from, to)
	if r, err := frankfurterGet(ctx, client, latestURL); err == nil {
		if rates, ok := r["rates"].(map[string]any); ok {
			if v, ok := rates[to].(float64); ok {
				rate = v
			}
		}
	}

	// Fetch 30-day history for sparkline.
	now := time.Now()
	startDate := now.AddDate(0, 0, -30).Format("2006-01-02")
	endDate := now.Format("2006-01-02")
	histURL := fmt.Sprintf("https://api.frankfurter.app/%s..%s?from=%s&to=%s", startDate, endDate, from, to)

	if r, err := frankfurterGet(ctx, client, histURL); err == nil {
		if ratesMap, ok := r["rates"].(map[string]any); ok {
			// Sort dates and extract values.
			dates := make([]string, 0, len(ratesMap))
			for d := range ratesMap {
				dates = append(dates, d)
			}
			sort.Strings(dates)
			for _, d := range dates {
				if dayRates, ok := ratesMap[d].(map[string]any); ok {
					if v, ok := dayRates[to].(float64); ok {
						series = append(series, v)
					}
				}
			}

			// Calculate daily change from last two data points.
			if len(series) >= 2 {
				prev := series[len(series)-2]
				last := series[len(series)-1]
				if prev > 0 {
					change = (last - prev) / prev * 100
				}
			}
		}
	}

	return
}

func frankfurterGet(ctx context.Context, client *http.Client, url string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("frankfurter: status " + resp.Status)
	}

	var result map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return result, nil
}
