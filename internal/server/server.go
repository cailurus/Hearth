package server

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	_ "modernc.org/sqlite"

	"github.com/morezhou/hearth/internal/auth"
	"github.com/morezhou/hearth/internal/background"
	"github.com/morezhou/hearth/internal/docker"
	"github.com/morezhou/hearth/internal/icon"
	"github.com/morezhou/hearth/internal/metrics"
	"github.com/morezhou/hearth/internal/store"
)

// db is stored so we can close it on shutdown.


// Version is set at build time via ldflags.
var Version = "dev"

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
}

func New(cfg Config) (*Server, error) {
	if cfg.Addr == "" {
		return nil, errors.New("addr is required")
	}
	if cfg.DataDir == "" {
		return nil, errors.New("data dir is required")
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(cfg.DataDir, "icons"), 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(cfg.DataDir, "cache"), 0o755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", cfg.DatabaseDSN)
	if err != nil {
		return nil, err
	}

	// SQLite works best with a single writer connection.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	// SQLite pragmas for better performance and reliability.
	if _, err := db.Exec("PRAGMA journal_mode = WAL;"); err != nil {
		slog.Warn("failed to set WAL mode", "error", err)
	}
	if _, err := db.Exec("PRAGMA foreign_keys = ON;"); err != nil {
		slog.Warn("failed to enable foreign keys", "error", err)
	}
	if _, err := db.Exec("PRAGMA busy_timeout = 5000;"); err != nil {
		slog.Warn("failed to set busy_timeout", "error", err)
	}

	st := store.New(db)
	if err := st.Migrate(); err != nil {
		return nil, err
	}

	authSvc, err := auth.New(auth.Config{
		DB:              db,
		SessionTTL:      cfg.SessionTTL,
		InitialPassword: cfg.InitialPassword,
		PasswordOutput:  cfg.PasswordOutput,
	})
	if err != nil {
		return nil, err
	}

	iconResolver := icon.New(filepath.Join(cfg.DataDir, "icons"))
	bgSvc, err := background.New(background.Config{CacheDir: filepath.Join(cfg.DataDir, "cache")})
	if err != nil {
		return nil, err
	}

	dockerClient := docker.New(cfg.DockerSocket)
	mc := metrics.NewCollector(db)
	mc.Start()

	allowPatterns, err := compileDockerAllowPatterns(cfg.DockerAllowPatterns)
	if err != nil {
		return nil, fmt.Errorf("HEARTH_DOCKER_ALLOW_PATTERNS: %w", err)
	}

	s := &Server{
		cfg:                 cfg,
		db:                  db,
		store:               st,
		auth:                authSvc,
		iconResolver:        iconResolver,
		bgSvc:               bgSvc,
		dockerClient:        dockerClient,
		metricsCollector:    mc,
		dockerAllowPatterns: allowPatterns,
	}
	if err := s.ensureDefaultSystemTools(); err != nil {
		return nil, err
	}
	s.router = s.buildRouter()
	return s, nil
}

// compileDockerAllowPatterns parses HEARTH_DOCKER_ALLOW_PATTERNS (comma-separated
// regexes against the full container name). Empty input means "no restriction".
// Invalid regexes fail fast at startup so an operator with a typo doesn't end up
// with a silently locked-down dashboard.
func compileDockerAllowPatterns(raw string) ([]*regexp.Regexp, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	out := make([]*regexp.Regexp, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		re, err := regexp.Compile(p)
		if err != nil {
			return nil, fmt.Errorf("invalid pattern %q: %w", p, err)
		}
		out = append(out, re)
	}
	return out, nil
}

func (s *Server) Router() http.Handler { return s.router }

// Close releases resources held by the server (database, background goroutines).
func (s *Server) Close() error {
	s.metricsCollector.Stop()
	s.auth.Stop()
	return s.db.Close()
}

func (s *Server) buildRouter() chi.Router {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	corsOpts := cors.Options{
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}
	if s.cfg.CORSOrigins != "" {
		origins := strings.Split(s.cfg.CORSOrigins, ",")
		for i := range origins {
			origins[i] = strings.TrimSpace(origins[i])
		}
		corsOpts.AllowedOrigins = origins
	} else {
		// Default: only the local Vite dev server. Production deployments serve the
		// built frontend from the same origin as the API and need no CORS allowance;
		// any other deployment must opt in explicitly via HEARTH_CORS_ORIGINS.
		corsOpts.AllowedOrigins = []string{
			"http://localhost:5173",
			"http://127.0.0.1:5173",
		}
	}
	r.Use(cors.Handler(corsOpts))

	// Serve cached icons (local file cache).
	iconsDir := http.Dir(filepath.Join(s.cfg.DataDir, "icons"))
	r.Handle("/assets/icons/*", http.StripPrefix("/assets/icons/", withNoCache(http.FileServer(iconsDir))))

	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		dbOK := s.store.Ping() == nil
		status := http.StatusOK
		if !dbOK {
			status = http.StatusServiceUnavailable
		}
		writeJSON(w, status, map[string]any{
			"ok":       dbOK,
			"version":  Version,
			"database": dbOK,
		})
	})

	r.Group(func(r chi.Router) {
		r.Use(s.optionalUser)
		r.Get("/api/auth/me", s.handleMe)
	})
	// Auth endpoints are public
	r.Post("/api/auth/login", s.handleLogin)
	r.Post("/api/auth/logout", s.handleLogout)
	// Password change requires admin
	r.With(s.requireAdmin).Post("/api/auth/password", s.handleChangePassword)

	// Settings: GET is public; PUT requires admin.
	r.Get("/api/settings", s.handleGetSettings)
	r.With(s.requireAdmin).Put("/api/settings", s.handlePutSettings)

	// Groups/Apps: list is public; mutations require admin.
	r.Get("/api/groups", s.handleListGroups)
	r.With(s.requireAdmin).Post("/api/groups", s.handleCreateGroup)
	r.With(s.requireAdmin).Put("/api/groups/{id}", s.handleUpdateGroup)
	r.With(s.requireAdmin).Delete("/api/groups/{id}", s.handleDeleteGroup)
	r.With(s.requireAdmin).Post("/api/groups/reorder", s.handleReorderGroups)

	r.Get("/api/apps", s.handleListApps)
	r.Get("/api/apps/status", s.handleGetAppsStatus)
	r.With(s.requireAdmin).Post("/api/apps", s.handleCreateApp)
	r.With(s.requireAdmin).Put("/api/apps/{id}", s.handleUpdateApp)
	r.With(s.requireAdmin).Delete("/api/apps/{id}", s.handleDeleteApp)
	r.With(s.requireAdmin).Post("/api/apps/reorder", s.handleReorderApps)

	// Icon resolving requires admin (it performs server-side fetching and caching).
	r.With(s.requireAdmin).Post("/api/icon/resolve", s.handleResolveIcon)

	// Lucide icon search (public, cached on server).
	r.Get("/api/icons/lucide/search", s.handleSearchLucideIcons)
	r.Get("/api/icons/lucide/all", s.handleListAllLucideIcons)

	// Background is public.
	r.Get("/api/background", s.handleGetBackground)
	r.Get("/api/background/image", s.handleGetBackgroundImage)
	r.With(s.requireAdmin).Post("/api/background/refresh", s.handleRefreshBackground)

	// Widgets are public.
	r.Get("/api/widgets/weather", s.handleGetWeather)
	r.Get("/api/widgets/geocode", s.handleSearchCity)
	r.Get("/api/widgets/timezone", s.handleGetCityTimezone)
	r.Get("/api/widgets/timezones", s.handleGetTimezones)
	r.Get("/api/widgets/markets", s.handleGetMarkets)
	r.Get("/api/widgets/markets/search", s.handleSearchMarkets)
	r.Get("/api/widgets/markets/icon", s.handleGetMarketIcon)
	r.Head("/api/widgets/markets/icon", s.handleGetMarketIcon)
	r.Get("/api/widgets/holidays", s.handleGetHolidays)
	r.Get("/api/widgets/holidays/countries", s.handleListHolidayCountries)
	r.Get("/api/widgets/rss", s.handleGetRSS)
	r.Get("/api/widgets/quote", s.handleGetQuote)
	r.Get("/api/widgets/currency", s.handleGetCurrency)
	r.Get("/api/widgets/deals", s.handleGetDeals)

	// Host metrics are public (visitor dashboard).
	r.Get("/api/metrics/host", s.handleGetHostMetrics)
	r.Get("/api/metrics/history", s.handleGetMetricsHistory)
	r.Get("/api/widgets/docker", s.handleGetDocker)
	r.With(s.requireAdmin).Post("/api/widgets/docker/{id}/{action}", s.handleDockerAction)

	// Notes require admin.
	r.With(s.requireAdmin).Get("/api/notes", s.handleListNotes)
	r.With(s.requireAdmin).Post("/api/notes", s.handleCreateNote)
	r.With(s.requireAdmin).Put("/api/notes/{id}", s.handleUpdateNote)
	r.With(s.requireAdmin).Delete("/api/notes/{id}", s.handleDeleteNote)

	// Import/export requires admin.
	r.With(s.requireAdmin).Get("/api/export", s.handleExport)
	r.With(s.requireAdmin).Post("/api/import", s.handleImport)

	// Admin maintenance.
	r.With(s.requireAdmin).Post("/api/admin/reset", s.handleAdminReset)

	// Serve built frontend (if present).
	if h, ok := tryFrontendHandler(filepath.Join("web", "dist")); ok {
		r.NotFound(h)
	}

	return r
}

func tryFrontendHandler(distDir string) (http.HandlerFunc, bool) {
	indexPath := filepath.Join(distDir, "index.html")
	if st, err := os.Stat(indexPath); err != nil || st.IsDir() {
		return nil, false
	}

	fs := http.Dir(distDir)
	fileServer := http.FileServer(fs)

	return func(w http.ResponseWriter, r *http.Request) {
		// Keep API semantics: unknown API routes should remain 404 JSON.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, "not found")
			return
		}

		// Let existing explicit routes handle cached icons. If we get here, the
		// icon path didn't match or file didn't exist.
		if strings.HasPrefix(r.URL.Path, "/assets/icons/") {
			http.NotFound(w, r)
			return
		}

		// Serve static asset if it exists; otherwise, fall back to index.html.
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			http.ServeFile(w, r, indexPath)
			return
		}
		if f, err := fs.Open(p); err == nil {
			defer f.Close()
			if st, err := f.Stat(); err == nil && !st.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		http.ServeFile(w, r, indexPath)
	}, true
}

func withNoCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Avoid stale icons during development.
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
