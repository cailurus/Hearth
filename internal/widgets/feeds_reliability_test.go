package widgets

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type feedFixtureTransport func(*http.Request) (*http.Response, error)

func (f feedFixtureTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func useFeedFixtureTransport(t *testing.T, transport feedFixtureTransport) {
	t.Helper()
	old := DefaultClient
	DefaultClient = &http.Client{Transport: transport, Timeout: time.Second * 10}
	t.Cleanup(func() { DefaultClient = old })
}

func feedFixtureResponse(body string, status int) (*http.Response, error) {
	return &http.Response{
		StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)),
	}, nil
}

func waitFeedFixture(t *testing.T, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !ready() {
		if time.Now().After(deadline) {
			t.Fatal("background fixture load did not finish")
		}
		time.Sleep(time.Millisecond)
	}
}

func feedFixtureDirectory(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(".", fmt.Sprintf(".feed-fixture-%d", time.Now().UnixNano()))
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(dir); err != nil {
			t.Error(err)
		}
	})
	return dir
}

func resetRSSFixtureCache(t *testing.T, ttl time.Duration) {
	t.Helper()
	old := rssTTLCache
	rssTTLCache = newFeedCache[[]RSSItem](ttl, 7*24*time.Hour)
	t.Cleanup(func() { rssTTLCache = old })
}

func rssFixture(title string) string {
	return `<rss version="2.0"><channel><title>Fixture source</title><item><title>` + title +
		`</title><link>https://item.example/test</link><pubDate>2026-09-01</pubDate></item></channel></rss>`
}

func TestRSSPerSourceCacheLimitsAndForce(t *testing.T) {
	resetRSSFixtureCache(t, time.Hour)
	var mode, calls atomic.Int32
	useFeedFixtureTransport(t, func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		if mode.Load() == 1 && req.URL.Hostname() == "b.example" {
			return feedFixtureResponse("", http.StatusBadGateway)
		}
		return feedFixtureResponse(rssFixture(fmt.Sprintf("%s-%d", req.URL.Hostname(), mode.Load())), http.StatusOK)
	})
	feeds := []string{"https://a.example/feed", "https://user:password@b.example/feed?token=secret-value"}
	first, err := FetchRSSFeeds(context.Background(), feeds, 1)
	if err != nil || len(first.Items) != 1 {
		t.Fatalf("initial load: %+v, %v", first, err)
	}
	second, err := FetchRSSFeeds(context.Background(), feeds, 10)
	if err != nil || len(second.Items) != 2 || calls.Load() != 2 {
		t.Fatalf("limits must be applied after reading complete cached feeds: %+v, %v; calls=%d", second, err, calls.Load())
	}
	mode.Store(1)
	forced, err := FetchRSSFeeds(context.Background(), feeds, 10, true)
	if err != nil || len(forced.Items) != 2 || calls.Load() != 4 {
		t.Fatalf("force must fetch both sources and keep failed source data: %+v, %v; calls=%d", forced, err, calls.Load())
	}
	if len(forced.SourceErrors) != 1 || forced.SourceErrors[0].Source != "b.example" ||
		forced.Warning == "" || forced.FetchedAt != first.FetchedAt {
		t.Fatalf("missing source failure/last-good timestamp: %+v", forced)
	}
	var titles []string
	for _, item := range forced.Items {
		titles = append(titles, item.Title)
	}
	if strings.Join(titles, ",") != "a.example-1,b.example-0" {
		t.Fatalf("unexpected mixed source result: %v", titles)
	}
}

