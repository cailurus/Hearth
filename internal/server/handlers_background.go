package server

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/morezhou/hearth/internal/background"
)

type backgroundInfo struct {
	Provider string `json:"provider"`
	ImageURL string `json:"imageUrl"`
}

//go:embed background-default.jpg
var defaultBackgroundFS embed.FS

func serveDefaultBackground(w http.ResponseWriter, r *http.Request) bool {
	b, err := defaultBackgroundFS.ReadFile("background-default.jpg")
	if err != nil || len(b) == 0 {
		return false
	}
	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeContent(w, r, "background-default.jpg", time.Time{}, bytes.NewReader(b))
	return true
}

func (s *Server) handleGetBackground(w http.ResponseWriter, r *http.Request) {
	provider := s.getStringSetting(kvBackgroundProvider, "default")
	writeJSON(w, http.StatusOK, backgroundInfo{
		Provider: provider,
		ImageURL: "/api/background/image",
	})
}

func (s *Server) handleGetBackgroundImage(w http.ResponseWriter, r *http.Request) {
	log.Printf("[bg] image request remote=%s ua=%q", r.RemoteAddr, r.UserAgent())
	// Backgrounds are large and can be aggressively cached by browsers/proxies.
	// Manual refresh should always take effect immediately.
	w.Header().Set("Cache-Control", "no-store")

	provider := s.getStringSetting(kvBackgroundProvider, "default")
	intervalStr := s.getStringSetting(kvBackgroundInterval, "0")
	interval, _ := time.ParseDuration(intervalStr)
	log.Printf("[bg] provider=%s interval=%q parsed=%s", provider, intervalStr, interval)

	// Backward compatibility: "bing" behaves like daily.
	if provider == string(background.ProviderBing) {
		provider = string(background.ProviderBingDaily)
	}
	// Fresh-install default: use the repo-shipped background and do not fetch remotely.
	if provider == "default" {
		if serveDefaultBackground(w, r) {
			return
		}
		writeError(w, http.StatusInternalServerError, "default background missing")
		return
	}

	cacheKey := "bg:" + provider
	if provider == string(background.ProviderUnsplash) {
		cacheKey = cacheKey + ":" + s.getStringSetting(kvBackgroundUnsplashQuery, "")
	}
	log.Printf("[bg] cacheKey=%q", cacheKey)
	if entry, ok, err := s.store.GetBackgroundCache(cacheKey); err == nil && ok {
		full := filepath.Join(s.cfg.DataDir, "cache", entry.FilePath)
		if st, err := os.Stat(full); err == nil {
			fresh := interval == 0 || time.Since(st.ModTime()) < interval
			if provider == string(background.ProviderBingDaily) {
				// Bing daily: always daily (ignore interval selection).
				fresh = time.Since(st.ModTime()) < 24*time.Hour
			}
			log.Printf("[bg] cacheHit file=%q mod=%s age=%s fresh=%v", full, st.ModTime().Format(time.RFC3339), time.Since(st.ModTime()), fresh)
			if fresh {
				http.ServeFile(w, r, full)
				return
			}
			log.Printf("[bg] cacheStale; will refetch")
		} else {
			log.Printf("[bg] cacheEntry exists but file missing/stat err=%v; will refetch", err)
			// No usable cached file: fall through to resolve & fetch.
		}
	} else if err != nil {
		log.Printf("[bg] cache lookup error: %v", err)
	} else {
		log.Printf("[bg] cache miss")
		// Cache miss: fall through to resolve & fetch.
	}

	log.Printf("[bg] resolving background url")
	imgURL, err := s.resolveBackgroundURL(r.Context(), provider)
	if err != nil {
		log.Printf("[bg] resolveBackgroundURL error: %v", err)
		if serveDefaultBackground(w, r) {
			return
		}
		writeError(w, http.StatusBadGateway, fmt.Sprintf("failed to resolve background url: %v", err))
		return
	}
	log.Printf("[bg] resolved url=%q", imgURL)
	res, err := s.bgSvc.FetchToFile(r.Context(), imgURL)
	if err != nil {
		log.Printf("[bg] FetchToFile error: %v", err)
		if serveDefaultBackground(w, r) {
			return
		}
		writeError(w, http.StatusBadGateway, fmt.Sprintf("failed to fetch background image: %v", err))
		return
	}
	log.Printf("[bg] fetched ok file=%q mime=%q", res.FileName, res.MimeType)
	_ = s.store.SetBackgroundCache(cacheKey, res.FileName)

	full := filepath.Join(s.cfg.DataDir, "cache", res.FileName)
	http.ServeFile(w, r, full)
}

