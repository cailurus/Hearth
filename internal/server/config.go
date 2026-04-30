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
	InitialPassword   string // first-run admin password; if empty, a random password is generated and printed to PasswordOutput

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
	initialPassword := getEnv("HEARTH_INITIAL_PASSWORD", "")

	return Config{
		Addr:              addr,
		DataDir:           dataDir,
		DatabaseDSN:       dsn,
		SessionTTL:        sessionTTL,
		CORSOrigins:       corsOrigins,
		CookieSecure:      cookieSecure,
		DockerSocket:      dockerSocket,
		InitialPassword:   initialPassword,
	}
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
