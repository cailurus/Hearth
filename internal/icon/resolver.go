package icon

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net"
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
	if u.Scheme != "http" && u.Scheme != "https" {
		return Result{}, errors.New("unsupported scheme")
	}
	// Strip fragment — it's client-side routing, not sent to server.
	u.Fragment = ""
	u.RawFragment = ""
	cleanURL := u.String()

	pageKey := hashString(cleanURL)

	// Step 1: Try to fetch HTML and extract icon candidates.
	htmlBytes, finalURL, err := r.fetchHTML(ctx, cleanURL)
	if err != nil {
		slog.Debug("failed to fetch HTML", "url", cleanURL, "error", err)
		return r.tryFallbacks(ctx, u, pageKey)
	}

	parsed := parseHTMLIcons(finalURL, htmlBytes)
	title := parsed.title

	// Step 2: Try manifest icons — PWA manifests contain the definitive
	// favicon set and are what browsers actually use for tabs on JS-heavy sites.
	if parsed.manifestURL != "" {
		if iconFile, err := r.tryManifestIcons(ctx, parsed.manifestURL, pageKey); err == nil {
			return Result{Title: title, IconPath: iconFile, IconSource: "site"}, nil
		}
	}

	// Step 3: Try favicon candidates (rel="icon" / rel="shortcut icon").
	if iconFile, src, ok := r.tryCandidates(ctx, parsed.favicons, pageKey); ok {
		return Result{Title: title, IconPath: iconFile, IconSource: src}, nil
	}

	// Step 4: Try well-known fallback paths (/favicon.ico, etc.) + Google.
	result, err := r.tryFallbacks(ctx, u, pageKey)
	if err == nil {
		result.Title = title
		return result, nil
	}

	// Step 5: Try non-tab fallbacks (apple-touch-icon, og:image) as last resort.
	if iconFile, src, ok := r.tryCandidates(ctx, parsed.fallbacks, pageKey); ok {
		return Result{Title: title, IconPath: iconFile, IconSource: src}, nil
	}

	return Result{Title: title}, nil
}

// ---------------------------------------------------------------------------
// Candidate downloading
// ---------------------------------------------------------------------------

func (r *Resolver) tryCandidates(ctx context.Context, candidates []string, pageKey string) (string, string, bool) {
	for _, href := range candidates {
		if strings.HasPrefix(href, "data:") {
			iconFile, err := r.saveDataURI(href, pageKey)
			if err == nil {
				return iconFile, "site", true
			}
			slog.Debug("failed to save data URI", "error", err)
			continue
		}
		iconFile, err := r.downloadIconForPage(ctx, href, pageKey)
		if err == nil {
			return iconFile, "site", true
		}
		slog.Debug("failed to download icon candidate", "url", href, "error", err)
	}
	return "", "", false
}

// ---------------------------------------------------------------------------
// Web-app manifest icon extraction
// ---------------------------------------------------------------------------

