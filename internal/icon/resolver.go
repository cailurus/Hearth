package icon

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html"
)

type Result struct {
	Title      string
	IconPath   string // local file name within icons dir
	IconSource string // site|fallback|google
}

type Resolver struct {
	Client         *http.Client
	InsecureClient *http.Client // For sites with self-signed certs
	IconsDir       string
}

// Common browser User-Agent for better compatibility with websites
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

func New(iconsDir string) *Resolver {
	return &Resolver{
		Client: &http.Client{Timeout: 15 * time.Second},
		InsecureClient: &http.Client{
			Timeout: 15 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
		IconsDir: iconsDir,
	}
}

func (r *Resolver) ResolveAndCache(ctx context.Context, pageURL string) (Result, error) {
	u, err := url.Parse(pageURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return Result{}, errors.New("invalid url")
	}

	// Generate a unique key based on the original page URL
	pageKey := hashString(pageURL)

	// Try to fetch HTML and parse icons
	htmlBytes, finalURL, err := r.fetchHTML(ctx, u.String())
	if err != nil {
		slog.Debug("failed to fetch HTML", "url", pageURL, "error", err)
		// Try direct favicon paths as fallback
		return r.tryFallbacks(ctx, u, pageKey)
	}

	title, iconHref := parseTitleAndIcon(finalURL, htmlBytes)

	// If we found an icon in HTML, try to download it
	if iconHref != "" {
		// Handle data: URI (base64 encoded icons)
		if strings.HasPrefix(iconHref, "data:") {
			iconFile, err := r.saveDataURI(iconHref, pageKey)
			if err == nil {
				return Result{Title: title, IconPath: iconFile, IconSource: "site"}, nil
			}
			slog.Debug("failed to save data URI", "error", err)
		} else {
			iconFile, err := r.downloadIconForPage(ctx, iconHref, pageKey)
			if err == nil {
				return Result{Title: title, IconPath: iconFile, IconSource: "site"}, nil
			}
			slog.Debug("failed to download icon from HTML", "url", iconHref, "error", err)
		}
	}

	// Try fallback methods
	result, err := r.tryFallbacks(ctx, u, pageKey)
	if err == nil {
		result.Title = title
		return result, nil
	}

	// If all failed, return title only
	return Result{Title: title}, nil
}

// tryFallbacks tries multiple fallback methods to get an icon
func (r *Resolver) tryFallbacks(ctx context.Context, u *url.URL, pageKey string) (Result, error) {
	baseURL := fmt.Sprintf("%s://%s", u.Scheme, u.Host)

	// Common favicon paths to try
	fallbackPaths := []string{
		"/favicon.ico",
		"/favicon.png",
		"/apple-touch-icon.png",
		"/apple-touch-icon-precomposed.png",
		"/apple-touch-icon-180x180.png",
		"/apple-touch-icon-152x152.png",
		"/apple-touch-icon-120x120.png",
	}

	for _, p := range fallbackPaths {
		iconURL := baseURL + p
		iconFile, err := r.downloadIconForPage(ctx, iconURL, pageKey)
		if err == nil {
			return Result{IconPath: iconFile, IconSource: "fallback"}, nil
		}
	}

	// Try Google's favicon service as last resort (only for public domains)
	if !isPrivateHost(u.Host) {
		googleURL := fmt.Sprintf("https://www.google.com/s2/favicons?domain=%s&sz=128", u.Host)
		iconFile, err := r.downloadIconForPage(ctx, googleURL, pageKey)
		if err == nil {
			return Result{IconPath: iconFile, IconSource: "google"}, nil
		}
		slog.Debug("google favicon service failed", "host", u.Host, "error", err)
	}

	return Result{}, errors.New("no icon found")
}

// isPrivateHost checks if the host is a private/internal address
func isPrivateHost(host string) bool {
	// Remove port if present
	h := host
	if idx := strings.LastIndex(host, ":"); idx != -1 {
		h = host[:idx]
	}

	// Check common private patterns
	if h == "localhost" || strings.HasSuffix(h, ".local") || strings.HasSuffix(h, ".lan") {
		return true
	}

	// Check private IP ranges (simplified)
	if strings.HasPrefix(h, "10.") ||
		strings.HasPrefix(h, "192.168.") ||
		strings.HasPrefix(h, "172.16.") ||
		strings.HasPrefix(h, "172.17.") ||
		strings.HasPrefix(h, "172.18.") ||
		strings.HasPrefix(h, "172.19.") ||
		strings.HasPrefix(h, "172.2") ||
		strings.HasPrefix(h, "172.30.") ||
		strings.HasPrefix(h, "172.31.") ||
		h == "127.0.0.1" ||
		h == "::1" {
		return true
	}

	return false
}

// hashString returns a short hash of the input string
func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:8]) // Use first 8 bytes (16 hex chars)
}

