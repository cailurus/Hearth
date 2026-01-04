package server

import (
	"context"
	"net/http"
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

func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("hearth_session")
		if err != nil || cookie.Value == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		userID, err := s.auth.Validate(cookie.Value)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, withUserID(r, userID))
	})
}

func (s *Server) optionalUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
