package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
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

// TestMustChangePassword verifies that when the initial admin user is created
// with a generated random password, login succeeds but every other admin
// endpoint returns 403 until the password is changed.
func TestMustChangePassword(t *testing.T) {
	s, password := newTestServerWithGeneratedPassword(t)
	if len(password) != 16 {
		t.Fatalf("expected 16-char generated password, got %d chars", len(password))
	}

	// Login with the generated password.
	body := bytes.NewBufferString(`{"username":"admin","password":"` + password + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	w := httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("login expected 200, got %d", w.Code)
	}
	var cookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "hearth_session" {
			cookie = c
			break
		}
	}
	if cookie == nil {
		t.Fatal("missing session cookie")
	}

	// /api/auth/me must report mustChangePassword=true.
	req = httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("/me expected 200, got %d", w.Code)
	}
	var me struct {
		Admin              bool `json:"admin"`
		MustChangePassword bool `json:"mustChangePassword"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode /me: %v", err)
	}
	if !me.Admin || !me.MustChangePassword {
		t.Fatalf("/me: expected admin=true mustChangePassword=true, got admin=%v must=%v", me.Admin, me.MustChangePassword)
	}

	// Any other admin write must be blocked with 403.
	req = httptest.NewRequest(http.MethodPut, "/api/settings", bytes.NewBufferString(`{"siteTitle":"X"}`))
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("PUT /api/settings while must_change: expected 403, got %d", w.Code)
	}

	// Changing the password must succeed.
	req = httptest.NewRequest(http.MethodPost, "/api/auth/password",
		bytes.NewBufferString(`{"oldPassword":"`+password+`","newPassword":"newSecret123"}`))
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("change password expected 200, got %d (body=%s)", w.Code, w.Body.String())
	}

	// After change, the same admin write should now succeed.
	req = httptest.NewRequest(http.MethodPut, "/api/settings", bytes.NewBufferString(`{"siteTitle":"X"}`))
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT /api/settings after password change: expected 200, got %d", w.Code)
	}

	// /me must now report mustChangePassword=false.
	req = httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if err := json.Unmarshal(w.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode /me 2: %v", err)
	}
	if me.MustChangePassword {
		t.Fatal("/me after change: expected mustChangePassword=false, still true")
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
		Addr:            ":0",
		DataDir:         dataDir,
		DatabaseDSN:     filepath.Join(dataDir, "test.db"),
		SessionTTL:      "1h",
		InitialPassword: "admin", // skip the must-change-password flow in tests
	}
	s, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s
}

// newTestServerWithGeneratedPassword starts a server with no initial password
// override, exercising the random-password + must_change_password flow.
// The generated password is captured from the banner printed to PasswordOutput.
func newTestServerWithGeneratedPassword(t *testing.T) (*Server, string) {
	t.Helper()
	dataDir := t.TempDir()
	var buf bytes.Buffer
	cfg := Config{
		Addr:           ":0",
		DataDir:        dataDir,
		DatabaseDSN:    filepath.Join(dataDir, "test.db"),
		SessionTTL:     "1h",
		PasswordOutput: &buf,
	}
	s, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	pw := extractGeneratedPassword(buf.String())
	if pw == "" {
		t.Fatalf("could not extract generated password from output:\n%s", buf.String())
	}
	return s, pw
}

// extractGeneratedPassword pulls the random password out of the banner the
// auth package prints. The banner format is stable; if it ever changes, this
// helper must be updated alongside it.
func extractGeneratedPassword(out string) string {
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		const marker = "password:"
		if i := strings.Index(line, marker); i >= 0 {
			return strings.TrimSpace(line[i+len(marker):])
		}
	}
	return ""
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
