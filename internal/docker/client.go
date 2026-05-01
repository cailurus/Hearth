package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Container holds information about a single Docker container.
type Container struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Image      string  `json:"image"`
	Status     string  `json:"status"`
	State      string  `json:"state"`
	UpSince    string  `json:"upSince"`
	CpuPercent float64 `json:"cpuPercent"`
	MemUsed    uint64  `json:"memUsed"`
	MemLimit   uint64  `json:"memLimit"`
	MemPercent float64 `json:"memPercent"`
	NetRx      uint64  `json:"netRx"`
	NetTx      uint64  `json:"netTx"`
}

// Response is the API response returned to the frontend.
type Response struct {
	Available     bool        `json:"available"`
	Containers    []Container `json:"containers"`
	TotalCpu      float64     `json:"totalCpu"`
	TotalMemUsed  uint64      `json:"totalMemUsed"`
	TotalMemLimit uint64      `json:"totalMemLimit"`
	CollectedAt   int64       `json:"collectedAt"`
	Error         string      `json:"error,omitempty"`
}

// Client communicates with the Docker daemon over a Unix socket.
type Client struct {
	socketPath string
	httpClient *http.Client
}

// Common Docker socket paths across platforms.
var defaultSocketPaths = []string{
	"/var/run/docker.sock",                            // Linux standard
	"/host-run/docker.sock",                           // NAS directory mount (e.g. fnOS: /var/run → /host-run)
	"/host/run/docker.sock",                           // NAS alternative mount path
	os.Getenv("HOME") + "/.docker/run/docker.sock",   // Docker Desktop (macOS/Windows)
	os.Getenv("HOME") + "/.orbstack/run/docker.sock",  // OrbStack (macOS)
	os.Getenv("HOME") + "/.colima/default/docker.sock", // Colima (macOS)
	os.Getenv("HOME") + "/.docker/desktop/docker.sock", // Docker Desktop alternative
	"/run/docker.sock",                                // Some Linux distros
}

// New creates a Docker client. If socketPath is non-empty and exists, it is used directly.
// Otherwise, common paths are probed automatically.
func New(socketPath string) *Client {
	c := &Client{
		socketPath: resolveSocketPath(socketPath),
	}
	c.httpClient = &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				// Use c.socketPath so it reflects any re-probing from Available()
				return (&net.Dialer{}).DialContext(ctx, "unix", c.socketPath)
			},
		},
		Timeout: 15 * time.Second,
	}
	return c
}

func resolveSocketPath(explicit string) string {
	// If explicitly set and exists, use it
	if explicit != "" {
		if _, err := os.Stat(explicit); err == nil {
			return explicit
		}
	}
	// Auto-detect from common paths
	for _, p := range defaultSocketPaths {
		if p == "" {
			continue
		}
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	// Fallback to the explicit path (or Linux default) even if not found yet
	if explicit != "" {
		return explicit
	}
	return "/var/run/docker.sock"
}

// Available checks if the Docker socket is accessible.
func (c *Client) Available() bool {
	// Re-probe in case socket appeared after startup (e.g. Docker Desktop launched later)
	c.socketPath = resolveSocketPath(c.socketPath)
	_, err := os.Stat(c.socketPath)
	return err == nil
}

// Collect fetches container list and stats from the Docker daemon.
func (c *Client) Collect(ctx context.Context) Response {
	if !c.Available() {
		return Response{
			Available:   false,
			Containers:  []Container{},
			CollectedAt: time.Now().UnixMilli(),
		}
	}

	entries, err := c.listContainers(ctx)
	if err != nil {
		return Response{
			Available:   true,
			Containers:  []Container{},
			CollectedAt: time.Now().UnixMilli(),
			Error:       err.Error(),
		}
	}

	containers := make([]Container, len(entries))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 10)

	for i, e := range entries {
		name := e.name()
		image := e.Image
		// Shorten image name: remove sha256 digests
		if idx := strings.Index(image, "@sha256:"); idx > 0 {
			image = image[:idx]
		}

		containers[i] = Container{
			ID:      e.ID[:12],
			Name:    name,
			Image:   image,
			Status:  strings.ToLower(e.State),
			State:   e.StatusStr,
			UpSince: e.StatusStr,
		}

		if strings.ToLower(e.State) != "running" {
			continue
		}

		wg.Add(1)
		go func(idx int, id string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			sCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()

			stats, err := c.getStats(sCtx, id)
			if err != nil {
				return
			}

			containers[idx].CpuPercent = stats.cpuPercent()
			containers[idx].MemUsed = stats.memUsed()
			containers[idx].MemLimit = stats.memLimit()
			if ml := stats.memLimit(); ml > 0 {
				containers[idx].MemPercent = float64(stats.memUsed()) / float64(ml) * 100
			}
			rx, tx := stats.network()
			containers[idx].NetRx = rx
			containers[idx].NetTx = tx
		}(i, e.ID)
	}

	wg.Wait()

	var totalCpu float64
	var totalMemUsed, totalMemLimit uint64
	for _, c := range containers {
		if c.Status == "running" {
			totalCpu += c.CpuPercent
			totalMemUsed += c.MemUsed
			totalMemLimit += c.MemLimit
		}
	}

	return Response{
		Available:     true,
		Containers:    containers,
		TotalCpu:      totalCpu,
		TotalMemUsed:  totalMemUsed,
		TotalMemLimit: totalMemLimit,
		CollectedAt:   time.Now().UnixMilli(),
	}
}