// tryManifestIcons fetches a web-app manifest JSON and tries to download icons
// from it, preferring small square sizes (16-64px) that match browser tab favicons.
func (r *Resolver) tryManifestIcons(ctx context.Context, manifestURL string, pageKey string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json,*/*;q=0.5")

	resp, err := r.Client.Do(req)
	if err != nil {
		if isTLSError(err) && allowInsecureRetry(manifestURL) {
			resp, err = r.InsecureClient.Do(req)
		}
		if err != nil {
			return "", err
		}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("manifest fetch: bad status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 256<<10))
	if err != nil {
		return "", err
	}

	var manifest struct {
		Icons []struct {
			Src   string `json:"src"`
			Sizes string `json:"sizes"`
			Type  string `json:"type"`
		} `json:"icons"`
	}
	if err := json.Unmarshal(body, &manifest); err != nil {
		return "", err
	}
	if len(manifest.Icons) == 0 {
		return "", errors.New("manifest has no icons")
	}

	// Build candidates sorted by favicon suitability (small square first).
	candidates := make([]iconCandidate, 0, len(manifest.Icons))
	for _, ic := range manifest.Icons {
		if ic.Src == "" {
			continue
		}
		href := resolveURL(manifestURL, ic.Src)
		p := manifestIconPriority(ic.Sizes)
		candidates = append(candidates, iconCandidate{href: href, priority: p})
	}
	sortCandidates(candidates)

	for _, c := range candidates {
		iconFile, err := r.downloadIconForPage(ctx, c.href, pageKey)
		if err == nil {
			return iconFile, nil
		}
		slog.Debug("failed to download manifest icon", "url", c.href, "error", err)
	}
	return "", errors.New("no downloadable manifest icon")
}

// manifestIconPriority scores manifest icons — prefer standard favicon sizes.
func manifestIconPriority(sizes string) int {
	if sizes == "" || sizes == "any" {
		return 10
	}
	parts := strings.Split(strings.ToLower(sizes), "x")
	if len(parts) < 2 {
		return 10
	}
	w, err1 := strconv.Atoi(parts[0])
	h, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 10
	}
	// Non-square icons are less useful as favicons.
	if w != h {
		return 5
	}
	switch {
	case w >= 16 && w <= 64:
		return 100 // ideal tab favicon size
	case w <= 128:
		return 80
	case w <= 256:
		return 50
	default:
		return 20 // 512x512 etc — PWA install icon
	}
}

// ---------------------------------------------------------------------------
// Fallback paths
// ---------------------------------------------------------------------------

func (r *Resolver) tryFallbacks(ctx context.Context, u *url.URL, pageKey string) (Result, error) {
	baseURL := fmt.Sprintf("%s://%s", u.Scheme, u.Host)

	// 1. Standard favicon well-known paths (what browsers actually show in tabs).
	faviconPaths := []string{
		"/favicon.ico",
		"/favicon.png",
		"/favicon.svg",
	}
	// Also try path-relative favicons for apps mounted under a sub-path.
	if dir := path.Dir(u.Path); dir != "" && dir != "/" && dir != "." {
		faviconPaths = append(faviconPaths, dir+"/favicon.ico", dir+"/favicon.png")
	}
	for _, p := range faviconPaths {
		iconFile, err := r.downloadIconForPage(ctx, baseURL+p, pageKey)
		if err == nil {
			return Result{IconPath: iconFile, IconSource: "fallback"}, nil
		}
	}

	// 2. Google favicon service — returns the real tab favicon that Google has
	//    crawled (with JS execution), so it works for SPAs too.
	if !isPrivateHost(u.Host) {
		googleURL := fmt.Sprintf("https://www.google.com/s2/favicons?domain=%s&sz=128", u.Host)
		iconFile, err := r.downloadIconForPage(ctx, googleURL, pageKey)
		if err == nil {
			return Result{IconPath: iconFile, IconSource: "google"}, nil
		}
		slog.Debug("google favicon service failed", "host", u.Host, "error", err)
	}

	// 3. Apple touch icon as absolute last resort — these are iOS home screen
	//    icons, typically the site logo rather than the tab favicon.
	applePaths := []string{
		"/apple-touch-icon.png",
		"/apple-touch-icon-precomposed.png",
	}
	for _, p := range applePaths {
		iconFile, err := r.downloadIconForPage(ctx, baseURL+p, pageKey)
		if err == nil {
			return Result{IconPath: iconFile, IconSource: "fallback"}, nil
		}
	}

	return Result{}, errors.New("no icon found")
}

// ---------------------------------------------------------------------------
// Private-network detection (used only to skip Google favicon for internal hosts)
// ---------------------------------------------------------------------------

var privateNets = func() []*net.IPNet {
	cidrs := []string{
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
		"127.0.0.0/8", "169.254.0.0/16",
		"::1/128", "fc00::/7", "fe80::/10",
	}
	nets := make([]*net.IPNet, 0, len(cidrs))
	for _, cidr := range cidrs {
		_, n, err := net.ParseCIDR(cidr)
		if err == nil {
			nets = append(nets, n)
		}
	}
	return nets
}()

func isPrivateHost(host string) bool {
	h, _, err := net.SplitHostPort(host)
	if err != nil {
		h = host
	}
	if h == "localhost" || strings.HasSuffix(h, ".local") || strings.HasSuffix(h, ".lan") {
		return true
	}
	ip := net.ParseIP(h)
	if ip == nil {
		ips, err := net.LookupIP(h)
		if err != nil || len(ips) == 0 {
			return false
		}
		ip = ips[0]
	}
	for _, n := range privateNets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// allowInsecureRetry decides whether a TLS-error fallback to InsecureClient is
// safe for the given URL. We only allow it when the host resolves into a
// private / loopback network (or uses homelab-style suffixes) — for any public
// hostname, an attacker that can break the TLS handshake could otherwise
// poison the icon cache, which is then served back to browsers under our origin.
func allowInsecureRetry(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return false
	}
	return isPrivateHost(u.Host)
}

// ---------------------------------------------------------------------------
// HTML fetching (with automatic TLS-error retry using insecure client)
// ---------------------------------------------------------------------------

func (r *Resolver) fetchHTML(ctx context.Context, pageURL string) ([]byte, string, error) {
	htmlBytes, finalURL, err := r.fetchHTMLWithClient(ctx, pageURL, r.Client)
	if err != nil {
		if isTLSError(err) && allowInsecureRetry(pageURL) {
			slog.Debug("retrying with insecure client due to TLS error (private host)", "url", pageURL)
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
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("Connection", "keep-alive")

	resp, err := client.Do(req)
	if err != nil {
		return nil, pageURL, err
	}
	defer resp.Body.Close()

	finalURL := resp.Request.URL.String()

	// Accept any non-5xx response — many internal pages return 401/403 with
	// valid HTML that contains icon links.
	if resp.StatusCode >= 500 {
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

// ---------------------------------------------------------------------------
// HTML parsing — extract title and ALL icon candidates sorted by priority
// ---------------------------------------------------------------------------

type iconCandidate struct {
	href     string
	priority int
}

// htmlParseResult holds everything extracted from the HTML <head>.
type htmlParseResult struct {
	title       string
	favicons    []string // rel="icon" / rel="shortcut icon"
	fallbacks   []string // apple-touch-icon, og:image, msapplication-TileImage
	manifestURL string   // <link rel="manifest"> href, if any
}

// parseHTMLIcons extracts the page title, icon candidates split into favicon
// vs fallback tiers, and the web-app manifest URL.
func parseHTMLIcons(baseURL string, htmlBytes []byte) htmlParseResult {
	doc, err := html.Parse(bytes.NewReader(htmlBytes))
	if err != nil {
		return htmlParseResult{}
	}

	var res htmlParseResult
	var favicons []iconCandidate
	var fallbacks []iconCandidate

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "title":
				if n.FirstChild != nil && res.title == "" {
					res.title = strings.Join(strings.Fields(strings.TrimSpace(n.FirstChild.Data)), " ")
				}

			case "link":
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
				if href == "" {
					break
				}
				if rel == "manifest" {
					res.manifestURL = resolveURL(baseURL, href)
				} else if strings.Contains(rel, "icon") {
					p := iconPriority(rel, sizes, href)
					c := iconCandidate{href: resolveURL(baseURL, href), priority: p}
					if strings.Contains(rel, "apple-touch-icon") {
						fallbacks = append(fallbacks, c)
					} else {
						favicons = append(favicons, c)
					}
				}

			case "meta":
				// og:image or msapplication-TileImage as low-priority fallback.
				var prop, content string
				for _, a := range n.Attr {
					switch strings.ToLower(a.Key) {
					case "property", "name":
						prop = strings.ToLower(a.Val)
					case "content":
						content = a.Val
					}
				}
				if content != "" {
					if prop == "og:image" || prop == "msapplication-tileimage" {
						fallbacks = append(fallbacks, iconCandidate{
							href:     resolveURL(baseURL, content),
							priority: 5,
						})
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	dedup := func(cs []iconCandidate) []string {
		sortCandidates(cs)
		seen := map[string]bool{}
		out := make([]string, 0, len(cs))
		for _, c := range cs {
			if seen[c.href] {
				continue
			}
			seen[c.href] = true
			out = append(out, c.href)
		}
		return out
	}

	res.favicons = dedup(favicons)
	res.fallbacks = dedup(fallbacks)
	return res
}

func iconPriority(rel, sizes, href string) int {
	p := 0
	if strings.Contains(rel, "apple-touch-icon") {
		p = 100
	} else if strings.Contains(rel, "icon") {
		p = 50
	} else if strings.Contains(rel, "shortcut") {
		p = 10
	}

	// Prefer standard favicon sizes (16-64px); penalize oversized icons that
	// are likely logos rather than tab favicons.
	if sizes != "" && sizes != "any" {
		parts := strings.Split(sizes, "x")
		if len(parts) >= 1 {
			if s, err := strconv.Atoi(parts[0]); err == nil {
				if s >= 16 && s <= 64 {
					p += 30
				} else if s <= 128 {
					p += 20
				} else if s <= 256 {
					p += 10
				}
				// >256px gets no bonus — too large for a favicon
			}
		}
	}

	hrefLower := strings.ToLower(href)
	if strings.HasSuffix(hrefLower, ".svg") {
		p += 25
	} else if strings.HasSuffix(hrefLower, ".png") {
		p += 20
	} else if strings.HasSuffix(hrefLower, ".webp") {
		p += 15
	}

	return p
}

// Simple insertion sort (lists are tiny).
func sortCandidates(cs []iconCandidate) {
	for i := 1; i < len(cs); i++ {
		for j := i; j > 0 && cs[j].priority > cs[j-1].priority; j-- {
			cs[j], cs[j-1] = cs[j-1], cs[j]
		}
	}
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

// ---------------------------------------------------------------------------
// Icon downloading (with TLS-error retry)
// ---------------------------------------------------------------------------

func (r *Resolver) downloadIcon(ctx context.Context, iconURL string) (string, error) {
	return r.downloadIconForPage(ctx, iconURL, "")
}

func (r *Resolver) downloadIconForPage(ctx context.Context, iconURL string, pageKey string) (string, error) {
	iconFile, err := r.downloadIconWithClient(ctx, iconURL, pageKey, r.Client)
	if err != nil {
		if isTLSError(err) && allowInsecureRetry(iconURL) {
			slog.Debug("retrying icon download with insecure client (private host)", "url", iconURL)
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

	if !looksLikeImage(data) {
		return "", errors.New("response doesn't look like an image")
	}

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

// ---------------------------------------------------------------------------
// Data URI handling
// ---------------------------------------------------------------------------

func (r *Resolver) saveDataURI(dataURI string, pageKey string) (string, error) {
	if !strings.HasPrefix(dataURI, "data:") {
		return "", errors.New("not a data URI")
	}
	commaIdx := strings.Index(dataURI, ",")
	if commaIdx == -1 {
		return "", errors.New("invalid data URI format")
	}

	header := dataURI[5:commaIdx]
	dataStr := dataURI[commaIdx+1:]
	isBase64 := strings.Contains(header, ";base64")

	var data []byte
	var err error
	if isBase64 {
		data, err = base64.StdEncoding.DecodeString(dataStr)
		if err != nil {
			return "", err
		}
	} else {
		decoded, err := url.QueryUnescape(dataStr)
		if err != nil {
			return "", err
		}
		data = []byte(decoded)
	}
	if len(data) == 0 {
		return "", errors.New("empty data URI")
	}

	mediaType := strings.Split(header, ";")[0]
	ext := extFromMediaType(mediaType)
	if ext == "" {
		ext = ".ico"
	}

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:8])
}

func isTLSError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "certificate") ||
		strings.Contains(msg, "x509") ||
		strings.Contains(msg, "tls")
}

func looksLikeImage(data []byte) bool {
	if len(data) < 4 {
		return false
	}
	// PNG
	if data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
		return true
	}
	// JPEG
	if data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return true
	}
	// GIF
	if data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38 {
		return true
	}
	// ICO
	if data[0] == 0x00 && data[1] == 0x00 && (data[2] == 0x01 || data[2] == 0x02) && data[3] == 0x00 {
		return true
	}
	// WebP
	if len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return true
	}
	// SVG
	if data[0] == '<' {
		s := strings.ToLower(string(data[:min(len(data), 256)]))
		if strings.Contains(s, "<svg") || strings.Contains(s, "<?xml") {
			return true
		}
	}
	// BMP
	if data[0] == 0x42 && data[1] == 0x4D {
		return true
	}
	return false
}

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
