package icon

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
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

func New(iconsDir string) *Resolver {
	return &Resolver{
		Client:   &http.Client{Timeout: 12 * time.Second},
		IconsDir: iconsDir,
	}
}

func (r *Resolver) ResolveAndCache(ctx context.Context, pageURL string) (Result, error) {
	u, err := url.Parse(pageURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return Result{}, errors.New("invalid url")
	}

	htmlBytes, finalURL, err := r.fetchHTML(ctx, u.String())
	if err != nil {
		fallback := resolveURL(finalURL, "/favicon.ico")
		iconFile, err2 := r.downloadIcon(ctx, fallback)
		if err2 != nil {
			return Result{}, err
		}
		return Result{IconPath: iconFile, IconSource: "fallback"}, nil
	}

	title, iconHref := parseTitleAndIcon(finalURL, htmlBytes)
	if iconHref == "" {
		iconHref = resolveURL(finalURL, "/favicon.ico")
		iconFile, err := r.downloadIcon(ctx, iconHref)
		if err != nil {
			return Result{Title: title}, nil
		}
		return Result{Title: title, IconPath: iconFile, IconSource: "fallback"}, nil
	}

	iconFile, err := r.downloadIcon(ctx, iconHref)
	if err != nil {
		fallback := resolveURL(finalURL, "/favicon.ico")
		if iconFile2, err2 := r.downloadIcon(ctx, fallback); err2 == nil {
			return Result{Title: title, IconPath: iconFile2, IconSource: "fallback"}, nil
		}
		return Result{Title: title}, nil
	}

	return Result{Title: title, IconPath: iconFile, IconSource: "site"}, nil
}

func (r *Resolver) fetchHTML(ctx context.Context, pageURL string) ([]byte, string, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	req.Header.Set("User-Agent", "Hearth/0.1")
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
	var iconHref string

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "title" && n.FirstChild != nil && title == "" {
			title = strings.TrimSpace(n.FirstChild.Data)
		}
		if n.Type == html.ElementNode && n.Data == "link" {
			var rel, href string
			for _, a := range n.Attr {
				switch strings.ToLower(a.Key) {
				case "rel":
					rel = strings.ToLower(a.Val)
				case "href":
					href = a.Val
				}
			}
			if href != "" && strings.Contains(rel, "icon") {
				if iconHref == "" || strings.Contains(rel, "apple-touch-icon") {
					iconHref = resolveURL(baseURL, href)
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	return title, iconHref
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
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, iconURL, nil)
	req.Header.Set("User-Agent", "Hearth/0.1")
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

	h := sha256.Sum256(data)
	sum := hex.EncodeToString(h[:])

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
