package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/morezhou/hearth/internal/docker"
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

// TestForwardAuthHeader verifies that an upstream proxy can authenticate
// users by setting HEARTH_TRUSTED_PROXY_HEADER, but ONLY when the request's
// source IP is inside HEARTH_TRUSTED_PROXY_NETWORKS. Without the source-IP
// guard, anyone hitting the backend could forge the header.
func TestForwardAuthHeader(t *testing.T) {
	dataDir := t.TempDir()
	cfg := Config{
		Addr:                 ":0",
		DataDir:              dataDir,
		DatabaseDSN:          filepath.Join(dataDir, "test.db"),
		SessionTTL:           "1h",
		InitialPassword:      "admin",
		TrustedProxyHeader:   "X-Remote-User",
		TrustedProxyNetworks: "10.0.0.0/8",
		DockerLabelInterval:  "0s",
	}
	s, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Untrusted source IP — header should be ignored, request fails admin auth.
	req := httptest.NewRequest(http.MethodPut, "/api/settings", bytes.NewBufferString(`{"siteTitle":"X"}`))
	req.RemoteAddr = "203.0.113.5:42000"
	req.Header.Set("X-Remote-User", "alice")
	w := httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("untrusted-IP forward-auth: expected 401, got %d", w.Code)
	}

	// Trusted source IP — header should provision and authenticate the user.
	req = httptest.NewRequest(http.MethodPut, "/api/settings", bytes.NewBufferString(`{"siteTitle":"Y"}`))
	req.RemoteAddr = "10.42.0.1:42001"
	req.Header.Set("X-Remote-User", "alice")
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("trusted-IP forward-auth: expected 200, got %d (body=%s)", w.Code, w.Body.String())
	}

	// Same user via /api/auth/me should now report admin=true.
	req = httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.RemoteAddr = "10.42.0.1:42002"
	req.Header.Set("X-Remote-User", "alice")
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("/me: expected 200, got %d", w.Code)
	}
	var me struct {
		Admin    bool   `json:"admin"`
		Username string `json:"username"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode /me: %v", err)
	}
	if !me.Admin || me.Username != "alice" {
		t.Fatalf("/me forward-auth: expected admin=true username=alice, got %+v", me)
	}

	// Forward-auth users should NOT be able to log in via /api/auth/login
	// (their password_hash is the sentinel, never matches bcrypt).
	body := bytes.NewBufferString(`{"username":"alice","password":"anything"}`)
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("forward-auth user password login: expected 401, got %d", w.Code)
	}
}

// TestForwardAuthRefusesEmptyNetworks verifies that setting the header without
// the source-IP guard fails fast at startup rather than silently trusting
// every request that reaches the backend.
func TestForwardAuthRefusesEmptyNetworks(t *testing.T) {
	dataDir := t.TempDir()
	cfg := Config{
		Addr:                ":0",
		DataDir:             dataDir,
		DatabaseDSN:         filepath.Join(dataDir, "test.db"),
		SessionTTL:          "1h",
		InitialPassword:     "admin",
		TrustedProxyHeader:  "X-Remote-User",
		DockerLabelInterval: "0s",
		// TrustedProxyNetworks intentionally empty
	}
	if _, err := New(cfg); err == nil {
		t.Fatal("expected New to refuse TrustedProxyHeader without TrustedProxyNetworks")
	}
}

func TestListAppsMergesDocker(t *testing.T) {
	s := newTestServer(t)

	// Login so the admin endpoint accepts.
	cookie := loginAsAdmin(t, s)

	// Create a manual group named "Media" so we can verify case-insensitive
	// group matching against a docker app.
	mediaGroupBody := bytes.NewBufferString(`{"name":"Media","kind":"app"}`)
	mediaReq := httptest.NewRequest(http.MethodPost, "/api/groups", mediaGroupBody)
	mediaReq.AddCookie(cookie)
	w := httptest.NewRecorder()
	s.Router().ServeHTTP(w, mediaReq)
	if w.Code != http.StatusCreated {
		t.Fatalf("create group: expected 201, got %d (%s)", w.Code, w.Body.String())
	}
	var createdGroup struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &createdGroup); err != nil {
		t.Fatalf("decode created group: %v", err)
	}

	// Inject fake docker apps: one matches "Media" (case-insensitive),
	// one has no group, one has a group name that doesn't match anything.
	s.labelAppsFn = func() []docker.LabelApp {
		return []docker.LabelApp{
			{ContainerID: "aaaaaa111111aaaaaa", Name: "Jellyfin", Group: "media", Href: "http://nas.lan:8096/"},
			{ContainerID: "bbbbbb222222bbbbbb", Name: "Sonarr", Href: "http://nas.lan:8989/"},
			{ContainerID: "cccccc333333cccccc", Name: "Vaultwarden", Group: "Personal", Href: "http://nas.lan:8222/"},
		}
	}

	// GET /api/apps should return all 3 docker apps with source=docker.
	req := httptest.NewRequest(http.MethodGet, "/api/apps", nil)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list apps: expected 200, got %d", w.Code)
	}
	var apps []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &apps); err != nil {
		t.Fatalf("decode apps: %v", err)
	}
	dockerApps := 0
	var jellyfinGroupID *string
	for _, a := range apps {
		if src, _ := a["source"].(string); src == "docker" {
			dockerApps++
			if a["name"] == "Jellyfin" {
				if g, ok := a["groupId"].(string); ok {
					jellyfinGroupID = &g
				}
			}
		}
	}
	if dockerApps != 3 {
		t.Fatalf("got %d docker apps, want 3", dockerApps)
	}
	if jellyfinGroupID == nil || *jellyfinGroupID != createdGroup.ID {
		t.Fatalf("Jellyfin should match user 'Media' group %q (case-insensitive), got %v", createdGroup.ID, jellyfinGroupID)
	}

	// GET /api/groups should now include the virtual "Docker" group
	// (because Sonarr + Vaultwarden don't match a user group).
	req = httptest.NewRequest(http.MethodGet, "/api/groups", nil)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	var groups []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &groups); err != nil {
		t.Fatalf("decode groups: %v", err)
	}
	hasVirtual := false
	for _, g := range groups {
		if g["id"] == "docker:" {
			hasVirtual = true
			break
		}
	}
	if !hasVirtual {
		t.Fatal("expected virtual 'docker:' group in /api/groups response")
	}
}

func TestDockerAppEditRefused(t *testing.T) {
	s := newTestServer(t)
	cookie := loginAsAdmin(t, s)

	// PUT /api/apps/docker:abc123 must return 403 regardless of body.
	body := bytes.NewBufferString(`{"groupId":null,"name":"x","description":null,"url":"http://x/","iconPath":null,"iconSource":null}`)
	req := httptest.NewRequest(http.MethodPut, "/api/apps/docker:abc123def456", body)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("PUT docker app: expected 403, got %d (%s)", w.Code, w.Body.String())
	}

	// DELETE /api/apps/docker:abc123 must return 403.
	req = httptest.NewRequest(http.MethodDelete, "/api/apps/docker:abc123def456", nil)
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("DELETE docker app: expected 403, got %d", w.Code)
	}

	// PUT /api/groups/docker: must return 403 (rename refused).
	renameBody := bytes.NewBufferString(`{"name":"renamed"}`)
	req = httptest.NewRequest(http.MethodPut, "/api/groups/docker:", renameBody)
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("PUT docker group: expected 403, got %d", w.Code)
	}

	// DELETE /api/groups/docker: must return 403 (delete refused).
	req = httptest.NewRequest(http.MethodDelete, "/api/groups/docker:", nil)
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	s.Router().ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("DELETE docker group: expected 403, got %d", w.Code)
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
		Addr:                ":0",
		DataDir:             dataDir,
		DatabaseDSN:         filepath.Join(dataDir, "test.db"),
		SessionTTL:          "1h",
		InitialPassword:     "admin", // skip the must-change-password flow in tests
		DockerLabelInterval: "0s",    // disable the docker label scan in tests
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
		Addr:                ":0",
		DataDir:             dataDir,
		DatabaseDSN:         filepath.Join(dataDir, "test.db"),
		SessionTTL:          "1h",
		PasswordOutput:      &buf,
		DockerLabelInterval: "0s",
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
