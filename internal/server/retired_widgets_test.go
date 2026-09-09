package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRetiredWidgetRouteNotFound(t *testing.T) {
	s := newTestServer(t)
	for _, suffix := range []string{"", "?region=us"} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/widgets/deals"+suffix, nil)
		s.Router().ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("retired route%s: got %d, want 404", suffix, w.Code)
		}
	}
}
