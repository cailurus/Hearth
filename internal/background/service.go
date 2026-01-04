package background

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math/rand/v2"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Provider string

const (
	// ProviderBing is kept for backward compatibility; it behaves like Bing daily.
	ProviderBing Provider = "bing"

	ProviderBingDaily  Provider = "bing_daily"
	ProviderBingRandom Provider = "bing_random"
	ProviderUnsplash   Provider = "unsplash"
	ProviderPicsum     Provider = "picsum"
)

type Config struct {
	CacheDir string
	Client   *http.Client
}

type Service struct {
	cacheDir string
	client   *http.Client
}

func New(cfg Config) (*Service, error) {
	if cfg.CacheDir == "" {
		return nil, errors.New("cache dir required")
	}
	if err := os.MkdirAll(cfg.CacheDir, 0o755); err != nil {
		return nil, err
	}
	c := cfg.Client
	if c == nil {
		c = &http.Client{Timeout: 15 * time.Second}
	}
	return &Service{cacheDir: cfg.CacheDir, client: c}, nil
}

type ImageResult struct {
	FileName string
	MimeType string
}

// Fetches an image and stores it to cacheDir, returning the cached filename.
func (s *Service) FetchToFile(ctx context.Context, imageURL string) (ImageResult, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	req.Header.Set("User-Agent", "Hearth/0.1")
	resp, err := s.client.Do(req)
	if err != nil {
		return ImageResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ImageResult{}, errors.New("bad status")
	}
	ct := resp.Header.Get("Content-Type")
	mt, _, _ := mime.ParseMediaType(ct)
	if mt == "" {
		mt = "image/jpeg"
	}

	ext := extFromMime(mt)
	if ext == "" {
		ext = ".jpg"
	}

	b, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return ImageResult{}, err
	}
	if len(b) == 0 {
		return ImageResult{}, errors.New("empty")
	}

	name := "background" + ext
	full := filepath.Join(s.cacheDir, name)
	tmp := full + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return ImageResult{}, err
	}
	if err := os.Rename(tmp, full); err != nil {
		return ImageResult{}, err
	}
	return ImageResult{FileName: name, MimeType: mt}, nil
}

func extFromMime(mt string) string {
	switch strings.ToLower(mt) {
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/jpeg":
		return ".jpg"
	default:
		return ""
	}
}

func (s *Service) resolveBingURL(ctx context.Context, idx int) (string, error) {
	if idx < 0 {
		idx = 0
	}
	if idx > 7 {
		idx = 7
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.bing.com/HPImageArchive.aspx?format=js&idx="+strconv.Itoa(idx)+"&n=1&mkt=en-US", nil)
	req.Header.Set("User-Agent", "Hearth/0.1")
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", errors.New("bad status")
	}
	var payload struct {
		Images []struct {
			URL string `json:"url"`
		} `json:"images"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", err
	}
	if len(payload.Images) == 0 || payload.Images[0].URL == "" {
		return "", errors.New("no image")
	}
	return "https://www.bing.com" + payload.Images[0].URL, nil
}

// Bing daily image URL.
func (s *Service) ResolveBingDailyURL(ctx context.Context) (string, error) {
	return s.resolveBingURL(ctx, 0)
}

// Bing pseudo-random image URL (random day within the last week).
func (s *Service) ResolveBingRandomURL(ctx context.Context) (string, error) {
	idx := rand.IntN(8)
	return s.resolveBingURL(ctx, idx)
}

// Unsplash URL without API key via source.unsplash.com.
// - empty query: random
// - non-empty query: random image for query
func (s *Service) ResolveUnsplashURL(query string) (string, error) {
	base := "https://source.unsplash.com/1920x1080"
	if strings.TrimSpace(query) == "" {
		return base + "?random=1", nil
	}
	q := url.QueryEscape(strings.TrimSpace(query))
	return base + "?" + q, nil
}

// Picsum random image URL.
func (s *Service) ResolvePicsumURL() (string, error) {
	// Picsum may cache by URL; add a varying query so manual refresh reliably changes.
	return "https://picsum.photos/1920/1080?rand=" + url.QueryEscape(strconv.FormatInt(time.Now().UnixNano(), 10)), nil
}
