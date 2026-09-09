package server

import "regexp"

// External-API parameter validators. We sanitize anything we forward to a
// third-party service so a malicious query string can't smuggle unexpected
// characters into the upstream request (path traversal, header injection
// via newlines, etc.). Empty strings always validate as "no preference"
// — callers fall back to their per-handler default.

// ISO 639-1 language code, optionally with a region subtag (e.g. "en", "zh-CN").
var langCodeRe = regexp.MustCompile(`^[a-z]{2}(-[A-Z]{2})?$`)

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
