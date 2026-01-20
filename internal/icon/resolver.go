package icon

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
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
	IconSource string // site|fallback
}

type Resolver struct {
	Client   *http.Client
	IconsDir string
}

// Common browser User-Agent for better compatibility with websites
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

func New(iconsDir string) *Resolver {
	return &Resolver{
		Client:   &http.Client{Timeout: 15 * time.Second},
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

	htmlBytes, finalURL, err := r.fetchHTML(ctx, u.String())
	if err != nil {
		fallback := resolveURL(finalURL, "/favicon.ico")
		iconFile, err2 := r.downloadIconForPage(ctx, fallback, pageKey)
		if err2 != nil {
			return Result{}, err
		}
		return Result{IconPath: iconFile, IconSource: "fallback"}, nil
	}

	title, iconHref := parseTitleAndIcon(finalURL, htmlBytes)
	if iconHref == "" {
		iconHref = resolveURL(finalURL, "/favicon.ico")
		iconFile, err := r.downloadIconForPage(ctx, iconHref, pageKey)
		if err != nil {
			return Result{Title: title}, nil
		}
		return Result{Title: title, IconPath: iconFile, IconSource: "fallback"}, nil
	}

	// Handle data: URI (base64 encoded icons)
	if strings.HasPrefix(iconHref, "data:") {
		iconFile, err := r.saveDataURI(iconHref, pageKey)
		if err != nil {
			fallback := resolveURL(finalURL, "/favicon.ico")
			if iconFile2, err2 := r.downloadIconForPage(ctx, fallback, pageKey); err2 == nil {
				return Result{Title: title, IconPath: iconFile2, IconSource: "fallback"}, nil
			}
			return Result{Title: title}, nil
		}
		return Result{Title: title, IconPath: iconFile, IconSource: "site"}, nil
	}

	iconFile, err := r.downloadIconForPage(ctx, iconHref, pageKey)
	if err != nil {
		fallback := resolveURL(finalURL, "/favicon.ico")
		if iconFile2, err2 := r.downloadIconForPage(ctx, fallback, pageKey); err2 == nil {
			return Result{Title: title, IconPath: iconFile2, IconSource: "fallback"}, nil
		}
		return Result{Title: title}, nil
	}

	return Result{Title: title, IconPath: iconFile, IconSource: "site"}, nil
}

// hashString returns a short hash of the input string
func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:8]) // Use first 8 bytes (16 hex chars)
}

func (r *Resolver) fetchHTML(ctx context.Context, pageURL string) ([]byte, string, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	resp, err := r.Client.Do(req)
	if err != nil {
		return nil, pageURL, err
	}
	defer resp.Body.Close()

	finalURL := resp.Request.URL.String()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, finalURL, errors.New("bad status")
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
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, iconURL, nil)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "image/*,*/*;q=0.8")
	resp, err := r.Client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", errors.New("bad status")
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", errors.New("empty")
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
			ext = ".ico"
		}
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
