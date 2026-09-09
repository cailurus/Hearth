package widgets

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

type RSSItem struct {
	Title       string `json:"title"`
	Link        string `json:"link"`
	Source      string `json:"source"`
	PublishedAt int64  `json:"publishedAt"`
}

type RSSResponse struct {
	DataStatus
	FetchedAt    int64             `json:"fetchedAt"`
	Items        []RSSItem         `json:"items"`
	SourceErrors []FeedSourceError `json:"sourceErrors,omitempty"`
}

type FeedSourceError struct {
	Source string `json:"source"`
	Error  string `json:"error"`
}

const (
	feedLoadTimeout = 8 * time.Second
	feedColdWait    = 3 * time.Second
	feedPartialWait = 20 * time.Millisecond
)

var rssTTLCache = newFeedCache[[]RSSItem](15*time.Minute, 7*24*time.Hour)
var rssFetchSlots = make(chan struct{}, 4)

func newFeedCache[T any](ttl, maxStale time.Duration) *cache.Cache[T] {
	c := cache.New[T](ttl)
	c.SetMaxStale(maxStale)
	c.SetLoadTimeout(feedLoadTimeout)
	return c
}

// ConfigureFeedPersistence restores provider snapshots in separate namespaces.
func ConfigureFeedPersistence(root string) error {
	if strings.TrimSpace(root) == "" {
		return errors.New("feed cache directory is required")
	}
	return errors.Join(
		rssTTLCache.SetPersistence(filepath.Join(root, "rss")),
		holidayYearCache.SetPersistence(filepath.Join(root, "holiday-years")),
		holidayCountriesTTLCache.SetPersistence(filepath.Join(root, "holiday-countries")),
		quoteTTLCache.SetPersistence(filepath.Join(root, "quotes")),
	)
}

type feedLoad[T any] struct {
	key     string
	source  string
	loader  func(context.Context) (T, error)
	refresh bool // Refresh a seeded snapshot without withholding its cached data.
}

type feedResult[T any] struct {
	value T
	state cache.State
	err   error
}

type feedCompletion[T any] struct {
	index  int
	result feedResult[T]
}

// Cached sources are read first; adding a cold source must not hide existing data.
// The buffered channel lets bounded cold loads finish even after the caller leaves.
func loadFeedSources[T any](ctx context.Context, c *cache.Cache[T], loads []feedLoad[T], force bool) []feedResult[T] {
	results := make([]feedResult[T], len(loads))
	done := make(chan feedCompletion[T], len(loads))
	pending := make(map[int]bool)
	haveCached := false
	for i, load := range loads {
		if _, ok := c.GetStale(load.key); ok && !force {
			value, state, err := c.Load(ctx, load.key, load.loader)
			results[i] = feedResult[T]{value, state, err}
			haveCached = haveCached || !state.FetchedAt.IsZero()
			if !load.refresh {
				continue
			}
		}
		pending[i] = true
		go func(index int, load feedLoad[T]) {
			loadCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), feedLoadTimeout)
			defer cancel()
			value, state, err := c.Load(loadCtx, load.key, load.loader, force || load.refresh)
			done <- feedCompletion[T]{index, feedResult[T]{value, state, err}}
		}(i, load)
	}
	wait := feedColdWait
	if force {
		wait = feedLoadTimeout + feedPartialWait
	} else if haveCached {
		wait = feedPartialWait
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for len(pending) > 0 {
		select {
		case result := <-done:
			results[result.index] = result.result
			delete(pending, result.index)
		case <-ctx.Done():
			goto finished
		case <-timer.C:
			goto finished
		}
	}
finished:
	finishFeedSources(ctx, c, loads, results, pending, done)
	return results
}

