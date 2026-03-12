package widgets

import (
	"context"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
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
	FetchedAt int64     `json:"fetchedAt"`
	Items     []RSSItem `json:"items"`
}

var rssTTLCache = cache.New[RSSResponse](15 * time.Minute)

func rssCacheKey(feeds []string) string {
	sorted := make([]string, len(feeds))
	copy(sorted, feeds)
	sort.Strings(sorted)
	return strings.Join(sorted, "\n")
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
		return RSSResponse{FetchedAt: time.Now().Unix(), Items: []RSSItem{}}, nil
	}
	if limit <= 0 {
		limit = 8
	}

	key := rssCacheKey(feeds)
	skipCache := len(noCache) > 0 && noCache[0]

	if !skipCache {
		if cached, ok := rssTTLCache.Get(key); ok {
			return cached, nil
		}
	}

	// Fetch all feeds concurrently.
	type result struct {
		items []RSSItem
		err   error
	}
	results := make([]result, len(feeds))
	var wg sync.WaitGroup
	for i, feedURL := range feeds {
		wg.Add(1)
		go func(idx int, u string) {
			defer wg.Done()
			items, err := fetchSingleFeed(ctx, u)
			results[idx] = result{items, err}
		}(i, feedURL)
	}
	wg.Wait()

	// Merge all items.
	var all []RSSItem
	anyOK := false
	for _, r := range results {
		if r.err == nil {
			anyOK = true
			all = append(all, r.items...)
		}
	}

	if !anyOK {
		if cached, ok := rssTTLCache.GetStale(key); ok {
			return cached, nil
		}
		return RSSResponse{FetchedAt: time.Now().Unix(), Items: []RSSItem{}}, errors.New("all RSS feeds failed")
	}

	// Sort by publishedAt descending.
	sort.Slice(all, func(i, j int) bool {
		return all[i].PublishedAt > all[j].PublishedAt
	})
	if len(all) > limit {
		all = all[:limit]
	}

	out := RSSResponse{FetchedAt: time.Now().Unix(), Items: all}
	rssTTLCache.Set(key, out)
	return out, nil
}

func fetchSingleFeed(ctx context.Context, feedURL string) ([]RSSItem, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Hearth/1.0")
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml")

	resp, err := DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, errors.New("rss: status " + resp.Status)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return nil, err
	}

	// Try RSS 2.0 first, then Atom.
	items, err := parseRSS2(body, feedURL)
	if err != nil || len(items) == 0 {
		items2, err2 := parseAtom(body, feedURL)
		if err2 == nil && len(items2) > 0 {
			return items2, nil
		}
		if err != nil {
			return nil, err
		}
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
	XMLName xml.Name   `xml:"feed"`
	Title   string     `xml:"title"`
	Entries []atomEntry `xml:"entry"`
}

type atomEntry struct {
	Title   string     `xml:"title"`
	Links   []atomLink `xml:"link"`
	Updated string     `xml:"updated"`
	Published string   `xml:"published"`
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
	if err != nil {
		return rawURL
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