func (r *Resolver) fetchHTML(ctx context.Context, pageURL string) ([]byte, string, error) {
	// Try with regular client first
	htmlBytes, finalURL, err := r.fetchHTMLWithClient(ctx, pageURL, r.Client)
	if err != nil {
		// If it failed due to TLS error, retry with insecure client
		if strings.Contains(err.Error(), "certificate") ||
			strings.Contains(err.Error(), "x509") ||
			strings.Contains(err.Error(), "tls") {
			slog.Debug("retrying with insecure client due to TLS error", "url", pageURL)
			return r.fetchHTMLWithClient(ctx, pageURL, r.InsecureClient)
		}
		return nil, pageURL, err
	}
	return htmlBytes, finalURL, nil
}

func (r *Resolver) fetchHTMLWithClient(ctx context.Context, pageURL string, client *http.Client) ([]byte, string, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7")
	req.Header.Set("Accept-Encoding", "identity") // Avoid gzip issues
	req.Header.Set("Connection", "keep-alive")

	resp, err := client.Do(req)
	if err != nil {
		return nil, pageURL, err
	}
	defer resp.Body.Close()

	finalURL := resp.Request.URL.String()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, finalURL, fmt.Errorf("bad status: %d", resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if ct != "" {
		mt, _, _ := mime.ParseMediaType(ct)
		if mt != "" && !strings.Contains(mt, "html") {
			return nil, finalURL, errors.New("not html")
		}
	}

	b, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, finalURL, err
	}
	return b, finalURL, nil
}

func parseTitleAndIcon(baseURL string, htmlBytes []byte) (string, string) {
	doc, err := html.Parse(bytes.NewReader(htmlBytes))
	if err != nil {
		return "", ""
	}

	var title string

	// Collect all icon candidates with priority
	type iconCandidate struct {
		href     string
		priority int // higher is better
		size     int // parsed from sizes attribute
	}
	var icons []iconCandidate

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "title" && n.FirstChild != nil && title == "" {
			title = strings.TrimSpace(n.FirstChild.Data)
		}
		if n.Type == html.ElementNode && n.Data == "link" {
			var rel, href, sizes string
			for _, a := range n.Attr {
				switch strings.ToLower(a.Key) {
				case "rel":
					rel = strings.ToLower(a.Val)
				case "href":
					href = a.Val
				case "sizes":
					sizes = strings.ToLower(a.Val)
				}
			}
			if href != "" && strings.Contains(rel, "icon") {
				priority := 0
				size := 0

				// Priority based on rel type
				if strings.Contains(rel, "apple-touch-icon") {
					priority = 100 // Apple touch icons are usually high quality
				} else if strings.Contains(rel, "icon") {
					priority = 50
				} else if strings.Contains(rel, "shortcut") {
					priority = 10
				}

				// Parse size (e.g., "192x192" -> 192)
				if sizes != "" && sizes != "any" {
					parts := strings.Split(sizes, "x")
					if len(parts) >= 1 {
						if s, err := strconv.Atoi(parts[0]); err == nil {
							size = s
							// Prefer larger icons up to 192px
							if size >= 128 && size <= 192 {
								priority += 30
							} else if size >= 64 {
								priority += 20
							} else if size >= 32 {
								priority += 10
							}
						}
					}
				}

				// Prefer PNG and SVG over ICO
				hrefLower := strings.ToLower(href)
				if strings.HasSuffix(hrefLower, ".svg") {
					priority += 25
				} else if strings.HasSuffix(hrefLower, ".png") {
					priority += 20
				} else if strings.HasSuffix(hrefLower, ".webp") {
					priority += 15
				}

				icons = append(icons, iconCandidate{
					href:     resolveURL(baseURL, href),
					priority: priority,
					size:     size,
				})
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	// Select best icon
	var bestIcon string
	bestPriority := -1
	for _, ic := range icons {
		if ic.priority > bestPriority {
			bestPriority = ic.priority
			bestIcon = ic.href
		}
	}

	return title, bestIcon
}

func resolveURL(base, href string) string {
	u, err := url.Parse(href)
	if err == nil && u.IsAbs() {
		return u.String()
	}
	b, err := url.Parse(base)
	if err != nil {
		return href
	}
	ref, err := url.Parse(href)
	if err != nil {
		return href
	}
	return b.ResolveReference(ref).String()
}

func (r *Resolver) downloadIcon(ctx context.Context, iconURL string) (string, error) {
	return r.downloadIconForPage(ctx, iconURL, "")
}

// saveDataURI handles data: URI (base64 encoded) icons and saves them to disk
func (r *Resolver) saveDataURI(dataURI string, pageKey string) (string, error) {
	// Format: data:[<mediatype>][;base64],<data>
	// Example: data:image/x-icon;base64,AAABAAMAEBAAAAEAIABoBAA...
	if !strings.HasPrefix(dataURI, "data:") {
		return "", errors.New("not a data URI")
	}

	commaIdx := strings.Index(dataURI, ",")
	if commaIdx == -1 {
		return "", errors.New("invalid data URI format")
	}

	header := dataURI[5:commaIdx] // skip "data:"
	dataStr := dataURI[commaIdx+1:]

	// Check if base64 encoded
	isBase64 := strings.Contains(header, ";base64")

	var data []byte
	var err error
	if isBase64 {
		data, err = base64.StdEncoding.DecodeString(dataStr)
		if err != nil {
			return "", err
		}
	} else {
		// URL encoded data
		decoded, err := url.QueryUnescape(dataStr)
		if err != nil {
			return "", err
		}
		data = []byte(decoded)
	}

	if len(data) == 0 {
		return "", errors.New("empty data URI")
	}

	// Determine extension from media type
	mediaType := strings.Split(header, ";")[0]
	ext := extFromMediaType(mediaType)
	if ext == "" {
		ext = ".ico" // default
	}

	// Include pageKey in the hash to ensure each page URL gets its own icon file
	h := sha256.New()
	if pageKey != "" {
		h.Write([]byte(pageKey))
		h.Write([]byte(":"))
	}
	h.Write(data)
	sum := hex.EncodeToString(h.Sum(nil))

	filename := sum + ext
	full := filepath.Join(r.IconsDir, filename)
	if err := osWriteFileAtomic(full, data); err != nil {
		return "", err
	}
	return filename, nil
}

// downloadIconForPage downloads an icon and saves it with a filename that includes
// the page key to ensure different pages get different icon files even if the
// actual icon content is the same.
func (r *Resolver) downloadIconForPage(ctx context.Context, iconURL string, pageKey string) (string, error) {
	// Try with regular client first
	iconFile, err := r.downloadIconWithClient(ctx, iconURL, pageKey, r.Client)
	if err != nil {
		// If it failed due to TLS error, retry with insecure client
		if strings.Contains(err.Error(), "certificate") ||
			strings.Contains(err.Error(), "x509") ||
			strings.Contains(err.Error(), "tls") {
			slog.Debug("retrying icon download with insecure client", "url", iconURL)
			return r.downloadIconWithClient(ctx, iconURL, pageKey, r.InsecureClient)
		}
		return "", err
	}
	return iconFile, nil
}

func (r *Resolver) downloadIconWithClient(ctx context.Context, iconURL string, pageKey string, client *http.Client) (string, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, iconURL, nil)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "image/*,*/*;q=0.8")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("bad status: %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", errors.New("empty response")
	}

	// Validate that it looks like an image (basic check)
	if !looksLikeImage(data) {
		return "", errors.New("response doesn't look like an image")
	}

	// Include pageKey in the hash to ensure each page URL gets its own icon file
	h := sha256.New()
	if pageKey != "" {
		h.Write([]byte(pageKey))
		h.Write([]byte(":"))
	}
	h.Write(data)
	sum := hex.EncodeToString(h.Sum(nil))

	ext := extFromContentType(resp.Header.Get("Content-Type"))
	if ext == "" {
		ext = path.Ext(resp.Request.URL.Path)
		if ext == "" {
			// Try to detect from content
			ext = detectImageExt(data)
		}
	}
	if ext == "" {
		ext = ".ico"
	}
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}

	filename := sum + ext
	full := filepath.Join(r.IconsDir, filename)
	if err := osWriteFileAtomic(full, data); err != nil {
		return "", err
	}
	return filename, nil
}