func TestRSSCachesCompleteFeedBeforeApplyingLimit(t *testing.T) {
	resetRSSFixtureCache(t, time.Hour)
	var calls atomic.Int32
	useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		body := `<rss><channel><title>Fixture</title>
		<item><title>First fixture</title><pubDate>2026-09-01</pubDate></item>
		<item><title>Second fixture</title><pubDate>2026-09-02</pubDate></item>
		<item><title>Third fixture</title><pubDate>2026-09-03</pubDate></item>
		</channel></rss>`
		return feedFixtureResponse(body, http.StatusOK)
	})
	feeds := []string{"https://complete.example/feed"}
	first, err := FetchRSSFeeds(context.Background(), feeds, 1)
	if err != nil || len(first.Items) != 1 || first.Items[0].Title != "Third fixture" {
		t.Fatalf("first limit/sort incorrect: %+v, %v", first, err)
	}
	second, err := FetchRSSFeeds(context.Background(), feeds, 3)
	if err != nil || len(second.Items) != 3 || calls.Load() != 1 {
		t.Fatalf("cache stored truncated feed data: %+v, %v; calls=%d", second, err, calls.Load())
	}
}

func TestRSSDoesNotCacheFailedEmptySuccessOrLeakURLs(t *testing.T) {
	resetRSSFixtureCache(t, time.Hour)
	useFeedFixtureTransport(t, func(req *http.Request) (*http.Response, error) {
		return nil, errors.New("upstream echoed " + req.URL.String())
	})
	feed := "https://user:password@private.example/rss?token=secret-value"
	out, err := FetchRSSFeeds(context.Background(), []string{feed}, 8)
	if err == nil || out.FetchedAt != 0 || len(out.Items) != 0 || len(out.SourceErrors) != 1 {
		t.Fatalf("all-failed request must remain an error: %+v, %v", out, err)
	}
	if _, ok := rssTTLCache.GetStale(feed); ok {
		t.Fatal("failed empty response cached as successful data")
	}
	rendered := fmt.Sprintf("%+v %v", out, err)
	for _, secret := range []string{"secret-value", "password", "token="} {
		if strings.Contains(rendered, secret) {
			t.Fatalf("source error disclosed a URL credential: %s", rendered)
		}
	}
	if out.SourceErrors[0].Source != "private.example" {
		t.Fatalf("source is not a sanitized hostname: %+v", out.SourceErrors)
	}
	if got := hostnameFromURL("https://invalid%zz/feed?token=secret-value"); got != "invalid feed" {
		t.Fatalf("malformed URL leaked in hostname: %q", got)
	}
}

func TestRSSGenuineEmptyRSSAndAtomAreSuccess(t *testing.T) {
	for name, body := range map[string]string{
		"rss":  `<rss version="2.0"><channel><title>Empty fixture</title></channel></rss>`,
		"atom": `<feed xmlns="http://www.w3.org/2005/Atom"><title>Empty fixture</title></feed>`,
	} {
		t.Run(name, func(t *testing.T) {
			resetRSSFixtureCache(t, time.Hour)
			var calls atomic.Int32
			useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
				calls.Add(1)
				return feedFixtureResponse(body, http.StatusOK)
			})
			for range 2 {
				out, err := FetchRSSFeeds(context.Background(), []string{"https://empty.example/feed"}, 8)
				if err != nil || len(out.Items) != 0 || out.Items == nil || out.FetchedAt == 0 {
					t.Fatalf("genuine empty feed should succeed: %+v, %v", out, err)
				}
			}
			if calls.Load() != 1 {
				t.Fatalf("successful empty feed not cached: %d calls", calls.Load())
			}
		})
	}
}

func TestRSSAtomParsingAndInvalidDocument(t *testing.T) {
	body := `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom fixture</title>
	<entry><title>Fixture entry</title><link rel="self" href="https://example.test/self"/>
	<link rel="alternate" href="https://example.test/entry"/><updated>2026-09-01T01:00:00Z</updated>
	<published>2026-08-31T01:00:00Z</published></entry></feed>`
	useFeedFixtureTransport(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/invalid" {
			return feedFixtureResponse(`<html>not a feed</html>`, http.StatusOK)
		}
		return feedFixtureResponse(body, http.StatusOK)
	})
	items, err := fetchSingleFeed(context.Background(), "https://atom.example/feed")
	if err != nil || len(items) != 1 || items[0].Link != "https://example.test/entry" ||
		items[0].PublishedAt != time.Date(2026, 8, 31, 1, 0, 0, 0, time.UTC).Unix() {
		t.Fatalf("Atom behavior changed: %+v, %v", items, err)
	}
	if _, err := fetchSingleFeed(context.Background(), "https://atom.example/invalid"); err == nil {
		t.Fatal("non-feed XML must fail")
	}
}

