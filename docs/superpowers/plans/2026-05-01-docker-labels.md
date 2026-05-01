# Docker Labels Service Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-discover Hearth apps from running Docker containers' `hearth.*` / `homepage.*` labels, refresh every 30s, runtime-only (no DB writes), with a small badge in the UI distinguishing them from manual apps.

**Architecture:** A new `internal/docker/labels.go` runs a 30s polling loop, parses container labels into `LabelApp` records held in memory under an `RWMutex`. The HTTP layer's `handleListApps` / `handleListGroups` merge those records with the manual rows from SQLite at request time. Mutation handlers refuse `docker:`-prefixed IDs. Frontend gets a new `source` field on `AppItem` and a `DockerBadge` overlay; edit / delete affordances hide for docker-source items.

**Tech Stack:** Go 1.25 (chi, modernc/sqlite), React 19 + TypeScript 5.9 + Tailwind 3.4, lucide-react.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `internal/docker/client.go` | Modify | Add `Labels` field to `containerListEntry` |
| `internal/docker/labels.go` | Create | `LabelApp`, `parseLabels`, `LabelDiscovery` (lifecycle + state) |
| `internal/docker/labels_test.go` | Create | Pure-function tests for `parseLabels` + scan filter logic |
| `internal/server/config.go` | Modify | Add `DockerLabelInterval` field + env |
| `internal/server/server.go` | Modify | Wire `LabelDiscovery`; expose `labelAppsFn` field for test injection |
| `internal/server/handlers_groups_apps.go` | Modify | Merge label apps in handleListApps / handleListGroups; reject `docker:` mutations |
| `internal/server/server_test.go` | Modify | Add `TestListAppsMergesDocker` + `TestDockerAppEditRefused` |
| `internal/store/models.go` | Modify | Add `Source string` field on `AppItem` |
| `web/src/components/cards/DockerBadge.tsx` | Create | Inline-SVG Docker whale glyph component |
| `web/src/components/layout/GroupBlock.tsx` | Modify | Render badge; hide edit/delete on docker apps; lock virtual `Docker` group |
| `web/src/components/layout/BookmarkGroup.tsx` | Modify | Same |
| `web/src/components/layout/QuickLaunch.tsx` | Modify | Render badge in result rows |
| `web/src/types/models.ts` | Modify | Add `source?: 'manual' \| 'docker'` to `AppItem` |
| `web/src/i18n/locales/en/common.json` + zh | Modify | `dockerDiscovered` key |
| `README.md` + `README_CN.md` | Modify | "Docker Labels" subsection with compose example + homepage compatibility note |

---

### Task 1: `LabelApp` parser + container-entry labels

**Files:**
- Modify: `internal/docker/client.go`
- Create: `internal/docker/labels.go`
- Create: `internal/docker/labels_test.go`

- [ ] **Step 1: Extend `containerListEntry`**

The Docker `/containers/json` endpoint already returns a `Labels` map; the struct just needs to unmarshal it. Open `internal/docker/client.go`, find the `containerListEntry` type (around line 205), and add a `Labels` field:

```go
type containerListEntry struct {
	ID        string            `json:"Id"`
	Names     []string          `json:"Names"`
	Image     string            `json:"Image"`
	State     string            `json:"State"`
	StatusStr string            `json:"Status"`
	Labels    map[string]string `json:"Labels"`
}
```

- [ ] **Step 2: Write the failing parseLabels tests**

Create `internal/docker/labels_test.go`:

```go
package docker

import (
	"reflect"
	"testing"
)

func TestParseLabels(t *testing.T) {
	cases := []struct {
		name     string
		labels   map[string]string
		fallback string // container name; used when label name is missing
		want     LabelApp
		wantOK   bool
	}{
		{
			name:     "hearth.* full",
			fallback: "jellyfin",
			labels: map[string]string{
				"hearth.name":        "Jellyfin",
				"hearth.group":       "Media",
				"hearth.href":        "http://nas.lan:8096/",
				"hearth.icon":        "lucide:film",
				"hearth.description": "Movie & TV server",
			},
			want: LabelApp{
				Name:        "Jellyfin",
				Group:       "Media",
				Href:        "http://nas.lan:8096/",
				Icon:        "lucide:film",
				Description: "Movie & TV server",
			},
			wantOK: true,
		},
		{
			name:     "homepage.* full",
			fallback: "plex",
			labels: map[string]string{
				"homepage.name":        "Plex",
				"homepage.group":       "Media",
				"homepage.href":        "http://nas.lan:32400/",
				"homepage.icon":        "lucide:tv",
				"homepage.description": "Streaming",
			},
			want: LabelApp{
				Name:        "Plex",
				Group:       "Media",
				Href:        "http://nas.lan:32400/",
				Icon:        "lucide:tv",
				Description: "Streaming",
			},
			wantOK: true,
		},
		{
			name:     "hearth.* wins over homepage.*",
			fallback: "jellyfin",
			labels: map[string]string{
				"hearth.name":   "Jellyfin",
				"hearth.href":   "http://hearth-href/",
				"homepage.name": "DO NOT USE",
				"homepage.href": "http://homepage-href/",
			},
			want: LabelApp{
				Name: "Jellyfin",
				Href: "http://hearth-href/",
			},
			wantOK: true,
		},
		{
			name:     "missing name → skip",
			fallback: "blah",
			labels: map[string]string{
				"hearth.href": "http://something/",
			},
			wantOK: false,
		},
		{
			name:     "missing href → skip",
			fallback: "blah",
			labels: map[string]string{
				"hearth.name": "Something",
			},
			wantOK: false,
		},
		{
			name:     "no relevant labels → skip",
			fallback: "blah",
			labels: map[string]string{
				"com.example.foo": "bar",
			},
			wantOK: false,
		},
		{
			name:     "empty labels → skip",
			fallback: "blah",
			labels:   nil,
			wantOK:   false,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := parseLabels(c.labels)
			if ok != c.wantOK {
				t.Fatalf("ok = %v, want %v", ok, c.wantOK)
			}
			if !c.wantOK {
				return
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("got %+v, want %+v", got, c.want)
			}
		})
	}
}
```

- [ ] **Step 3: Run test to confirm it fails**

```
go test ./internal/docker/ -run TestParseLabels -v
```

Expected: compile error, `parseLabels` and `LabelApp` are undefined.

- [ ] **Step 4: Implement `LabelApp` + `parseLabels` in `internal/docker/labels.go`**

Create `internal/docker/labels.go` with this content:

