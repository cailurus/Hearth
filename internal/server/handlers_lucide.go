package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Lucide icon metadata cache
var (
	lucideTagsCache     map[string][]string // icon name -> tags
	lucideTagsCacheTime time.Time
	lucideTagsMutex     sync.RWMutex
	lucideTagsCacheTTL  = 24 * time.Hour
)

const lucideTagsURL = "https://unpkg.com/lucide-static@latest/tags.json"

// fetchLucideTags fetches and caches the Lucide icon tags from CDN
func fetchLucideTags() (map[string][]string, error) {
	lucideTagsMutex.RLock()
	if lucideTagsCache != nil && time.Since(lucideTagsCacheTime) < lucideTagsCacheTTL {
		cache := lucideTagsCache
		lucideTagsMutex.RUnlock()
		return cache, nil
	}
	lucideTagsMutex.RUnlock()

	lucideTagsMutex.Lock()
	defer lucideTagsMutex.Unlock()

	// Double-check after acquiring write lock
	if lucideTagsCache != nil && time.Since(lucideTagsCacheTime) < lucideTagsCacheTTL {
		return lucideTagsCache, nil
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(lucideTagsURL)
	if err != nil {
		// Return cached data if available, even if expired
		if lucideTagsCache != nil {
			return lucideTagsCache, nil
		}
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if lucideTagsCache != nil {
			return lucideTagsCache, nil
		}
		return nil, err
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		if lucideTagsCache != nil {
			return lucideTagsCache, nil
		}
		return nil, err
	}

	var tags map[string][]string
	if err := json.Unmarshal(body, &tags); err != nil {
		if lucideTagsCache != nil {
			return lucideTagsCache, nil
		}
		return nil, err
	}

	lucideTagsCache = tags
	lucideTagsCacheTime = time.Now()
	return tags, nil
}

type lucideSearchResult struct {
	Name string   `json:"name"`
	Tags []string `json:"tags"`
}

// handleSearchLucideIcons handles GET /api/icons/lucide/search?q=xxx
func (s *Server) handleSearchLucideIcons(w http.ResponseWriter, r *http.Request) {
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	limitStr := r.URL.Query().Get("limit")
	limit := 100
	if limitStr != "" {
		if l, err := parseInt(limitStr); err == nil && l > 0 && l <= 500 {
			limit = l
		}
	}

	tags, err := fetchLucideTags()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch icon data")
		return
	}

	var results []lucideSearchResult

	// If no query, return popular icons
	if query == "" {
		popularIcons := []string{
			"home", "settings", "user", "mail", "calendar", "clock", "search", "bell",
			"heart", "star", "bookmark", "folder", "file", "image", "camera", "video",
			"music", "play", "globe", "map", "map-pin", "phone", "monitor", "laptop",
			"shopping-cart", "credit-card", "dollar-sign", "trending-up", "bar-chart",
			"code", "terminal", "database", "server", "hard-drive", "cpu", "layers",
			"link", "external-link", "download", "upload", "share", "send", "inbox",
			"trash", "edit", "copy", "check", "x", "plus", "minus", "lock", "key",
		}
		for _, name := range popularIcons {
			if iconTags, ok := tags[name]; ok {
				results = append(results, lucideSearchResult{Name: name, Tags: iconTags})
			}
			if len(results) >= limit {
				break
			}
		}
		writeJSON(w, http.StatusOK, results)
		return
	}

	// Search by icon name and tags
	for name, iconTags := range tags {
		// Check if name contains query
		if strings.Contains(name, query) {
			results = append(results, lucideSearchResult{Name: name, Tags: iconTags})
			continue
		}

		// Check if any tag contains query
		for _, tag := range iconTags {
			if strings.Contains(strings.ToLower(tag), query) {
				results = append(results, lucideSearchResult{Name: name, Tags: iconTags})
				break
			}
		}

		if len(results) >= limit {
			break
		}
	}

	// Sort results: exact name match first, then name contains, then tag match
	// For simplicity, we'll just return as-is (Go maps are unordered anyway)

	writeJSON(w, http.StatusOK, results)
}

// handleListAllLucideIcons handles GET /api/icons/lucide/all - returns all icon names
func (s *Server) handleListAllLucideIcons(w http.ResponseWriter, r *http.Request) {
	tags, err := fetchLucideTags()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch icon data")
		return
	}

	names := make([]string, 0, len(tags))
	for name := range tags {
		names = append(names, name)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"icons": names,
		"count": len(names),
	})
}

func parseInt(s string) (int, error) {
	var n int
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, nil
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}
