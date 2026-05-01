package server

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"syscall"
	"time"
)

type appStatus struct {
	ID         string `json:"id"`
	Status     string `json:"status"`     // "up" | "slow" | "down" | "unknown"
	StatusCode int    `json:"statusCode"` // HTTP status code, 0 if unreachable
	LatencyMs  int64  `json:"latencyMs"`
}

// classifyProbeError maps a probe failure to a status string.
//
// Distinguish "the server can't see the target at all" (network-layer
// unreachable, DNS failure) from "the target rejected our request"
// (connection refused, TLS error, timeout from a slow upstream).
// The first case is rendered as "unknown" (gray dot in the UI) because
// the target may still be reachable from the user's browser — for
// instance, when Hearth runs on a host behind a VPN that doesn't route
// the LAN, the operator's Go runtime cannot dial 192.168.x.y but the
// operator's browser still can. Calling that "down" misleads the user.
// The second case really is unhealthy from the operator's vantage point
// and stays "down".
func classifyProbeError(err error) string {
	if err == nil {
		return "up"
	}
	// EHOSTUNREACH / ENETUNREACH: the kernel says the destination address
	// has no route from this socket. Common when a VPN owns the default
	// route and the LAN isn't included.
	if errors.Is(err, syscall.EHOSTUNREACH) || errors.Is(err, syscall.ENETUNREACH) {
		return "unknown"
	}
	// DNS resolution failed — also a server-side network issue.
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return "unknown"
	}
	return "down"
}

type statusResponse struct {
	Items []appStatus `json:"items"`
}

// probe sends a single HTTP request and returns statusCode, latencyMs, error.
func probe(ctx context.Context, client *http.Client, method, url string) (int, int64, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return 0, 0, err
	}
	req.Header.Set("User-Agent", "Hearth-HealthCheck/1.0")

	start := time.Now()
	resp, err := client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return 0, latency, err
	}
	resp.Body.Close()
	return resp.StatusCode, latency, nil
}

func (s *Server) handleGetAppsStatus(w http.ResponseWriter, r *http.Request) {
	apps, err := s.store.ListApps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list apps")
		return
	}

	type target struct {
		id  string
		url string
	}

	var targets []target
	for _, a := range apps {
		if strings.HasPrefix(a.URL, "widget:") {
			continue
		}
		if !strings.HasPrefix(a.URL, "http://") && !strings.HasPrefix(a.URL, "https://") {
			continue
		}
		targets = append(targets, target{a.ID, a.URL})
	}

	if len(targets) == 0 {
		writeJSON(w, http.StatusOK, statusResponse{Items: []appStatus{}})
		return
	}

	results := make([]appStatus, len(targets))

	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // health check only, not fetching sensitive data
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}

	sem := make(chan struct{}, 10) // max 10 concurrent
	var wg sync.WaitGroup

	for i, t := range targets {
		wg.Add(1)
		go func(idx int, id, url string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()

			// Try HEAD first; fall back to GET if HEAD fails entirely.
			code, latency, err := probe(ctx, client, http.MethodHead, url)
			if err != nil {
				code, latency, err = probe(ctx, client, http.MethodGet, url)
			}

			// Any HTTP response (even 401/403/500) means the service is reachable.
			// On error, distinguish network-layer unreachable ("unknown" — the
			// server-side stack can't see the target, but the user's browser
			// might) from app-level unhealthy ("down").
			if err != nil {
				results[idx] = appStatus{ID: id, Status: classifyProbeError(err), LatencyMs: latency}
				return
			}

			status := "up"
			if latency > 2000 {
				status = "slow"
			}

			results[idx] = appStatus{
				ID:         id,
				Status:     status,
				StatusCode: code,
				LatencyMs:  latency,
			}
		}(i, t.id, t.url)
	}

	wg.Wait()
	writeJSON(w, http.StatusOK, statusResponse{Items: results})
}