// looksLikeImage does a basic check to see if the data might be an image
func looksLikeImage(data []byte) bool {
	if len(data) < 4 {
		return false
	}

	// Check common image magic bytes
	// PNG: 89 50 4E 47
	if data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
		return true
	}
	// JPEG: FF D8 FF
	if data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return true
	}
	// GIF: 47 49 46 38
	if data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38 {
		return true
	}
	// ICO: 00 00 01 00 or 00 00 02 00
	if data[0] == 0x00 && data[1] == 0x00 && (data[2] == 0x01 || data[2] == 0x02) && data[3] == 0x00 {
		return true
	}
	// WebP: RIFF....WEBP
	if len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return true
	}
	// SVG: starts with < (XML)
	if data[0] == '<' {
		s := strings.ToLower(string(data[:min(len(data), 256)]))
		if strings.Contains(s, "<svg") || strings.Contains(s, "<?xml") {
			return true
		}
	}
	// BMP: 42 4D
	if data[0] == 0x42 && data[1] == 0x4D {
		return true
	}

	return false
}

// detectImageExt tries to detect the image format from content
func detectImageExt(data []byte) string {
	if len(data) < 4 {
		return ""
	}

	if data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
		return ".png"
	}
	if data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return ".jpg"
	}
	if data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38 {
		return ".gif"
	}
	if data[0] == 0x00 && data[1] == 0x00 && (data[2] == 0x01 || data[2] == 0x02) && data[3] == 0x00 {
		return ".ico"
	}
	if len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return ".webp"
	}
	if data[0] == '<' {
		return ".svg"
	}

	return ""
}

func extFromContentType(ct string) string {
	mt, _, _ := mime.ParseMediaType(ct)
	return extFromMediaType(mt)
}

func extFromMediaType(mt string) string {
	switch strings.ToLower(mt) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/svg+xml":
		return ".svg"
	case "image/x-icon", "image/vnd.microsoft.icon":
		return ".ico"
	case "image/gif":
		return ".gif"
	default:
		return ""
	}
}

func osWriteFileAtomic(p string, data []byte) error {
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}