```go
// Package docker — labels.go: discover Hearth-renderable apps from
// container labels (hearth.* preferred, homepage.* compatible).
//
// Runtime-only: parsed apps live in a LabelDiscovery's in-memory slice
// and are rebuilt from scratch on every poll. Containers that disappear
// take their app out of the slice the next tick.

package docker

// LabelApp is one app discovered from a single container's labels.
// Names, Group, Href, etc. come straight from labels with no
// post-processing beyond trimming the prefix.
type LabelApp struct {
	ContainerID string // full container ID; used for stable React keys downstream
	Name        string
	Group       string
	Href        string
	Icon        string
	Description string
}

// parseLabels returns a populated LabelApp + true when the labels carry
// the minimum required Hearth/homepage entries (name + href). Returns
// the zero value + false otherwise — the caller skips that container.
//
// hearth.* takes precedence over homepage.* when both are present on
// the same container, on a per-field basis. So a container with
// hearth.name + homepage.href ends up with hearth's name and homepage's
// href — that's almost certainly a misconfiguration but harmless.
func parseLabels(labels map[string]string) (LabelApp, bool) {
	if len(labels) == 0 {
		return LabelApp{}, false
	}
	pick := func(field string) string {
		if v, ok := labels["hearth."+field]; ok && v != "" {
			return v
		}
		if v, ok := labels["homepage."+field]; ok && v != "" {
			return v
		}
		return ""
	}
	app := LabelApp{
		Name:        pick("name"),
		Group:       pick("group"),
		Href:        pick("href"),
		Icon:        pick("icon"),
		Description: pick("description"),
	}
	if app.Name == "" || app.Href == "" {
		return LabelApp{}, false
	}
	return app, true
}
```

- [ ] **Step 5: Run tests to verify they pass**

```
go test ./internal/docker/ -run TestParseLabels -v
```

Expected: all 7 sub-tests pass.

- [ ] **Step 6: Verify the rest of the package still builds**

```
go build ./...
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add internal/docker/client.go internal/docker/labels.go internal/docker/labels_test.go
git commit -m "feat(docker): LabelApp + parseLabels — hearth.* / homepage.* parser

Pure function for Task 2 to consume. Hearth.* wins over homepage.*
per-field; missing name or href → skip. Adds Labels map to
containerListEntry so the daemon's /containers/json response is
unmarshalled with labels intact."
```

---

### Task 2: `LabelDiscovery` lifecycle + scan loop

**Files:**
- Modify: `internal/docker/labels.go` (append types + methods)
- Modify: `internal/docker/labels_test.go` (append scan-filter tests)

- [ ] **Step 1: Write the failing scan-filter test**

Append to `internal/docker/labels_test.go`:

```go
func TestExtractLabelApps(t *testing.T) {
	entries := []containerListEntry{
		{
			ID:    "aaa1111111112222222222222222222222222222222222222222222222222222",
			Names: []string{"/jellyfin"},
			State: "running",
			Labels: map[string]string{
				"hearth.name":  "Jellyfin",
				"hearth.href":  "http://nas.lan:8096/",
				"hearth.group": "Media",
			},
		},
		{
			ID:    "bbb1111111112222222222222222222222222222222222222222222222222222",
			Names: []string{"/sonarr"},
			State: "exited", // must be filtered
			Labels: map[string]string{
				"hearth.name": "Sonarr",
				"hearth.href": "http://nas.lan:8989/",
			},
		},
		{
			ID:    "ccc1111111112222222222222222222222222222222222222222222222222222",
			Names: []string{"/no-labels"},
			State: "running",
			Labels: map[string]string{}, // no relevant labels — skipped
		},
		{
			ID:    "ddd1111111112222222222222222222222222222222222222222222222222222",
			Names: []string{"/missing-href"},
			State: "running",
			Labels: map[string]string{
				"hearth.name": "Incomplete",
			},
		},
		{
			ID:    "eee1111111112222222222222222222222222222222222222222222222222222",
			Names: []string{"/plex"},
			State: "RUNNING", // case-insensitive state match
			Labels: map[string]string{
				"homepage.name": "Plex",
				"homepage.href": "http://nas.lan:32400/",
			},
		},
	}

	got := extractLabelApps(entries)
	if len(got) != 2 {
		t.Fatalf("got %d apps, want 2 (jellyfin + plex). full=%+v", len(got), got)
	}
	names := []string{got[0].Name, got[1].Name}
	wantNames := map[string]bool{"Jellyfin": true, "Plex": true}
	for _, n := range names {
		if !wantNames[n] {
			t.Errorf("unexpected app %q", n)
		}
	}
	if got[0].ContainerID == "" {
		t.Error("ContainerID should be set from entry.ID")
	}
}
```

- [ ] **Step 2: Run test to confirm it fails**

```
go test ./internal/docker/ -run TestExtractLabelApps -v
```

Expected: compile error, `extractLabelApps` undefined.

- [ ] **Step 3: Add `extractLabelApps` to `labels.go`**

Append to `internal/docker/labels.go`:

```go
import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// extractLabelApps filters a container list down to running containers
// that carry valid Hearth/homepage labels and returns a LabelApp per
// such container. Pure function — no I/O.
func extractLabelApps(entries []containerListEntry) []LabelApp {
	out := make([]LabelApp, 0, len(entries))
	for _, e := range entries {
		if !strings.EqualFold(e.State, "running") {
			continue
		}
		app, ok := parseLabels(e.Labels)
		if !ok {
			continue
		}
		app.ContainerID = e.ID
		out = append(out, app)
	}
	return out
}
```

The `import` block at the top of `labels.go` needs to be updated. Edit the existing first import line and replace the whole top of the file with:

```go
// Package docker — labels.go: discover Hearth-renderable apps from
// container labels (hearth.* preferred, homepage.* compatible).
//
// Runtime-only: parsed apps live in a LabelDiscovery's in-memory slice
// and are rebuilt from scratch on every poll. Containers that disappear
// take their app out of the slice the next tick.

package docker

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"
)
```

- [ ] **Step 4: Run test to verify it passes**

```
go test ./internal/docker/ -run TestExtractLabelApps -v
```

Expected: PASS.

- [ ] **Step 5: Add `LabelDiscovery` struct + lifecycle**

Append to `internal/docker/labels.go`:

