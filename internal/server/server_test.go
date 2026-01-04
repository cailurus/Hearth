package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestHealth(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	w := httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestSettingsAuth(t *testing.T) {
	s := newTestServer(t)

	// guest can read
	w := httptest.NewRecorder()
	s.Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// guest cannot write
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/api/settings", bytes.NewBufferString(`{"siteTitle":"X"}`)))
	if w.Code != http.StatusUnauthorized {

		t.Fatalf("expected 401, got %d", w.Code)
	}

	cookie := loginAsAdmin(t, s)

	// admin can write
	payload := Settings{SiteTitle: "XXM的Home"}
	b, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPut, "/api/settings", bytes.NewReader(b))
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestBackupAuth(t *testing.T) {
	s := newTestServer(t)

	// guest cannot export
	w := httptest.NewRecorder()
	s.Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/export", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}

	// guest cannot import
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/import", bytes.NewBufferString(`{"version":1}`)))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}

	cookie := loginAsAdmin(t, s)

	// admin can export
	req := httptest.NewRequest(http.MethodGet, "/api/export", nil)
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	exported := w.Body.Bytes()
	if len(exported) == 0 {
		t.Fatalf("expected non-empty export")
	}

	// admin can import (round-trip)
	req = httptest.NewRequest(http.MethodPost, "/api/import", bytes.NewReader(exported))
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func newTestServer(t *testing.T) *Server {
	t.Helper()
	dataDir := t.TempDir()
	cfg := Config{
		Addr:        ":0",
		DataDir:     dataDir,
		DatabaseDSN: filepath.Join(dataDir, "test.db"),
		SessionTTL:  "1h",
	}
	s, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s
}

func loginAsAdmin(t *testing.T, s *Server) *http.Cookie {
	t.Helper()
	body := bytes.NewBufferString(`{"username":"admin","password":"admin"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	w := httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("login expected 200, got %d", w.Code)
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == "hearth_session" {
			return c
		}
	}
	t.Fatalf("missing session cookie")
	return nil
}
