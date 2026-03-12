package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

type QuoteResponse struct {
	Text      string `json:"text"`
	Author    string `json:"author"`
	FetchedAt int64  `json:"fetchedAt"`
}

var quoteTTLCache = cache.New[QuoteResponse](24 * time.Hour)

const quoteKey = "daily"

// FetchDailyQuote fetches the quote of the day from ZenQuotes with 24h cache.
func FetchDailyQuote(ctx context.Context) (QuoteResponse, error) {
	if cached, ok := quoteTTLCache.Get(quoteKey); ok {
		return cached, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://zenquotes.io/api/today", nil)
	if err != nil {
		return staleQuote(err)
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	resp, err := DefaultClient.Do(req)
	if err != nil {
		return staleQuote(err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return staleQuote(err)
	}
	if resp.StatusCode != http.StatusOK {
		return staleQuote(errors.New("zenquotes: status " + resp.Status))
	}

	var items []struct {
		Q string `json:"q"`
		A string `json:"a"`
	}
	if err := json.Unmarshal(body, &items); err != nil {
		return staleQuote(err)
	}
	if len(items) == 0 {
		return staleQuote(errors.New("zenquotes: empty response"))
	}

	result := QuoteResponse{
		Text:      strings.TrimSpace(items[0].Q),
		Author:    strings.TrimSpace(items[0].A),
		FetchedAt: time.Now().Unix(),
	}
	quoteTTLCache.Set(quoteKey, result)
	return result, nil
}

func staleQuote(err error) (QuoteResponse, error) {
	if cached, ok := quoteTTLCache.GetStale(quoteKey); ok {
		return cached, nil
	}
	return QuoteResponse{}, err
}
