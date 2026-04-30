package server

import "regexp"

// External-API parameter validators. We sanitize anything we forward to a
// third-party service so a malicious query string can't smuggle unexpected
// characters into the upstream request (path traversal, header injection
// via newlines, etc.). Empty strings always validate as "no preference"
// — callers fall back to their per-handler default.

var (
	// ISO 639-1 language code, optionally with a region subtag (e.g. "en", "zh-CN").
	langCodeRe = regexp.MustCompile(`^[a-z]{2}(-[A-Z]{2})?$`)

	// Two-letter lowercase region/country code (ISO 3166-1 alpha-2 lower).
	regionCodeRe = regexp.MustCompile(`^[a-z]{2}$`)
)

// validLang returns the input if it's a recognised language code, otherwise
// the supplied fallback. Empty input always returns the fallback.
func validLang(s, fallback string) string {
	if s == "" {
		return fallback
	}
	if langCodeRe.MatchString(s) {
		return s
	}
	return fallback
}

// validRegion returns the input if it's a 2-letter country code, otherwise
// the supplied fallback. Empty input always returns the fallback.
func validRegion(s, fallback string) string {
	if s == "" {
		return fallback
	}
	if regionCodeRe.MatchString(s) {
		return s
	}
	return fallback
}