func TestRSSStaleRefreshIsCoalesced(t *testing.T) {
	resetRSSFixtureCache(t, time.Nanosecond)
	const feed = "https://stale.example/feed"
	rssTTLCache.Set(feed, []RSSItem{{Title: "Old fixture"}})
	var calls atomic.Int32
	release := make(chan struct{})
	useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		<-release
		return feedFixtureResponse(rssFixture("New fixture"), http.StatusOK)
	})
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, err := FetchRSSFeeds(context.Background(), []string{feed}, 8)
			if err != nil || !out.Stale || !out.Refreshing || len(out.Items) != 1 || out.Items[0].Title != "Old fixture" {
				t.Errorf("stale data should return during refresh: %+v, %v", out, err)
			}
		}()
	}
	wg.Wait()
	waitFeedFixture(t, func() bool { return calls.Load() == 1 })
	close(release)
	waitFeedFixture(t, func() bool {
		items, ok := rssTTLCache.GetStale(feed)
		return ok && len(items) == 1 && items[0].Title == "New fixture"
	})
	if calls.Load() != 1 {
		t.Fatalf("duplicate stale refreshes: %d", calls.Load())
	}
}

func TestRSSNewSlowSourceDoesNotBlockCachedContent(t *testing.T) {
	resetRSSFixtureCache(t, time.Hour)
	const fast, slow = "https://fast.example/feed", "https://slow.example/feed"
	rssTTLCache.Set(fast, []RSSItem{{Title: "Cached fixture"}})
	release := make(chan struct{})
	useFeedFixtureTransport(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Hostname() != "slow.example" {
			t.Errorf("fresh source unnecessarily refetched: %s", req.URL)
		}
		<-release
		return feedFixtureResponse(rssFixture("Slow fixture"), http.StatusOK)
	})
	start := time.Now()
	out, err := FetchRSSFeeds(context.Background(), []string{fast, slow}, 8)
	if err != nil || len(out.Items) != 1 || !out.Refreshing || time.Since(start) > 500*time.Millisecond {
		t.Errorf("new source blocked cached content or hid pending refresh: %+v, %v", out, err)
	}
	close(release)
	waitFeedFixture(t, func() bool { _, ok := rssTTLCache.Get(slow); return ok })
	out, err = FetchRSSFeeds(context.Background(), []string{fast, slow}, 8)
	if err != nil || len(out.Items) != 2 || out.Refreshing {
		t.Fatalf("poll did not include completed source: %+v, %v", out, err)
	}
}

func TestRSSColdWaitIsBoundedAndRefreshSurvivesReturn(t *testing.T) {
	resetRSSFixtureCache(t, time.Hour)
	const feed = "https://cold.example/feed"
	release := make(chan struct{})
	useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
		<-release
		return feedFixtureResponse(rssFixture("Late fixture"), http.StatusOK)
	})
	start := time.Now()
	out, err := FetchRSSFeeds(context.Background(), []string{feed}, 8)
	elapsed := time.Since(start)
	if err == nil || !out.Refreshing || elapsed > feedColdWait+time.Second || out.FetchedAt != 0 {
		t.Errorf("cold wait not bounded/pending: %+v, %v, elapsed=%v", out, err, elapsed)
	}
	close(release)
	waitFeedFixture(t, func() bool { _, ok := rssTTLCache.Get(feed); return ok })
}