// ── Docker API types (unexported) ────────────────────────────────

type containerListEntry struct {
	ID        string            `json:"Id"`
	Names     []string          `json:"Names"`
	Image     string            `json:"Image"`
	State     string            `json:"State"`
	StatusStr string            `json:"Status"`
	Labels    map[string]string `json:"Labels"`
}

func (e *containerListEntry) name() string {
	if len(e.Names) > 0 {
		return strings.TrimPrefix(e.Names[0], "/")
	}
	return e.ID[:12]
}

type statsResponse struct {
	CPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
		OnlineCPUs     uint64 `json:"online_cpus"`
	} `json:"cpu_stats"`
	PreCPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
	} `json:"precpu_stats"`
	MemoryStats struct {
		Usage uint64 `json:"usage"`
		Limit uint64 `json:"limit"`
		Stats struct {
			InactiveFile uint64 `json:"inactive_file"`
		} `json:"stats"`
	} `json:"memory_stats"`
	Networks map[string]struct {
		RxBytes uint64 `json:"rx_bytes"`
		TxBytes uint64 `json:"tx_bytes"`
	} `json:"networks"`
}

func (s *statsResponse) cpuPercent() float64 {
	cpuDelta := float64(s.CPUStats.CPUUsage.TotalUsage - s.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(s.CPUStats.SystemCPUUsage - s.PreCPUStats.SystemCPUUsage)
	numCPUs := s.CPUStats.OnlineCPUs
	if numCPUs == 0 {
		numCPUs = 1
	}
	if systemDelta > 0 {
		return (cpuDelta / systemDelta) * float64(numCPUs) * 100.0
	}
	return 0
}

func (s *statsResponse) memUsed() uint64 {
	// Docker calculates "used" as usage minus inactive_file (cache)
	usage := s.MemoryStats.Usage
	cache := s.MemoryStats.Stats.InactiveFile
	if usage > cache {
		return usage - cache
	}
	return usage
}

func (s *statsResponse) memLimit() uint64 {
	return s.MemoryStats.Limit
}

func (s *statsResponse) network() (rx, tx uint64) {
	for _, n := range s.Networks {
		rx += n.RxBytes
		tx += n.TxBytes
	}
	return
}

// ContainerName looks up a container's primary name. The lookup is best-effort:
// it returns an empty string and nil error if the container can't be found
// (the caller can still proceed with the requested action and record the ID
// alone in audit). It returns a non-nil error only on transport-level failure.
func (c *Client) ContainerName(ctx context.Context, containerID string) (string, error) {
	if !c.Available() {
		return "", nil
	}
	endpoint := fmt.Sprintf("http://localhost/containers/%s/json", containerID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return "", nil
	}
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("docker inspect: status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return "", err
	}
	var info struct {
		Name string `json:"Name"`
	}
	if err := json.Unmarshal(body, &info); err != nil {
		return "", err
	}
	return strings.TrimPrefix(info.Name, "/"), nil
}

// ContainerAction sends a start/stop/restart command to a container.
func (c *Client) ContainerAction(ctx context.Context, containerID, action string) error {
	if !c.Available() {
		return fmt.Errorf("docker not available")
	}
	endpoint := fmt.Sprintf("http://localhost/containers/%s/%s", containerID, action)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("docker %s: status %d: %s", action, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

// ── HTTP helpers ─────────────────────────────────────────────────

func (c *Client) listContainers(ctx context.Context) ([]containerListEntry, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"http://localhost/containers/json?all=true", nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("docker api: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("docker api status %d: %s", resp.StatusCode, string(body))
	}

	var entries []containerListEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func (c *Client) getStats(ctx context.Context, containerID string) (*statsResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("http://localhost/containers/%s/stats?stream=false", containerID), nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("stats %d: %s", resp.StatusCode, string(body))
	}

	var stats statsResponse
	if err := json.Unmarshal(body, &stats); err != nil {
		return nil, err
	}
	return &stats, nil
}
