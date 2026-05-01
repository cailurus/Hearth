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
