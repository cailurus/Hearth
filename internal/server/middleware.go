package server

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"strings"
)

type ctxKey string

const (
	ctxUserID ctxKey = "userID"
)

func withUserID(r *http.Request, userID string) *http.Request {
	ctx := context.WithValue(r.Context(), ctxUserID, userID)
	return r.WithContext(ctx)
}

func userIDFromContext(r *http.Request) (string, bool) {
	v := r.Context().Value(ctxUserID)
	id, ok := v.(string)
	return id, ok && id != ""
}

// forwardAuth honors a username header set by an upstream reverse proxy
// (Authelia / Authentik / oauth2-proxy / Caddy forward_auth / Traefik
// forwardAuth). When both `HEARTH_TRUSTED_PROXY_HEADER` and
// `HEARTH_TRUSTED_PROXY_NETWORKS` are configured AND the request arrives
// from one of the trusted source CIDRs AND the header is non-empty, the
// corresponding user is provisioned (created on first sight) and the
// userID is attached to the request context. Subsequent middlewares
// (`requireAdmin`, `optionalUser`) prefer the context user over the
// cookie session, so forward-auth users never need a Hearth password.
//
// Bypassing the proxy and hitting Hearth directly does NOT grant access:
// the source-IP guard refuses requests that don't come from the
// configured proxy network.
func (s *Server) forwardAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := s.cfg.TrustedProxyHeader
		if header == "" || len(s.trustedProxyNetworks) == 0 {
			next.ServeHTTP(w, r)
			return
		}
		if !s.isTrustedProxy(r) {
			next.ServeHTTP(w, r)
			return
		}
		username := strings.TrimSpace(r.Header.Get(header))
		if username == "" {
			next.ServeHTTP(w, r)
			return
		}
		userID, err := s.auth.ProvisionForwardAuthUser(username)
		if err != nil {
			slog.Warn("forward auth provision failed", "username", username, "error", err)
			next.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, withUserID(r, userID))
	})
}

func (s *Server) isTrustedProxy(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, n := range s.trustedProxyNetworks {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Forward-auth middleware (when enabled) may have already attached a
		// userID via the upstream proxy header; if so, trust it and skip the
		// cookie-session path.
		userID, ok := userIDFromContext(r)
		if !ok {
			cookie, err := r.Cookie("hearth_session")
			if err != nil || cookie.Value == "" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			userID, err = s.auth.Validate(cookie.Value)
			if err != nil {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			r = withUserID(r, userID)
		}
		// While the operator hasn't replaced the generated initial password, all
		// admin endpoints are blocked except the password-change endpoint itself.
		if r.URL.Path != "/api/auth/password" {
			if must, _ := s.auth.MustChangePassword(userID); must {
				writeError(w, http.StatusForbidden, "must_change_password")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) optionalUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// If forward-auth middleware already attached a userID, honor it.
		if _, ok := userIDFromContext(r); ok {
			next.ServeHTTP(w, r)
			return
		}
		cookie, err := r.Cookie("hearth_session")
		if err == nil && cookie.Value != "" {
			if userID, err := s.auth.Validate(cookie.Value); err == nil {
				next.ServeHTTP(w, withUserID(r, userID))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func isAdmin(r *http.Request) bool {
	_, ok := userIDFromContext(r)
	return ok
}
