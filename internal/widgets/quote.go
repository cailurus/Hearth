package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type QuoteResponse struct {
	Text      string `json:"text"`
	Author    string `json:"author"`
	FetchedAt int64  `json:"fetchedAt"`
}

var quoteCache struct {
	mu   sync.Mutex
	data *QuoteResponse
}

// FetchDailyQuote fetches the quote of the day from ZenQuotes with 24h cache.
func FetchDailyQuote(ctx context.Context) (QuoteResponse, error) {
	const ttl = 24 * time.Hour

	quoteCache.mu.Lock()
	if quoteCache.data != nil {
		age := time.Since(time.Unix(quoteCache.data.FetchedAt, 0))
		if age >= 0 && age < ttl {
			cached := *quoteCache.data
			quoteCache.mu.Unlock()
			return cached, nil
		}
	}
	quoteCache.mu.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://zenquotes.io/api/today", nil)
	if err != nil {
		return returnStaleQuote(err)
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return returnStaleQuote(err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return returnStaleQuote(err)
	}
	if resp.StatusCode != http.StatusOK {
		return returnStaleQuote(errors.New("zenquotes: status " + resp.Status))
	}

	var items []struct {
		Q string `json:"q"`
		A string `json:"a"`
	}
	if err := json.Unmarshal(body, &items); err != nil {
		return returnStaleQuote(err)
	}
	if len(items) == 0 {
		return returnStaleQuote(errors.New("zenquotes: empty response"))
	}

	result := QuoteResponse{
		Text:      strings.TrimSpace(items[0].Q),
		Author:    strings.TrimSpace(items[0].A),
		FetchedAt: time.Now().Unix(),
	}

	quoteCache.mu.Lock()
	quoteCache.data = &result
	quoteCache.mu.Unlock()

	return result, nil
}

func returnStaleQuote(err error) (QuoteResponse, error) {
	quoteCache.mu.Lock()
	defer quoteCache.mu.Unlock()
	if quoteCache.data != nil {
		return *quoteCache.data, nil
	}
	return QuoteResponse{}, err
}
