package server

import "os"

type Config struct {
	Addr        string
	DataDir     string
	DatabaseDSN string
	SessionTTL  string
}

func LoadConfigFromEnv() Config {
	addr := getEnv("HEARTH_ADDR", ":8787")
	dataDir := getEnv("HEARTH_DATA_DIR", "./data")
	dsn := getEnv("HEARTH_DB_DSN", dataDir+"/hearth.db")
	sessionTTL := getEnv("HEARTH_SESSION_TTL", "168h")

	return Config{
		Addr:        addr,
		DataDir:     dataDir,
		DatabaseDSN: dsn,
		SessionTTL:  sessionTTL,
	}
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