func TestRSSFetchConcurrencyBounded(t *testing.T) {
	resetRSSFixtureCache(t, time.Hour)
	var active, peak atomic.Int32
	release := make(chan struct{})
	useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
		n := active.Add(1)
		for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
		}
		<-release
		active.Add(-1)
		return feedFixtureResponse(rssFixture("Concurrent fixture"), http.StatusOK)
	})
	var feeds []string
	for i := range 10 {
		feeds = append(feeds, fmt.Sprintf("https://source%d.example/feed", i))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, _ = FetchRSSFeeds(ctx, feeds, 8)
	close(release)
	waitFeedFixture(t, func() bool {
		for _, feed := range feeds {
			if _, ok := rssTTLCache.Get(feed); !ok {
				return false
			}
		}
		return true
	})
	if peak.Load() > 4 || peak.Load() == 0 {
		t.Fatalf("unexpected concurrent fetch bound: %d", peak.Load())
	}
}

func TestRSSColdRefreshCoalescedDespiteCanceledCaller(t *testing.T) {
	resetRSSFixtureCache(t, time.Hour)
	const feed = "https://shared.example/feed"
	var calls atomic.Int32
	release := make(chan struct{})
	useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		<-release
		return feedFixtureResponse(rssFixture("Shared fixture"), http.StatusOK)
	})
	ctx, cancel := context.WithCancel(context.Background())
	canceled := make(chan struct{})
	go func() {
		defer close(canceled)
		_, _ = FetchRSSFeeds(ctx, []string{feed}, 8)
	}()
	waitFeedFixture(t, func() bool { return calls.Load() == 1 })
	cancel()
	<-canceled
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, err := FetchRSSFeeds(context.Background(), []string{feed}, 8)
			if err != nil || len(out.Items) != 1 || out.Items[0].Title != "Shared fixture" {
				t.Errorf("shared refresh canceled by another caller: %+v, %v", out, err)
			}
		}()
	}
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("cold requests were not coalesced: %d", calls.Load())
	}
}

func TestRSSForceTimeoutPreservesLastGood(t *testing.T) {
	resetRSSFixtureCache(t, time.Hour)
	rssTTLCache.SetLoadTimeout(20 * time.Millisecond)
	const feed = "https://timeout.example/feed"
	rssTTLCache.Set(feed, []RSSItem{{Title: "Last-good fixture"}})
	useFeedFixtureTransport(t, func(req *http.Request) (*http.Response, error) {
		<-req.Context().Done()
		return nil, req.Context().Err()
	})
	before, err := FetchRSSFeeds(context.Background(), []string{feed}, 8)
	if err != nil {
		t.Fatal(err)
	}
	out, err := FetchRSSFeeds(context.Background(), []string{feed}, 8, true)
	if err != nil || len(out.Items) != 1 || out.Items[0].Title != before.Items[0].Title ||
		out.FetchedAt != before.FetchedAt || len(out.SourceErrors) != 1 {
		t.Fatalf("force timeout lost last-good data: %+v, %v", out, err)
	}
}

func TestRSSFeedPersistenceNamespaces(t *testing.T) {
	resetRSSFixtureCache(t, time.Hour)
	resetQuoteFixtureCache(t, 24*time.Hour)
	resetHolidayFixtureCache(t)
	oldCountries := holidayCountriesTTLCache
	holidayCountriesTTLCache = newFeedCache[[]HolidayCountry](7*24*time.Hour, 365*24*time.Hour)
	t.Cleanup(func() { holidayCountriesTTLCache = oldCountries })
	if err := ConfigureFeedPersistence(""); err == nil {
		t.Fatal("empty persistence root accepted")
	}
	root := feedFixtureDirectory(t)
	if err := ConfigureFeedPersistence(root); err != nil {
		t.Fatal(err)
	}
	for _, namespace := range []string{"rss", "quotes", "holiday-years", "holiday-countries"} {
		info, err := os.Stat(filepath.Join(root, namespace))
		if err != nil || !info.IsDir() {
			t.Fatalf("missing provider persistence namespace %q: %v", namespace, err)
		}
	}
}
