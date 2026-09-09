package widgets

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

const englishQuoteFixture = `[{"q":"A fixture sentence created solely for this test.","a":"Fixture author"}]`
const chineseQuoteFixture = `{"hitokoto":"这是一句专为测试编写的文本。","from":"测试作品","from_who":"测试作者"}`

func resetQuoteFixtureCache(t *testing.T, ttl time.Duration) {
	t.Helper()
	old := quoteTTLCache
	quoteTTLCache = newFeedCache[QuoteResponse](ttl, 7*24*time.Hour)
	t.Cleanup(func() { quoteTTLCache = old })
}

func TestQuoteLanguageCacheAndAttribution(t *testing.T) {
	resetQuoteFixtureCache(t, 24*time.Hour)
	var englishCalls, chineseCalls atomic.Int32
	useFeedFixtureTransport(t, func(req *http.Request) (*http.Response, error) {
		switch req.URL.Hostname() {
		case "v1.hitokoto.cn":
			chineseCalls.Add(1)
			if req.URL.Query().Get("c") != "i" || len(req.URL.Query()) != 1 {
				t.Errorf("Hitokoto must use the public poetry category without a key: %s", req.URL)
			}
			return feedFixtureResponse(chineseQuoteFixture, http.StatusOK)
		case "zenquotes.io":
			englishCalls.Add(1)
			if req.URL.Path != "/api/today" {
				t.Errorf("unexpected English provider path: %s", req.URL.Path)
			}
			return feedFixtureResponse(englishQuoteFixture, http.StatusOK)
		default:
			t.Errorf("unexpected quote provider: %s", req.URL)
			return nil, errors.New("unexpected fixture provider")
		}
	})
	for _, lang := range []string{"en", "zh", "en-US", "zh-CN", "zh-TW"} {
		out, err := FetchDailyQuote(context.Background(), lang)
		if err != nil || out.Text == "" || out.Author == "" || out.SourceURL == "" || out.FetchedAt == 0 {
			t.Fatalf("quote data or attribution missing: %+v, %v", out, err)
		}
		if lang[:2] == "zh" && (out.Source != "Hitokoto" || out.Author != "测试作者") {
			t.Fatalf("Chinese provider response was not preserved: %+v", out)
		}
		if lang[:2] == "en" && (out.Source != "ZenQuotes" || out.Author != "Fixture author") {
			t.Fatalf("English provider response was not preserved: %+v", out)
		}
	}
	out, err := FetchDailyQuote(context.Background())
	if err != nil || out.Source != "ZenQuotes" || englishCalls.Load() != 1 || chineseCalls.Load() != 1 {
		t.Fatalf("compatibility/language cache failed: %+v, %v; calls=%d/%d", out, err, englishCalls.Load(), chineseCalls.Load())
	}
}

func TestQuoteRejectsMalformedAndEmptyPayloads(t *testing.T) {
	for _, tc := range []struct {
		name, language, body string
	}{
		{"english-empty-list", "en", `[]`},
		{"english-null", "en", `null`},
		{"english-empty-text", "en", `[{"q":" ","a":"Fixture author"}]`},
		{"english-empty-author", "en", `[{"q":"Fixture text","a":""}]`},
		{"english-wrong-shape", "en", `{"error":"fixture error"}`},
		{"chinese-empty-text", "zh", `{"hitokoto":"","from":"Fixture work"}`},
		{"chinese-empty-attribution", "zh", `{"hitokoto":"Fixture text"}`},
		{"chinese-malformed", "zh", `{"hitokoto":`},
		{"chinese-null", "zh", `null`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetQuoteFixtureCache(t, 24*time.Hour)
			useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
				return feedFixtureResponse(tc.body, http.StatusOK)
			})
			out, err := FetchDailyQuote(context.Background(), tc.language)
			if err == nil || out.Text != "" || out.FetchedAt != 0 {
				t.Fatalf("invalid payload became successful/fabricated data: %+v, %v", out, err)
			}
			if _, ok := quoteTTLCache.GetStale(tc.language); ok {
				t.Fatal("invalid quote cached")
			}
		})
	}
}

