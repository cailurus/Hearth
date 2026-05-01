package server

import (
	"io"
	"os"
)

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

	// Forward-auth (Authelia / Authentik / oauth2-proxy / Caddy forward_auth /
	// Traefik forwardAuth). Both must be set to enable; either empty disables.
	// TrustedProxyHeader is the HTTP header that carries the authenticated
	// username (e.g. "X-Remote-User", "Remote-User"). TrustedProxyNetworks is
	// the comma-separated CIDR list the proxy can connect from; the header is
	// honored only when r.RemoteAddr is inside one of these networks. This
	// prevents a request that bypasses the proxy from forging the header.
	TrustedProxyHeader   string
	TrustedProxyNetworks string

	// PasswordOutput receives the generated initial password banner. Production
	// leaves it nil (defaults to os.Stdout, captured by `docker logs`); tests
	// inject a buffer to assert the printed value.
	PasswordOutput io.Writer
}

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

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