func finishFeedSources[T any](ctx context.Context, c *cache.Cache[T], loads []feedLoad[T], results []feedResult[T], pending map[int]bool, done <-chan feedCompletion[T]) {
	// A completion and the aggregate deadline may become ready together.
	for {
		select {
		case result, ok := <-done:
			if !ok {
				goto drained
			}
			results[result.index] = result.result
			delete(pending, result.index)
		default:
			goto drained
		}
	}
drained:
	for index := range pending {
		if _, ok := c.GetStale(loads[index].key); ok && ctx.Err() == nil {
			value, state, err := c.Load(ctx, loads[index].key, loads[index].loader)
			results[index] = feedResult[T]{value, state, err}
			if state.Err != nil && !state.Refreshing {
				continue
			}
		}
		results[index].state.Refreshing = true
		if results[index].state.Err == nil {
			results[index].state.Err = errors.New("refresh pending")
		}
		results[index].err = results[index].state.Err
	}
}

func mergeFeedStatus(status *DataStatus, fetchedAt *int64, state cache.State) {
	status.Stale = status.Stale || state.Stale
	status.Refreshing = status.Refreshing || state.Refreshing
	if !state.FetchedAt.IsZero() && (*fetchedAt == 0 || state.FetchedAt.Unix() < *fetchedAt) {
		*fetchedAt = state.FetchedAt.Unix()
	}
}

func acquireFeedSlot(ctx context.Context, slots chan struct{}) error {
	select {
	case slots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// FetchRSSFeeds fetches multiple RSS/Atom feeds concurrently, merges and sorts items.
func FetchRSSFeeds(ctx context.Context, feedURLs []string, limit int, noCache ...bool) (RSSResponse, error) {
	// Deduplicate and normalize.
	seen := map[string]bool{}
	var feeds []string
	for _, raw := range feedURLs {
		u := strings.TrimSpace(raw)
		if u == "" || seen[u] {
			continue
		}
		seen[u] = true
		feeds = append(feeds, u)
		if len(feeds) >= 10 {
			break
		}
	}
	if len(feeds) == 0 {
		return RSSResponse{Items: []RSSItem{}}, nil
	}
	if limit <= 0 {
		limit = 8
	}

	loads := make([]feedLoad[[]RSSItem], 0, len(feeds))
	for _, feedURL := range feeds {
		loads = append(loads, feedLoad[[]RSSItem]{
			key: feedURL, source: hostnameFromURL(feedURL),
			loader: func(ctx context.Context) ([]RSSItem, error) {
				if err := acquireFeedSlot(ctx, rssFetchSlots); err != nil {
					return nil, errors.New("rss: request timed out")
				}
				defer func() { <-rssFetchSlots }()
				return fetchSingleFeed(ctx, feedURL)
			},
		})
	}
	results := loadFeedSources(ctx, rssTTLCache, loads, len(noCache) > 0 && noCache[0])
	out := RSSResponse{Items: make([]RSSItem, 0)}
	anyOK := false
	for i, r := range results {
		mergeFeedStatus(&out.DataStatus, &out.FetchedAt, r.state)
		if !r.state.FetchedAt.IsZero() {
			anyOK = true
			out.Items = append(out.Items, r.value...)
		}
		err := r.err
		if r.state.Err != nil {
			err = r.state.Err
		}
		if err != nil {
			out.SourceErrors = append(out.SourceErrors, FeedSourceError{Source: loads[i].source, Error: err.Error()})
		}
	}
	if len(out.SourceErrors) > 0 {
		out.Warning = "some RSS feeds could not be loaded"
	}
	if !anyOK {
		return out, errors.New("no usable RSS feeds")
	}

	sort.SliceStable(out.Items, func(i, j int) bool {
		return out.Items[i].PublishedAt > out.Items[j].PublishedAt
	})
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
	}
	return out, nil
}

func fetchSingleFeed(ctx context.Context, feedURL string) ([]RSSItem, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil || (req.URL.Scheme != "https" && req.URL.Scheme != "http") || req.URL.Hostname() == "" {
		return nil, errors.New("rss: invalid feed URL")
	}
	req.Header.Set("User-Agent", "Hearth/1.0")
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml")

	resp, err := DefaultClient.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return nil, errors.New("rss: request timed out or canceled")
		}
		return nil, errors.New("rss: request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("rss: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return nil, errors.New("rss: could not read feed")
	}

	// Try RSS 2.0 first, then Atom.
	items, err := parseRSS2(body, feedURL)
	if err != nil {
		items2, err2 := parseAtom(body, feedURL)
		if err2 == nil {
			return items2, nil
		}
		return nil, errors.New("rss: invalid RSS or Atom document")
	}
	return items, nil
}