func TestQuoteProviderFailureOnMissIsRealError(t *testing.T) {
	resetQuoteFixtureCache(t, 24*time.Hour)
	useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
		return nil, errors.New("offline fixture")
	})
	for _, language := range []string{"zh", "en"} {
		out, err := FetchDailyQuote(context.Background(), language)
		if err == nil || out.Text != "" || out.FetchedAt != 0 {
			t.Fatalf("quote failure fabricated fallback content: %+v, %v", out, err)
		}
	}
}

func TestQuoteManualRefreshKeepsDataAndRetriesFailure(t *testing.T) {
	resetQuoteFixtureCache(t, 24*time.Hour)
	var calls atomic.Int32
	useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
		if calls.Add(1) == 2 {
			return feedFixtureResponse("", http.StatusServiceUnavailable)
		}
		return feedFixtureResponse(englishQuoteFixture, http.StatusOK)
	})
	first, err := FetchDailyQuote(context.Background(), "en")
	if err != nil {
		t.Fatal(err)
	}
	retained, err := RefreshDailyQuote(context.Background(), "en")
	if err != nil || retained.Text != first.Text || retained.Warning == "" || retained.FetchedAt != first.FetchedAt {
		t.Fatalf("manual refresh lost valid data: %+v %v", retained, err)
	}
	retried, err := RefreshDailyQuote(context.Background(), "en")
	if err != nil || retried.Warning != "" || calls.Load() != 3 {
		t.Fatalf("manual retry did not fetch: %+v %v calls=%d", retried, err, calls.Load())
	}
}

func TestQuoteStaleFailureKeepsLastGoodAndTimestamp(t *testing.T) {
	resetQuoteFixtureCache(t, time.Nanosecond)
	var calls atomic.Int32
	release := make(chan struct{})
	useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			return feedFixtureResponse(englishQuoteFixture, http.StatusOK)
		}
		<-release
		return feedFixtureResponse("", http.StatusServiceUnavailable)
	})
	first, err := FetchDailyQuote(context.Background(), "en")
	if err != nil {
		t.Fatal(err)
	}
	refreshing, err := FetchDailyQuote(context.Background(), "en")
	if err != nil || refreshing.Text != first.Text || !refreshing.Stale || !refreshing.Refreshing ||
		refreshing.FetchedAt != first.FetchedAt {
		t.Errorf("stale quote unavailable during refresh: %+v, %v", refreshing, err)
	}
	waitFeedFixture(t, func() bool { return calls.Load() == 2 })
	close(release)
	waitFeedFixture(t, func() bool {
		_, state, _ := quoteTTLCache.Load(context.Background(), "en", func(context.Context) (QuoteResponse, error) {
			return QuoteResponse{}, errors.New("unexpected fixture refresh")
		})
		return !state.Refreshing && state.Err != nil
	})
	failed, err := FetchDailyQuote(context.Background(), "en")
	if err != nil || failed.Text != first.Text || failed.Author != first.Author || failed.FetchedAt != first.FetchedAt ||
		!failed.Stale || failed.Warning == "" || failed.Refreshing || calls.Load() != 2 {
		t.Fatalf("failed quote refresh lost last-good data/status: %+v, %v", failed, err)
	}
}

func TestQuoteHitokotoUsesProviderWorkWhenAuthorMissing(t *testing.T) {
	resetQuoteFixtureCache(t, 24*time.Hour)
	useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
		return feedFixtureResponse(`{"hitokoto":"Fixture text written for this test","from":"Fixture work","from_who":null}`, http.StatusOK)
	})
	out, err := FetchDailyQuote(context.Background(), "zh")
	if err != nil || out.Author != "Fixture work" || out.Source != "Hitokoto" {
		t.Fatalf("provider work attribution was lost: %+v, %v", out, err)
	}
}
