package server

import "os"

type Config struct {
	Addr        string
	DataDir     string
	DatabaseDSN string
	SessionTTL  string
	CORSOrigins       string // comma-separated allowed origins; empty = allow all (dev mode)
	CookieSecure      string // "auto" | "true" | "false"; default "auto"
	DockerSocket      string // Docker socket path; default "/var/run/docker.sock"
}

func LoadConfigFromEnv() Config {
	addr := getEnv("HEARTH_ADDR", ":8787")
	dataDir := getEnv("HEARTH_DATA_DIR", "./data")
	dsn := getEnv("HEARTH_DB_DSN", dataDir+"/hearth.db")
	sessionTTL := getEnv("HEARTH_SESSION_TTL", "168h")
	corsOrigins := getEnv("HEARTH_CORS_ORIGINS", "")
	cookieSecure := getEnv("HEARTH_COOKIE_SECURE", "auto")
	dockerSocket := getEnv("HEARTH_DOCKER_SOCKET", "/var/run/docker.sock")

	return Config{
		Addr:              addr,
		DataDir:           dataDir,
		DatabaseDSN:       dsn,
		SessionTTL:        sessionTTL,
		CORSOrigins:       corsOrigins,
		CookieSecure:      cookieSecure,
		DockerSocket:      dockerSocket,
	}
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
