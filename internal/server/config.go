package server

import "os"

type Config struct {
	Addr        string
	DataDir     string
	DatabaseDSN string
	SessionTTL  string
	// Optional: when set, server can fetch and cache market icons on-demand.
	// Example: https://raw.githubusercontent.com/<owner>/<repo>/main
	MarketIconBaseURL string
}

const defaultMarketIconBaseURL = "https://raw.githubusercontent.com/nvstly/icons/main"

func LoadConfigFromEnv() Config {
	addr := getEnv("HEARTH_ADDR", ":8787")
	dataDir := getEnv("HEARTH_DATA_DIR", "./data")
	dsn := getEnv("HEARTH_DB_DSN", dataDir+"/hearth.db")
	sessionTTL := getEnv("HEARTH_SESSION_TTL", "168h")
	marketIconBaseURL := getEnv("HEARTH_MARKET_ICON_BASE_URL", defaultMarketIconBaseURL)

	return Config{
		Addr:              addr,
		DataDir:           dataDir,
		DatabaseDSN:       dsn,
		SessionTTL:        sessionTTL,
		MarketIconBaseURL: marketIconBaseURL,
	}
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
