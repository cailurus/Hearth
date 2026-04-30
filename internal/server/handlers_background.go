package server

import (
	"bytes"
	"context"
	"embed"
	"log/slog"
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
	// Backgrounds are large and can be aggressively cached by browsers/proxies.
	// Manual refresh should always take effect immediately.
	w.Header().Set("Cache-Control", "no-store")

	provider := s.getStringSetting(kvBackgroundProvider, "default")
	intervalStr := s.getStringSetting(kvBackgroundInterval, "0")
	interval, _ := time.ParseDuration(intervalStr)

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

	// staleFile tracks the path to a previously-cached image whose freshness
	// window has elapsed. If the upstream fetch below fails, we'd rather
	// serve yesterday's photo than the bundled fallback.
	var staleFile string

	if entry, ok, err := s.store.GetBackgroundCache(cacheKey); err == nil && ok {
		full := filepath.Join(s.cfg.DataDir, "cache", entry.FilePath)
		if st, err := os.Stat(full); err == nil {
			fresh := interval == 0 || time.Since(st.ModTime()) < interval
			if provider == string(background.ProviderBingDaily) {
				// Bing daily: always daily (ignore interval selection).
				fresh = time.Since(st.ModTime()) < 24*time.Hour
			}
			if fresh {
				http.ServeFile(w, r, full)
				return
			}
			staleFile = full
			slog.Debug("background cache stale; will refetch", "provider", provider, "age", time.Since(st.ModTime()))
		} else {
			slog.Debug("background cache entry exists but file is missing", "provider", provider, "error", err)
		}
	} else if err != nil {
		slog.Warn("background cache lookup failed", "provider", provider, "error", err)
	}

	imgURL, err := s.resolveBackgroundURL(r.Context(), provider)
	if err != nil {
		slog.Warn("background URL resolution failed", "provider", provider, "error", err)
		if s.serveStaleOrDefault(w, r, staleFile, provider) {
			return
		}
		writeError(w, http.StatusBadGateway, "failed to fetch background")
		return
	}
	res, err := s.bgSvc.FetchToFile(r.Context(), imgURL)
	if err != nil {
		slog.Warn("background fetch failed", "provider", provider, "url", imgURL, "error", err)
		if s.serveStaleOrDefault(w, r, staleFile, provider) {
			return
		}
		writeError(w, http.StatusBadGateway, "failed to fetch background")
		return
	}
	_ = s.store.SetBackgroundCache(cacheKey, res.FileName)

	full := filepath.Join(s.cfg.DataDir, "cache", res.FileName)
	http.ServeFile(w, r, full)
}

// serveStaleOrDefault preferentially serves a previously-cached background
// (even if past its freshness window), falling back to the bundled default
// only if no usable stale file is on disk. Returns true if a response was
// written to w.
func (s *Server) serveStaleOrDefault(w http.ResponseWriter, r *http.Request, staleFile, provider string) bool {
	if staleFile != "" {
		if _, err := os.Stat(staleFile); err == nil {
			slog.Info("serving stale background cache after upstream failure", "provider", provider, "file", staleFile)
			http.ServeFile(w, r, staleFile)
			return true
		}
	}
	if serveDefaultBackground(w, r) {
		slog.Info("serving bundled default background after upstream failure", "provider", provider)
		return true
	}
	return false
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
		slog.Warn("background prefetch URL resolution failed", "provider", provider, "error", err)
		return
	}
	res, err := s.bgSvc.FetchToFile(ctx, imgURL)
	if err != nil {
		slog.Warn("background prefetch failed", "provider", provider, "error", err)
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
		slog.Warn("background refresh URL resolution failed", "provider", provider, "error", err)
		writeError(w, http.StatusBadGateway, "failed to fetch background")
		return
	}
	res, err := s.bgSvc.FetchToFile(ctx, imgURL)
	if err != nil {
		slog.Warn("background refresh fetch failed", "provider", provider, "error", err)
		writeError(w, http.StatusBadGateway, "failed to fetch background")
		return
	}
	if err := s.store.SetBackgroundCache(cacheKey, res.FileName); err != nil {
		slog.Warn("background refresh cache write failed", "provider", provider, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update background cache")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
