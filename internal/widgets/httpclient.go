package widgets

import (
	"net/http"
	"time"
)

// DefaultClient is a shared HTTP client for all widget data fetching.
// Reuses connections across requests instead of creating a new client per call.
var DefaultClient = &http.Client{
	Timeout: 12 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        20,
		MaxIdleConnsPerHost: 5,
		IdleConnTimeout:     90 * time.Second,
	},
}