// RSS 2.0 structures.
type rss2Feed struct {
	XMLName xml.Name `xml:"rss"`
	Channel struct {
		Title string     `xml:"title"`
		Items []rss2Item `xml:"item"`
	} `xml:"channel"`
}

type rss2Item struct {
	Title   string `xml:"title"`
	Link    string `xml:"link"`
	PubDate string `xml:"pubDate"`
}

func parseRSS2(data []byte, feedURL string) ([]RSSItem, error) {
	var feed rss2Feed
	if err := xml.Unmarshal(data, &feed); err != nil {
		return nil, err
	}

	source := strings.TrimSpace(feed.Channel.Title)
	if source == "" {
		source = hostnameFromURL(feedURL)
	}

	var items []RSSItem
	for _, item := range feed.Channel.Items {
		title := strings.TrimSpace(item.Title)
		link := strings.TrimSpace(item.Link)
		if title == "" {
			continue
		}
		items = append(items, RSSItem{
			Title:       title,
			Link:        link,
			Source:      source,
			PublishedAt: parsePubDate(item.PubDate).Unix(),
		})
	}
	return items, nil
}

// Atom structures.
type atomFeed struct {
	XMLName xml.Name    `xml:"feed"`
	Title   string      `xml:"title"`
	Entries []atomEntry `xml:"entry"`
}

type atomEntry struct {
	Title     string     `xml:"title"`
	Links     []atomLink `xml:"link"`
	Updated   string     `xml:"updated"`
	Published string     `xml:"published"`
}

type atomLink struct {
	Href string `xml:"href,attr"`
	Rel  string `xml:"rel,attr"`
}

func parseAtom(data []byte, feedURL string) ([]RSSItem, error) {
	var feed atomFeed
	if err := xml.Unmarshal(data, &feed); err != nil {
		return nil, err
	}

	source := strings.TrimSpace(feed.Title)
	if source == "" {
		source = hostnameFromURL(feedURL)
	}

	var items []RSSItem
	for _, entry := range feed.Entries {
		title := strings.TrimSpace(entry.Title)
		if title == "" {
			continue
		}

		// Pick best link: prefer "alternate", fallback to first.
		link := ""
		for _, l := range entry.Links {
			if l.Rel == "" || l.Rel == "alternate" {
				link = strings.TrimSpace(l.Href)
				break
			}
		}
		if link == "" && len(entry.Links) > 0 {
			link = strings.TrimSpace(entry.Links[0].Href)
		}

		dateStr := entry.Published
		if dateStr == "" {
			dateStr = entry.Updated
		}

		items = append(items, RSSItem{
			Title:       title,
			Link:        link,
			Source:      source,
			PublishedAt: parsePubDate(dateStr).Unix(),
		})
	}
	return items, nil
}

func hostnameFromURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Hostname() == "" {
		return "invalid feed"
	}
	h := u.Hostname()
	h = strings.TrimPrefix(h, "www.")
	return h
}

func parsePubDate(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}

	formats := []string{
		time.RFC3339,
		time.RFC3339Nano,
		time.RFC1123Z,
		time.RFC1123,
		time.RFC822Z,
		time.RFC822,
		"Mon, 2 Jan 2006 15:04:05 -0700",
		"Mon, 2 Jan 2006 15:04:05 MST",
		"2006-01-02T15:04:05-07:00",
		"2006-01-02T15:04:05Z",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t
		}
	}
	return time.Time{}
}