func (s *Server) prefetchBackground(cacheKey string, provider string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// If another request already cached it, avoid duplicate work.
	if entry, ok, err := s.store.GetBackgroundCache(cacheKey); err == nil && ok {
		full := filepath.Join(s.cfg.DataDir, "cache", entry.FilePath)
		if _, err2 := os.Stat(full); err2 == nil {
			return
		}
	}

	imgURL, err := s.resolveBackgroundURL(ctx, provider)
	if err != nil {
		log.Printf("[bg] prefetch resolve error: %v", err)
		return
	}
	res, err := s.bgSvc.FetchToFile(ctx, imgURL)
	if err != nil {
		log.Printf("[bg] prefetch fetch error: %v", err)
		return
	}
	_ = s.store.SetBackgroundCache(cacheKey, res.FileName)
}

func (s *Server) resolveBackgroundURL(ctx context.Context, provider string) (string, error) {
	switch provider {
	case string(background.ProviderPicsum):
		return s.bgSvc.ResolvePicsumURL()
	case string(background.ProviderUnsplash):
		q := s.getStringSetting(kvBackgroundUnsplashQuery, "")
		return s.bgSvc.ResolveUnsplashURL(q)
	case string(background.ProviderBingRandom):
		return s.bgSvc.ResolveBingRandomURL(ctx)
	case string(background.ProviderBingDaily), string(background.ProviderBing), "":
		fallthrough
	default:
		return s.bgSvc.ResolveBingDailyURL(ctx)
	}
}

func (s *Server) handleRefreshBackground(w http.ResponseWriter, r *http.Request) {
	provider := strings.TrimSpace(r.URL.Query().Get("provider"))
	if provider == "" {
		provider = s.getStringSetting(kvBackgroundProvider, "default")
	}
	if provider == string(background.ProviderBing) {
		provider = string(background.ProviderBingDaily)
	}
	cacheKey := "bg:" + provider
	if provider == string(background.ProviderUnsplash) {
		cacheKey = cacheKey + ":" + s.getStringSetting(kvBackgroundUnsplashQuery, "")
	}
	log.Printf("[bg] refresh requested provider=%s cacheKey=%q", provider, cacheKey)

	// Default provider: nothing remote to fetch.
	if provider == "default" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	// Actually prefetch the next image here so the UI can surface errors.
	// Keep this under the frontend timeout (15s).
	ctx, cancel := context.WithTimeout(r.Context(), 14*time.Second)
	defer cancel()

	imgURL, err := s.resolveBackgroundURL(ctx, provider)
	if err != nil {
		log.Printf("[bg] refresh resolve error: %v", err)
		writeError(w, http.StatusBadGateway, fmt.Sprintf("failed to resolve background url: %v", err))
		return
	}
	res, err := s.bgSvc.FetchToFile(ctx, imgURL)
	if err != nil {
		log.Printf("[bg] refresh fetch error: %v", err)
		writeError(w, http.StatusBadGateway, fmt.Sprintf("failed to fetch background image: %v", err))
		return
	}
	if err := s.store.SetBackgroundCache(cacheKey, res.FileName); err != nil {
		log.Printf("[bg] refresh set cache error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to update background cache")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