```go
// LabelDiscovery polls the local Docker daemon every `interval` for
// container labels and exposes the resulting LabelApp set to readers
// via Apps().
//
// Interval == 0 disables the feature: Start is a no-op, Apps returns
// nil. This is the explicit operator opt-out path
// (HEARTH_DOCKER_LABEL_INTERVAL=0).
type LabelDiscovery struct {
	client   *Client
	interval time.Duration

	mu     sync.RWMutex
	apps   []LabelApp
	stopCh chan struct{}
	doneCh chan struct{}
}

// NewLabelDiscovery wires a LabelDiscovery to a Docker client. Call
// Start to begin the background loop.
func NewLabelDiscovery(client *Client, interval time.Duration) *LabelDiscovery {
	return &LabelDiscovery{
		client:   client,
		interval: interval,
		stopCh:   make(chan struct{}),
		doneCh:   make(chan struct{}),
	}
}

// Start begins the polling loop in a goroutine. Idempotent: calling it
// twice is a programming error but won't crash. When interval is 0
// the loop is skipped — Apps will permanently return nil.
func (d *LabelDiscovery) Start(ctx context.Context) {
	if d.interval <= 0 {
		close(d.doneCh)
		return
	}
	go d.loop(ctx)
}

// Stop signals the loop to exit and waits for it to finish (best
// effort — bounded by the in-flight scan's HTTP timeout).
func (d *LabelDiscovery) Stop() {
	select {
	case <-d.stopCh:
		// already stopped
	default:
		close(d.stopCh)
	}
	<-d.doneCh
}

// Apps returns a snapshot of the most recent scan. Safe for concurrent
// callers; returns a fresh slice (not the internal one) so the caller
// can iterate without holding any lock.
func (d *LabelDiscovery) Apps() []LabelApp {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if len(d.apps) == 0 {
		return nil
	}
	out := make([]LabelApp, len(d.apps))
	copy(out, d.apps)
	return out
}

func (d *LabelDiscovery) loop(ctx context.Context) {
	defer close(d.doneCh)
	d.scan(ctx) // run once immediately so the first GET /api/apps after
	            // boot already sees discovered apps without waiting an
	            // interval.
	t := time.NewTicker(d.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-d.stopCh:
			return
		case <-t.C:
			d.scan(ctx)
		}
	}
}

func (d *LabelDiscovery) scan(ctx context.Context) {
	if !d.client.Available() {
		return
	}
	entries, err := d.client.listContainers(ctx)
	if err != nil {
		slog.Debug("docker label discovery: list containers failed", "error", err)
		return
	}
	apps := extractLabelApps(entries)
	d.mu.Lock()
	d.apps = apps
	d.mu.Unlock()
}
```

- [ ] **Step 6: Add a lifecycle smoke test**

Append to `internal/docker/labels_test.go`:

```go
func TestLabelDiscoveryDisabledWhenIntervalZero(t *testing.T) {
	d := NewLabelDiscovery(nil, 0)
	d.Start(context.Background())
	if got := d.Apps(); got != nil {
		t.Errorf("Apps() with interval=0 should be nil, got %v", got)
	}
	d.Stop() // must not block / panic
}
```

The import block of the test file needs a `context` import — update it:

```go
package docker

import (
	"context"
	"reflect"
	"testing"
)
```

- [ ] **Step 7: Run all docker package tests**

```
go test ./internal/docker/ -v
```

Expected: 3 tests PASS (TestParseLabels, TestExtractLabelApps, TestLabelDiscoveryDisabledWhenIntervalZero).

- [ ] **Step 8: Verify build**

```
go build ./...
```

Expected: success.

- [ ] **Step 9: Commit**

```bash
git add internal/docker/labels.go internal/docker/labels_test.go
git commit -m "feat(docker): LabelDiscovery polling loop with stop / apps snapshot

Wraps parseLabels in a goroutine that runs an immediate scan on Start
and one scan per tick thereafter. Apps() returns a copy so callers
don't share the internal slice. interval=0 disables the loop entirely
for operator opt-out (HEARTH_DOCKER_LABEL_INTERVAL=0)."
```

---

### Task 3: Server config + LabelDiscovery wiring

**Files:**
- Modify: `internal/server/config.go`
- Modify: `internal/server/server.go`

- [ ] **Step 1: Add `DockerLabelInterval` to `Config`**

Open `internal/server/config.go`. Find the `Config` struct (lines ~8–28); add a field after `DockerAllowPatterns`:

```go
type Config struct {
	Addr        string
	DataDir     string
	DatabaseDSN string
	SessionTTL  string
	CORSOrigins       string // comma-separated allowed origins; empty = dev defaults
	CookieSecure      string // "auto" | "true" | "false"; default "auto"
	DockerSocket      string // Docker socket path; default "/var/run/docker.sock"
	DockerAllowPatterns string // comma-separated container-name regex allowlist for start/stop/restart; empty = allow all
	DockerLabelInterval string // poll interval for hearth.*/homepage.* label discovery; "0s" or "0" disables; default "30s"
	InitialPassword   string // first-run admin password; if empty, a random password is generated and printed to PasswordOutput

	// ... rest unchanged ...
}
```

In `LoadConfigFromEnv()`, add:

```go
	dockerLabelInterval := getEnv("HEARTH_DOCKER_LABEL_INTERVAL", "30s")
```

near the other docker-prefixed env reads, and include it in the returned struct. The full function should now look like:

```go
func LoadConfigFromEnv() Config {
	addr := getEnv("HEARTH_ADDR", ":8787")
	dataDir := getEnv("HEARTH_DATA_DIR", "./data")
	dsn := getEnv("HEARTH_DB_DSN", dataDir+"/hearth.db")
	sessionTTL := getEnv("HEARTH_SESSION_TTL", "168h")
	corsOrigins := getEnv("HEARTH_CORS_ORIGINS", "")
	cookieSecure := getEnv("HEARTH_COOKIE_SECURE", "auto")
	dockerSocket := getEnv("HEARTH_DOCKER_SOCKET", "/var/run/docker.sock")
	dockerAllowPatterns := getEnv("HEARTH_DOCKER_ALLOW_PATTERNS", "")
	dockerLabelInterval := getEnv("HEARTH_DOCKER_LABEL_INTERVAL", "30s")
	initialPassword := getEnv("HEARTH_INITIAL_PASSWORD", "")
	trustedProxyHeader := getEnv("HEARTH_TRUSTED_PROXY_HEADER", "")
	trustedProxyNetworks := getEnv("HEARTH_TRUSTED_PROXY_NETWORKS", "")

	return Config{
		Addr:                 addr,
		DataDir:              dataDir,
		DatabaseDSN:          dsn,
		SessionTTL:           sessionTTL,
		CORSOrigins:          corsOrigins,
		CookieSecure:         cookieSecure,
		DockerSocket:         dockerSocket,
		DockerAllowPatterns:  dockerAllowPatterns,
		DockerLabelInterval:  dockerLabelInterval,
		InitialPassword:      initialPassword,
		TrustedProxyHeader:   trustedProxyHeader,
		TrustedProxyNetworks: trustedProxyNetworks,
	}
}
```

- [ ] **Step 2: Add the `labelAppsFn` field on `Server`**

Open `internal/server/server.go`. Find the `Server` struct definition (lines ~32–55). Add two fields:

```go
type Server struct {
	cfg          Config
	router       chi.Router
	db           *sql.DB
	store        *store.Store
	auth         *auth.Service
	iconResolver *icon.Resolver
	bgSvc            *background.Service
	dockerClient     *docker.Client
	metricsCollector *metrics.Collector

	// dockerAllowPatterns is the compiled allow-list of container name regexes
	// (HEARTH_DOCKER_ALLOW_PATTERNS). nil/empty means "no restriction".
	dockerAllowPatterns []*regexp.Regexp

	// trustedProxyNetworks is the compiled CIDR list a reverse proxy can
	// connect from for forward-auth header trust. Empty disables forward-auth
	// regardless of HEARTH_TRUSTED_PROXY_HEADER.
	trustedProxyNetworks []*net.IPNet

	// labelDiscovery polls Docker for hearth.*/homepage.* labels.
	labelDiscovery *docker.LabelDiscovery

	// labelAppsFn returns the current label-discovered apps. Production
	// uses labelDiscovery.Apps; tests inject a fake. Always non-nil so
	// handlers can call it without nil-checking.
	labelAppsFn func() []docker.LabelApp
}
```

