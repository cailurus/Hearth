package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type QuoteResponse struct {
	DataStatus
	Text      string `json:"text"`
	Author    string `json:"author"`
	Source    string `json:"source"`
	SourceURL string `json:"sourceUrl"`
	FetchedAt int64  `json:"fetchedAt"`
}

var quoteTTLCache = newFeedCache[QuoteResponse](24*time.Hour, 7*24*time.Hour)

// FetchDailyQuote caches one provider response per language for 24 hours.
// Omitting language retains the original English provider.
func FetchDailyQuote(ctx context.Context, language ...string) (QuoteResponse, error) {
	lang := "en"
	if len(language) > 0 && strings.HasPrefix(strings.ToLower(strings.TrimSpace(language[0])), "zh") {
		lang = "zh"
	}
	return loadDailyQuote(ctx, lang, false)
}

func RefreshDailyQuote(ctx context.Context, language string) (QuoteResponse, error) {
	return loadDailyQuote(ctx, normalizeGeoLanguage(language), true)
}

func loadDailyQuote(ctx context.Context, lang string, force bool) (QuoteResponse, error) {
	result, state, err := quoteTTLCache.Load(ctx, lang, func(ctx context.Context) (QuoteResponse, error) {
		return fetchQuote(ctx, lang)
	}, force)
	result.DataStatus = statusFromCache(state)
	if !state.FetchedAt.IsZero() {
		result.FetchedAt = state.FetchedAt.Unix()
	}
	return result, err
}

func fetchQuote(ctx context.Context, language string) (QuoteResponse, error) {
	endpoint, source, sourceURL := "https://zenquotes.io/api/today", "ZenQuotes", "https://zenquotes.io/"
	if language == "zh" {
		endpoint, source, sourceURL = "https://v1.hitokoto.cn/?c=i", "Hitokoto", "https://hitokoto.cn/"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return QuoteResponse{}, errors.New("quote: invalid provider URL")
	}
	req.Header.Set("User-Agent", "Hearth/1.0")
	req.Header.Set("Accept", "application/json")

	resp, err := DefaultClient.Do(req)
	if err != nil {
		return QuoteResponse{}, fmt.Errorf("%s: request failed", source)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return QuoteResponse{}, fmt.Errorf("%s: could not read response", source)
	}
	if resp.StatusCode != http.StatusOK {
		return QuoteResponse{}, fmt.Errorf("%s: HTTP %d", source, resp.StatusCode)
	}

	result := QuoteResponse{Source: source, SourceURL: sourceURL}
	if language == "zh" {
		var item struct {
			Text    string `json:"hitokoto"`
			From    string `json:"from"`
			FromWho string `json:"from_who"`
		}
		if err := json.Unmarshal(body, &item); err != nil {
			return QuoteResponse{}, errors.New("Hitokoto: invalid response")
		}
		result.Text = strings.TrimSpace(item.Text)
		result.Author = strings.TrimSpace(item.FromWho)
		if result.Author == "" {
			result.Author = strings.TrimSpace(item.From)
		}
	} else {
		var items []struct {
			Q string `json:"q"`
			A string `json:"a"`
		}
		if err := json.Unmarshal(body, &items); err != nil || len(items) == 0 {
			return QuoteResponse{}, errors.New("ZenQuotes: invalid or empty response")
		}
		result.Text = strings.TrimSpace(items[0].Q)
		result.Author = strings.TrimSpace(items[0].A)
	}
	if result.Text == "" || result.Author == "" {
		return QuoteResponse{}, fmt.Errorf("%s: missing quote text or attribution", source)
	}
	return result, nil
}