- [ ] **Step 3: Initialize and start `LabelDiscovery` in `New()`**

In `internal/server/server.go`, find the place where `dockerClient` is constructed in `New()` (search for `dockerClient := docker.New(`). Just below the metrics collector line (search for `mc := metrics.NewCollector(db)`), before the `s := &Server{...}` literal, add:

```go
	labelInterval, err := time.ParseDuration(cfg.DockerLabelInterval)
	if err != nil {
		return nil, fmt.Errorf("HEARTH_DOCKER_LABEL_INTERVAL: %w", err)
	}
	labelDiscovery := docker.NewLabelDiscovery(dockerClient, labelInterval)
	labelDiscovery.Start(context.Background())
```

And in the `&Server{...}` literal that follows, add the two new fields:

```go
	s := &Server{
		cfg:                  cfg,
		// ... existing fields ...
		dockerAllowPatterns:  allowPatterns,
		trustedProxyNetworks: trustedProxyNets,
		labelDiscovery:       labelDiscovery,
		labelAppsFn:          labelDiscovery.Apps,
	}
```

(Preserve the existing fields verbatim; only insert the two new lines.)

The `context` package needs to be imported. Open `internal/server/server.go` top-of-file imports and add `"context"` to the standard-library group:

```go
import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	// ... third-party imports unchanged ...
)
```

- [ ] **Step 4: Stop `LabelDiscovery` in `Close()`**

Find `func (s *Server) Close() error` (search for `s.metricsCollector.Stop()`). Insert one line before it:

```go
func (s *Server) Close() error {
	if s.labelDiscovery != nil {
		s.labelDiscovery.Stop()
	}
	s.metricsCollector.Stop()
	s.auth.Stop()
	return s.db.Close()
}
```

- [ ] **Step 5: Verify build + existing test suite**

```
go build ./... && go test ./internal/server/ -run 'TestHealth|TestSettingsAuth|TestForwardAuth|TestMustChangePassword|TestBackupAuth' -v
```

Expected: all 5 tests pass — no regressions.

- [ ] **Step 6: Commit**

```bash
git add internal/server/config.go internal/server/server.go
git commit -m "feat(server): wire LabelDiscovery + HEARTH_DOCKER_LABEL_INTERVAL

LabelDiscovery is initialised in Server.New, started immediately, and
stopped in Close. labelAppsFn defaults to discovery.Apps; tests can
override it to inject a fake. Bad interval string fails fast at boot."
```

---

### Task 4: `handleListApps` / `handleListGroups` merge + `Source` field

**Files:**
- Modify: `internal/store/models.go`
- Modify: `internal/server/handlers_groups_apps.go`
- Modify: `internal/server/server_test.go`

- [ ] **Step 1: Add `Source` to `AppItem`**

Open `internal/store/models.go`. Add a new field at the end of `AppItem`:

```go
type AppItem struct {
	ID          string  `json:"id"`
	GroupID     *string `json:"groupId"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	URL         string  `json:"url"`
	IconPath    *string `json:"iconPath"`
	IconSource  *string `json:"iconSource"`
	SortOrder   int     `json:"sortOrder"`
	CreatedAt   int64   `json:"createdAt"`

	// Source identifies where this app came from. "" / "manual" =
	// user-created (DB row); "docker" = synthesized from a container
	// label. The DB layer never reads or writes this field — every
	// SELECT / INSERT in store/apps.go names columns explicitly, so
	// Scan ignores Source.
	Source string `json:"source,omitempty"`
}
```

- [ ] **Step 2: Write the failing merge test**

Open `internal/server/server_test.go`. After the existing `TestForwardAuthRefusesEmptyNetworks` function and before `TestBackupAuth`, append:

```go
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
```

The test references the `docker` package — add the import to `server_test.go`'s import block (open the file, look near the top):

```go
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
```

- [ ] **Step 3: Run test — should fail because merge isn't implemented yet**

```
go test ./internal/server/ -run TestListAppsMergesDocker -v
```

Expected: FAIL — "got 0 docker apps, want 3" (or similar).

- [ ] **Step 4: Implement merge in handlers**

Open `internal/server/handlers_groups_apps.go`.

First, add the merge helpers. At the bottom of the file, append:

```go
// dockerVirtualGroupID is the synthetic ID of the in-memory "Docker"
// group that holds label-discovered apps with no matching user group.
const dockerVirtualGroupID = "docker:"

// dockerVirtualGroupName is the display name of the synthetic group.
const dockerVirtualGroupName = "Docker"

// dockerAppIDPrefix is prepended to a container's short ID to form the
// AppItem.ID for label-discovered apps. The prefix doubles as the
// "this app is docker-managed" marker for the mutation handlers.
const dockerAppIDPrefix = "docker:"

// mergeAppsWithDocker appends label-discovered apps (one per LabelApp)
// to the manual app list. Group placement: case-insensitive exact
// match against existing user groups; on miss, falls into the
// dockerVirtualGroupID synthetic group. Output order = manual apps
// first (preserving DB order), docker apps last in container-name
// (Name) lexicographic order — keeps React keys stable across renders
// and gives users a predictable display.
func mergeAppsWithDocker(manual []store.AppItem, labelApps []docker.LabelApp, groups []store.Group) []store.AppItem {
	if len(labelApps) == 0 {
		return manual
	}

	// Index user groups by lowercased name for case-insensitive lookup.
	groupIDByName := make(map[string]string, len(groups))
	for _, g := range groups {
		groupIDByName[strings.ToLower(g.Name)] = g.ID
	}

	// Stable sort of label apps by Name so SortOrder is deterministic.
	sorted := make([]docker.LabelApp, len(labelApps))
	copy(sorted, labelApps)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].Name < sorted[j].Name
	})

	out := make([]store.AppItem, 0, len(manual)+len(sorted))
	out = append(out, manual...)
	for i, la := range sorted {
		var groupID *string
		if la.Group != "" {
			if id, ok := groupIDByName[strings.ToLower(la.Group)]; ok {
				gid := id
				groupID = &gid
			}
		}
		if groupID == nil {
			vid := dockerVirtualGroupID
			groupID = &vid
		}
		shortID := la.ContainerID
		if len(shortID) > 12 {
			shortID = shortID[:12]
		}
		var iconPath, iconSource *string
		if la.Icon != "" {
			ic := la.Icon
			iconPath = &ic
			src := "docker"
			iconSource = &src
		}
		var description *string
		if la.Description != "" {
			d := la.Description
			description = &d
		}
		out = append(out, store.AppItem{
			ID:          dockerAppIDPrefix + shortID,
			GroupID:     groupID,
			Name:        la.Name,
			Description: description,
			URL:         la.Href,
			IconPath:    iconPath,
			IconSource:  iconSource,
			// SortOrder offset so docker apps follow manual apps consistently.
			SortOrder: 100000 + i,
			CreatedAt: 0,
			Source:    "docker",
		})
	}
	return out
}

// mergeGroupsWithDocker injects a virtual "Docker" group into the
// returned groups slice if (and only if) at least one label app is
// going to land in it. Otherwise the slice is returned untouched.
func mergeGroupsWithDocker(manual []store.Group, labelApps []docker.LabelApp) []store.Group {
	if len(labelApps) == 0 {
		return manual
	}
	groupIDByName := make(map[string]bool, len(manual))
	for _, g := range manual {
		groupIDByName[strings.ToLower(g.Name)] = true
	}
	needVirtual := false
	for _, la := range labelApps {
		if la.Group == "" || !groupIDByName[strings.ToLower(la.Group)] {
			needVirtual = true
			break
		}
	}
	if !needVirtual {
		return manual
	}
	out := make([]store.Group, 0, len(manual)+1)
	out = append(out, manual...)
	out = append(out, store.Group{
		ID:        dockerVirtualGroupID,
		Name:      dockerVirtualGroupName,
		Kind:      GroupKindApp,
		// Push the virtual group to the end; user groups keep their order.
		SortOrder: 1<<30,
		CreatedAt: 0,
	})
	return out
}
```

Update the import block of `handlers_groups_apps.go` to include `sort` and the docker package. Find the existing imports near the top and replace them with:

```go
import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/morezhou/hearth/internal/docker"
	"github.com/morezhou/hearth/internal/store"
)
```

(Preserve any other imports already present; add `sort`, `docker`, and `store`.)

Now wire the merge into the two list handlers.

Replace `handleListGroups`:

```go
func (s *Server) handleListGroups(w http.ResponseWriter, r *http.Request) {
	gs, err := s.store.ListGroups()
	if err != nil {
		slog.Error("failed to list groups", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list groups")
		return
	}
	labelApps := s.labelAppsFn()
	merged := mergeGroupsWithDocker(gs, labelApps)
	writeJSON(w, http.StatusOK, merged)
}
```

Replace `handleListApps`:

```go
func (s *Server) handleListApps(w http.ResponseWriter, r *http.Request) {
	manual, err := s.store.ListApps()
	if err != nil {
		slog.Error("failed to list apps", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list apps")
		return
	}
	groups, err := s.store.ListGroups()
	if err != nil {
		slog.Error("failed to list groups for app merge", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list apps")
		return
	}
	labelApps := s.labelAppsFn()
	merged := mergeAppsWithDocker(manual, labelApps, groups)
	writeJSON(w, http.StatusOK, merged)
}
```

- [ ] **Step 5: Run the merge test**

```
go test ./internal/server/ -run TestListAppsMergesDocker -v
```

Expected: PASS.

- [ ] **Step 6: Run the full server test suite to verify no regressions**

```
go test ./internal/server/ -v
```

Expected: all existing tests + the new one pass.

- [ ] **Step 7: Commit**

```bash
git add internal/store/models.go internal/server/handlers_groups_apps.go internal/server/server_test.go
git commit -m "feat(server): merge docker label apps into /api/apps and /api/groups

handleListApps and handleListGroups now consult labelAppsFn (which
points at LabelDiscovery.Apps in production) and synthesize one
AppItem per LabelApp + an optional virtual 'docker:' group when no
existing user group matches the label's group hint (case-insensitive).
AppItem.Source distinguishes docker apps from manual ones so the
frontend can render a badge.

TestListAppsMergesDocker covers user-group match, virtual-group
fallback, source field presence, and virtual-group emission."
```

---

### Task 5: Mutation handlers refuse `docker:` IDs

**Files:**
- Modify: `internal/server/handlers_groups_apps.go`
- Modify: `internal/server/server_test.go`

- [ ] **Step 1: Write the failing test**

Append to `internal/server/server_test.go` (near the other docker test, before `TestBackupAuth`):

```go
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
```

- [ ] **Step 2: Run the test — should fail**

```
go test ./internal/server/ -run TestDockerAppEditRefused -v
```

Expected: FAIL — current handlers don't check the prefix, so PUT/DELETE pass through and likely 200 or 404.

- [ ] **Step 3: Add prefix guards to the four handlers**

In `internal/server/handlers_groups_apps.go`, add a helper near the top of the file (after the const declarations):

```go
// isDockerManagedID reports whether the given app or group ID was
// synthesized by the docker label discovery layer. Mutation handlers
// refuse these IDs because docker-compose labels are the source of
// truth — UI edits would be silently overwritten on the next scan.
func isDockerManagedID(id string) bool {
	return strings.HasPrefix(id, dockerAppIDPrefix)
}
```

In `handleUpdateApp`, immediately after the `id := chi.URLParam(r, "id")` line, insert:

```go
	if isDockerManagedID(id) {
		writeError(w, http.StatusForbidden, "docker-discovered apps are managed via labels")
		return
	}
```

Same for `handleDeleteApp`:

```go
func (s *Server) handleDeleteApp(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if isDockerManagedID(id) {
		writeError(w, http.StatusForbidden, "docker-discovered apps are managed via labels")
		return
	}
	if err := s.store.DeleteApp(id); err != nil {
	// ... rest unchanged ...
```

For `handleUpdateGroup` (search for the function around line 85), insert after the URL param read:

```go
func (s *Server) handleUpdateGroup(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if isDockerManagedID(id) {
		writeError(w, http.StatusForbidden, "the docker virtual group cannot be modified")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	// ... rest unchanged ...
```

For `handleDeleteGroup`:

```go
func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if isDockerManagedID(id) {
		writeError(w, http.StatusForbidden, "the docker virtual group cannot be deleted")
		return
	}
	// ... rest unchanged ...
```

For `handleReorderApps` (defensive — body might contain a `docker:` group), insert at the top of the function body, after decoding `req`:

```go
	if req.GroupID != nil && isDockerManagedID(*req.GroupID) {
		writeError(w, http.StatusForbidden, "the docker virtual group cannot be reordered")
		return
	}
```

Locate `handleReorderApps` (around line 249) and update it accordingly.

- [ ] **Step 4: Run the test to verify it passes**

```
go test ./internal/server/ -run TestDockerAppEditRefused -v
```

Expected: PASS.

- [ ] **Step 5: Run the full server suite again**

```
go test ./internal/server/ -v
```

Expected: all tests pass (`TestListAppsMergesDocker`, `TestDockerAppEditRefused`, plus all earlier tests).

- [ ] **Step 6: Commit**

```bash
git add internal/server/handlers_groups_apps.go internal/server/server_test.go
git commit -m "feat(server): refuse mutation of docker-managed apps + virtual group

handleUpdateApp / handleDeleteApp / handleUpdateGroup /
handleDeleteGroup / handleReorderApps now return 403 when the target
ID has the 'docker:' prefix. The frontend should hide these
affordances, but this guard is the backend backstop. Test coverage in
TestDockerAppEditRefused."
```

---

### Task 6: Frontend `AppItem.source` + `DockerBadge` component

**Files:**
- Modify: `web/src/types/models.ts`
- Create: `web/src/components/cards/DockerBadge.tsx`

- [ ] **Step 1: Add `source` to the frontend `AppItem`**

Open `web/src/types/models.ts`. Find the `AppItem` interface (the field set should match the backend `store.AppItem` JSON tags). Add a new optional field:

```ts
export interface AppItem {
    id: string
    groupId: string | null
    name: string
    description: string | null
    url: string
    iconPath: string | null
    iconSource: string | null
    sortOrder: number
    createdAt: number
    /**
     * Where this app came from. Absent or "manual" → user-created (DB row).
     * "docker" → synthesized at request time from a container's hearth.* /
     * homepage.* labels. Docker-source apps are immutable through the UI.
     */
    source?: 'manual' | 'docker'
}
```

(Preserve any other fields that already exist — the file may have fields beyond what's listed here. Do NOT delete anything.)

- [ ] **Step 2: Create the `DockerBadge` component**

Create `web/src/components/cards/DockerBadge.tsx`:

```tsx
import { useTranslation } from 'react-i18next'

interface DockerBadgeProps {
    className?: string
}

/**
 * Small Docker-whale glyph overlay used to mark app cards that came
 * from a container's hearth.* / homepage.* labels rather than from a
 * user's manual entry. Inline SVG (no external icon dep) so it
 * inherits text color and ships in the main bundle without a network
 * round-trip. The path approximates Docker's whale logo at 8×8 — it's
 * a hint, not a brand mark.
 */
export function DockerBadge({ className = '' }: DockerBadgeProps) {
    const { t } = useTranslation('common')
    return (
        <span
            className={`inline-flex items-center justify-center rounded-sm bg-blue-500/80 text-white shadow-sm ${className}`}
            style={{ width: 12, height: 12 }}
            title={t('dockerDiscovered')}
            aria-label={t('dockerDiscovered')}
        >
            <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true">
                <path d="M21.4 9.6c-.6-.4-1.4-.6-2.1-.5l-.1-.6a1.5 1.5 0 0 0-1-1.2 1.5 1.5 0 0 0-1.6.4l-.4.4-.4-.4a1.5 1.5 0 0 0-2 .1l-.5.5-.4-.4a1.5 1.5 0 0 0-2 .1l-.5.5-.4-.4a1.5 1.5 0 0 0-2 .1l-.5.5-.4-.4a1.5 1.5 0 0 0-2 .1l-.5.5h-.6a1.5 1.5 0 0 0-1.5 1.5v.5c0 3.3 2.7 6 6 6h7c2.5 0 4.7-1.5 5.6-3.8.5 0 1-.1 1.4-.4.5-.3.8-.7 1-1.2.1-.4 0-.9-.1-1.3z"/>
            </svg>
        </span>
    )
}

export default DockerBadge
```

- [ ] **Step 3: Verify build**

```
cd web && npm run build
```

Expected: TypeScript / vite build succeeds. The new component is unused so far — that's fine, Task 7 wires it.

(Note: the `dockerDiscovered` i18n key isn't in the JSON yet either — Task 8 adds it. Until then `t('dockerDiscovered')` will fall through to the key string itself, which keeps the title attribute populated even before i18n lands. TypeScript may complain about the unknown key; if it does, just leave a temporary `// @ts-expect-error` above the two `t(...)` calls — Task 8 will remove it.)

If the build does fail with the i18n key error, add the temporary suppression:

```tsx
            // @ts-expect-error i18n key added in Task 8
            title={t('dockerDiscovered')}
            // @ts-expect-error i18n key added in Task 8
            aria-label={t('dockerDiscovered')}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/types/models.ts web/src/components/cards/DockerBadge.tsx
git commit -m "feat(ui): AppItem.source field + DockerBadge whale glyph

AppItem.source is the type-side counterpart of the backend Source field
landed in Task 4. DockerBadge is the small overlay that Task 7 will
attach to docker-source AppIcon callsites. Inline SVG, no extra dep."
```

---

### Task 7: Wire `DockerBadge` into AppIcon callsites + lock UI affordances

**Files:**
- Modify: `web/src/components/layout/GroupBlock.tsx`
- Modify: `web/src/components/layout/BookmarkGroup.tsx`
- Modify: `web/src/components/layout/QuickLaunch.tsx`

The three callsites already wrap `<AppIcon>` in a `relative` container (they do this for `<StatusDot>`). DockerBadge slots in at the right-top corner of that same container.

- [ ] **Step 1: GroupBlock — render badge on docker apps**

Open `web/src/components/layout/GroupBlock.tsx`. Find the AppIcon line (search for `<AppIcon iconPath={a.iconPath}`). It's inside a `relative` block that already shows StatusDot. Add DockerBadge right after AppIcon:

Find:

```tsx
                                        <AppIcon iconPath={a.iconPath} name={a.name} appUrl={a.url} />
```

(or similar — preserve existing prop set) and add the badge underneath:

```tsx
                                        <AppIcon iconPath={a.iconPath} name={a.name} appUrl={a.url} />
                                        {a.source === 'docker' ? (
                                            <DockerBadge className="absolute -top-1 -right-1 ring-1 ring-black/40" />
                                        ) : null}
```

Add the import at the top of `GroupBlock.tsx`:

```tsx
import { DockerBadge } from '../cards/DockerBadge'
```

Now disable edit / delete buttons for docker apps. Find the existing edit button for app cards (search for `onEdit\\(a\\)` or `onClick={() => onEdit(a)}` inside the same component). Wrap the edit and delete affordances so they only render for non-docker apps. The exact location varies; the rule is: any per-app `onEdit(a)` / `onDelete(a.id)` button gets the guard

```tsx
{a.source !== 'docker' ? (
    /* existing edit/delete UI */
) : null}
```

Specifically there are typically two affordances: a context-menu item and an inline trash button. Wrap both. Read the existing JSX to find them; the change is mechanical.

For the virtual `Docker` group, hide the rename/delete on the group itself. Find the group header rendering (search `onRenameGroup` or `onDeleteGroup`) and wrap with:

```tsx
const isVirtualDockerGroup = groupId === 'docker:'
// later in JSX:
{!isVirtualDockerGroup ? (
    /* existing rename/delete buttons */
) : null}
```

`groupId` is already a prop on GroupBlock.

- [ ] **Step 2: BookmarkGroup — render badge**

Open `web/src/components/layout/BookmarkGroup.tsx`. Find the AppIcon line (around line 204):

```tsx
                                        <AppIcon iconPath={a.iconPath} name={a.name} appUrl={a.url} size="sm" />
```

(or similar) and add the badge below:

```tsx
                                        <AppIcon iconPath={a.iconPath} name={a.name} appUrl={a.url} size="sm" />
                                        {a.source === 'docker' ? (
                                            <DockerBadge className="absolute -top-1 -right-1 ring-1 ring-black/40" />
                                        ) : null}
```

Add the import at the top of `BookmarkGroup.tsx`:

```tsx
import { DockerBadge } from '../cards/DockerBadge'
```

Lock edit/delete the same way as GroupBlock — wrap the per-bookmark affordances with `{a.source !== 'docker' ? (...) : null}`. Bookmarks are typically simpler (just the icon + name, sometimes a delete on hover); make sure no admin button can fire DELETE /api/apps/`docker:...` from this view.

- [ ] **Step 3: QuickLaunch — render badge**

Open `web/src/components/layout/QuickLaunch.tsx`. Find the AppIcon line (around line 157):

```tsx
                                    <AppIcon
                                        iconPath={item.iconPath}
                                        name={item.name}
                                        appUrl={item.url}
                                        size="sm"
                                    />
```

Wrap the AppIcon in a `relative` span and overlay the badge. Replace the block above with:

```tsx
                                    <span className="relative inline-flex">
                                        <AppIcon
                                            iconPath={item.iconPath}
                                            name={item.name}
                                            appUrl={item.url}
                                            size="sm"
                                        />
                                        {item.source === 'docker' ? (
                                            <DockerBadge className="absolute -top-1 -right-1 ring-1 ring-black/40" />
                                        ) : null}
                                    </span>
```

Add the import at the top of `QuickLaunch.tsx`:

```tsx
import { DockerBadge } from '../cards/DockerBadge'
```

QuickLaunch results have no edit/delete affordances, so no UI lock is needed here.

- [ ] **Step 4: Run the build**

```
cd web && npm run build
```

Expected: build succeeds. If TypeScript still complains about the `dockerDiscovered` i18n key, add or keep the `// @ts-expect-error` comment in `DockerBadge.tsx` — Task 8 will remove it once the key lands.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/layout/GroupBlock.tsx web/src/components/layout/BookmarkGroup.tsx web/src/components/layout/QuickLaunch.tsx
git commit -m "feat(ui): DockerBadge overlay on app cards + lock UI for docker apps

GroupBlock, BookmarkGroup, and QuickLaunch all render DockerBadge at
the icon's right-top corner when a.source === 'docker'. Right-bottom
remains the StatusDot territory. Edit / delete affordances are hidden
for docker-source apps; the virtual 'docker:' group hides its own
rename / delete buttons. Backend already refuses these mutations
(Task 5), this is the user-facing complement."
```

---

### Task 8: i18n keys + README "Docker Labels" section

**Files:**
- Modify: `web/src/i18n/locales/en/common.json`
- Modify: `web/src/i18n/locales/zh/common.json`
- Modify: `web/src/components/cards/DockerBadge.tsx` (drop ts-expect-error if added)
- Modify: `README.md`
- Modify: `README_CN.md`

- [ ] **Step 1: Add `dockerDiscovered` to English common.json**

Open `web/src/i18n/locales/en/common.json`. Find the last entry (currently `vpnModeOff`). Add `dockerDiscovered` after it. The trailing entries should look like:

```json
    "vpnCompatMode": "VPN compat mode",
    "vpnModeOn": "on (private hosts probed from your browser)",
    "vpnModeOff": "off (all probes via backend)",
    "dockerDiscovered": "Discovered from Docker"
}
```

- [ ] **Step 2: Add the same key to Chinese common.json**

Open `web/src/i18n/locales/zh/common.json`. Add the matching key:

```json
    "vpnCompatMode": "VPN 兼容模式",
    "vpnModeOn": "已开启（私网服务由浏览器探测）",
    "vpnModeOff": "已关闭（全部经后端探测）",
    "dockerDiscovered": "通过 Docker 发现"
}
```

- [ ] **Step 3: Verify i18n parity**

```
cd web && npm run lint:i18n
```

Expected: `✓ i18n parity OK across 2 languages, 5 namespaces`.

- [ ] **Step 4: Remove temporary ts-expect-error if present**

Open `web/src/components/cards/DockerBadge.tsx`. If you added `// @ts-expect-error` lines in Task 6 above the `t(...)` calls, delete them now — the i18n key exists, the casts are unused, and `// @ts-expect-error` on a no-error line is itself a TypeScript error.

- [ ] **Step 5: Update README.md (English) — Docker Labels section**

Open `README.md`. Find the line `## 🛠️ Development`. Insert this new section immediately above it (verbatim — copy from the literal text below; the YAML block stays as a regular fenced code block in the README itself):

> ## 🐳 Docker Labels (auto-discovery)
>
> Hearth can pick apps up from the labels on your running Docker
> containers and add them to the dashboard automatically — no UI clicks
> per service. Add a few labels to any container's `docker-compose.yml`
> and the app appears within ~30 seconds:
>
> ~~~yaml
> services:
>   jellyfin:
>     image: jellyfin/jellyfin
>     labels:
>       - "hearth.name=Jellyfin"
>       - "hearth.group=Media"
>       - "hearth.href=http://nas.lan:8096/"
>       - "hearth.icon=lucide:film"
>       - "hearth.description=Movie & TV server"
> ~~~
>
> | Label | Required | Purpose |
> |---|---|---|
> | `hearth.name` | yes | Display name |
> | `hearth.href` | yes | Where the card links to |
> | `hearth.group` | no | Falls into a same-named user group (case-insensitive) or a virtual "Docker" group |
> | `hearth.icon` | no | URL or `lucide:icon-name` |
> | `hearth.description` | no | Subtitle text |
>
> **Already on gethomepage / homepage?** Hearth also reads `homepage.*`
> labels with the same field names, so you can keep your existing
> docker-compose unchanged. When both prefixes are set on the same
> container, `hearth.*` wins per-field.
>
> **Lifecycle:** Containers must be in `state="running"` to appear.
> Stopping or removing a container makes the app vanish from the
> dashboard within 30 seconds. Docker-discovered apps are read-only in
> the UI (the backend refuses `PUT` / `DELETE` on them) — labels are the
> source of truth.
>
> **Toggling discovery off:** Set `HEARTH_DOCKER_LABEL_INTERVAL=0` to
> disable the polling loop entirely.

Notes when transcribing:
- In the actual README, replace the `~~~yaml` / `~~~` tilde fence with a normal triple-backtick `` ```yaml `` / `` ``` `` fence. The tildes here only exist to keep this plan's own markdown from breaking under nested fences.
- Drop the leading `>` blockquote markers — they're presentation-only here.

Also add the new env var to the Configuration table. Find the row for `HEARTH_DOCKER_ALLOW_PATTERNS` and add this row immediately below it:

```
| `HEARTH_DOCKER_LABEL_INTERVAL` | `30s` | Poll interval for `hearth.*`/`homepage.*` label discovery. `0s` (or `0`) disables the loop entirely. |
```

- [ ] **Step 6: Update README_CN.md (Chinese) — same structure**

Open `README_CN.md`. Find `## 🛠️ 开发` and insert this section immediately above it (same transcribing notes as Step 5 — replace `~~~yaml` with a normal triple-backtick fence in the actual README, drop the `>` markers):

> ## 🐳 Docker 标签自动发现
>
> Hearth 可以从正在运行的 Docker 容器的 labels 自动把服务加进
> dashboard,不需要在 UI 上一个一个手填。在任意容器的
> `docker-compose.yml` 加几个 label,~30 秒内自动出现:
>
> ~~~yaml
> services:
>   jellyfin:
>     image: jellyfin/jellyfin
>     labels:
>       - "hearth.name=Jellyfin"
>       - "hearth.group=Media"
>       - "hearth.href=http://nas.lan:8096/"
>       - "hearth.icon=lucide:film"
>       - "hearth.description=Movie & TV server"
> ~~~
>
> | Label | 必需 | 用途 |
> |---|---|---|
> | `hearth.name` | 是 | 显示名 |
> | `hearth.href` | 是 | 卡片跳转链接 |
> | `hearth.group` | 否 | 落入同名用户组(大小写不敏感)或虚拟"Docker"组 |
> | `hearth.icon` | 否 | URL 或 `lucide:图标名` |
> | `hearth.description` | 否 | 副标题 |
>
> **已经在用 gethomepage/homepage?** Hearth 同样识别 `homepage.*`
> labels(字段名相同),你的 docker-compose 一行不用改。同时存在两套
> prefix 时,`hearth.*` 在每个字段上分别优先。
>
> **生命周期:**容器必须在 `state="running"` 才显示。停止或删除容器,
> 对应的 app 在 30 秒内从 dashboard 消失。通过 Docker 发现的 app
> 在 UI 上只读(后端拒绝 `PUT` / `DELETE`)——labels 才是真相之源。
>
> **关闭自动发现:**设置 `HEARTH_DOCKER_LABEL_INTERVAL=0` 即可彻底
> 关闭轮询。

Add the env var to the Chinese Configuration table (immediately after the `HEARTH_DOCKER_ALLOW_PATTERNS` row):

```
| `HEARTH_DOCKER_LABEL_INTERVAL` | `30s` | 容器 `hearth.*`/`homepage.*` 标签发现的轮询间隔。`0s`(或 `0`)彻底关闭轮询。 |
```

- [ ] **Step 7: Verify build still passes**

```
cd web && npm run build
```

Expected: success.

- [ ] **Step 8: Commit**

```bash
git add web/src/i18n/locales/en/common.json web/src/i18n/locales/zh/common.json web/src/components/cards/DockerBadge.tsx README.md README_CN.md
git commit -m "docs: README docker labels section + dockerDiscovered i18n

User-facing rollout: README.md / README_CN.md gain a 'Docker Labels'
section with a docker-compose example, the field cheat-sheet, and the
homepage-compat note. HEARTH_DOCKER_LABEL_INTERVAL is added to the
config tables. The dockerDiscovered i18n key powers DockerBadge's
hover tooltip in both languages."
```

---

### Task 9: End-to-end verification

**Files:** none

- [ ] **Step 1: Full Go test suite**

```
go test ./...
```

Expected: every package passes — `internal/auth`, `internal/server`, `internal/store`, `internal/widgets`, `internal/docker` (new tests included).

- [ ] **Step 2: Frontend build + lint:i18n + test:network**

```
cd web && npm run build && npm run lint:i18n && npm run test:network
```

Expected: build clean, i18n parity ✓, network smoke test ✓.

- [ ] **Step 3: Manual verification**

Restart the dev stack so the backend picks up the new code:

```
make dev
```

Then either run a real container with hearth labels (preferred) or quickly fake one:

```bash
docker run -d --name hearth-demo \
  --label hearth.name=Demo \
  --label hearth.href=http://example.com/ \
  --label hearth.group=Tools \
  --label hearth.description="Demo via labels" \
  alpine sleep 600
```

Within ~30 seconds, on the dashboard:

1. The Demo card appears in the "Tools" user group if you have one — otherwise in a new virtual "Docker" group at the bottom.
2. The Demo card has a small blue Docker whale badge at the top-right of its icon. Hovering shows "Discovered from Docker" / "通过 Docker 发现".
3. Right-clicking or hovering over the Demo card does NOT show edit / delete buttons.
4. Trying to call `PUT /api/apps/docker:<id>` directly via curl returns 403.

Now stop the container:

```bash
docker stop hearth-demo && docker rm hearth-demo
```

Within 30s the card disappears. No leftover entries in the database (verify by listing `data/hearth.db` if you wish — there should be no demo row in `apps`).

Set `HEARTH_DOCKER_LABEL_INTERVAL=0` and restart `make dev`. Confirm:

5. Pre-existing manual apps still render normally.
6. No docker-discovered cards appear regardless of running labelled containers.

- [ ] **Step 4: Final commit (if any tweaks were needed)**

If the manual verification found nothing to fix, skip this step. Otherwise commit any small adjustments under a single follow-up commit:

```bash
git add -u
git commit -m "fix: address findings from docker labels manual verification"
```

- [ ] **Step 5: Update `tasks/todo.md` log**

Append a "Docker Labels (F2) — 2026-05-01" subsection to `tasks/todo.md` summarising the commits + the manual verification result.

```bash
git add tasks/todo.md
git commit -m "docs: log F2 docker labels rollout in tasks/todo.md"
```

---

## Self-Review Notes (already addressed inline)

- **Spec coverage:** Every section maps to a task — Task 1 covers the parser, Task 2 covers polling, Task 3 covers wiring + config, Task 4 covers merge logic + Source field, Task 5 covers mutation refusal, Task 6 covers frontend types + badge, Task 7 covers callsite wiring + UI lock, Task 8 covers i18n + README, Task 9 covers verification. The spec's non-goals (no widget integration, no auto-URL inference, no event subscription) require no work.
- **Type consistency:** `LabelApp` shape is defined in Task 1 and used unchanged in Tasks 2, 4. `dockerAppIDPrefix = "docker:"` and `dockerVirtualGroupID = "docker:"` are the same constant by intention — both encode the "docker-managed" sentinel — and are used consistently across `mergeAppsWithDocker`, `mergeGroupsWithDocker`, `isDockerManagedID`. `Source` field is `string` server-side and `'manual' | 'docker' \| undefined` client-side; the omitempty JSON tag on the Go side keeps the wire format friendly to absent-on-manual.
- **Code completeness:** Every step that mutates code shows the full code block; copy-paste friendly.
- **Caveat acknowledged:** Task 6's i18n-key timing requires either a temporary `// @ts-expect-error` or accepting that strict-typed i18n setups will fail the Task 6 build until Task 8. The plan calls this out and tells the engineer how to handle either case.
