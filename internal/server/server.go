package server

import (
	"database/sql"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	_ "modernc.org/sqlite"

	"github.com/morezhou/hearth/internal/auth"
	"github.com/morezhou/hearth/internal/background"
	"github.com/morezhou/hearth/internal/icon"
	"github.com/morezhou/hearth/internal/store"
)

type Server struct {
	cfg          Config
	router       chi.Router
	store        *store.Store
	auth         *auth.Service
	iconResolver *icon.Resolver
	bgSvc        *background.Service
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
	// SQLite pragmas
	_, _ = db.Exec("PRAGMA journal_mode = WAL;")
	_, _ = db.Exec("PRAGMA foreign_keys = ON;")

	st := store.New(db)
	if err := st.Migrate(); err != nil {
		return nil, err
	}

	authSvc, err := auth.New(auth.Config{DB: db, SessionTTL: cfg.SessionTTL})
	if err != nil {
		return nil, err
	}

	iconResolver := icon.New(filepath.Join(cfg.DataDir, "icons"))
	bgSvc, err := background.New(background.Config{CacheDir: filepath.Join(cfg.DataDir, "cache")})
	if err != nil {
		return nil, err
	}

	s := &Server{cfg: cfg, store: st, auth: authSvc, iconResolver: iconResolver, bgSvc: bgSvc}
	if err := s.ensureDefaultSystemTools(); err != nil {
		return nil, err
	}
	s.router = s.buildRouter()
	return s, nil
}

func (s *Server) Router() http.Handler { return s.router }

func (s *Server) buildRouter() chi.Router {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Serve cached icons (local file cache).
	iconsDir := http.Dir(filepath.Join(s.cfg.DataDir, "icons"))
	r.Handle("/assets/icons/*", http.StripPrefix("/assets/icons/", withNoCache(http.FileServer(iconsDir))))

	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	r.Group(func(r chi.Router) {
		r.Use(s.optionalUser)
		r.Get("/api/auth/me", s.handleMe)
	})
	// Auth endpoints are public
	r.Post("/api/auth/login", s.handleLogin)
	r.Post("/api/auth/logout", s.handleLogout)

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
	r.With(s.requireAdmin).Post("/api/apps", s.handleCreateApp)
	r.With(s.requireAdmin).Put("/api/apps/{id}", s.handleUpdateApp)
	r.With(s.requireAdmin).Delete("/api/apps/{id}", s.handleDeleteApp)
	r.With(s.requireAdmin).Post("/api/apps/reorder", s.handleReorderApps)

	// Icon resolving requires admin (it performs server-side fetching and caching).
	r.With(s.requireAdmin).Post("/api/icon/resolve", s.handleResolveIcon)

	// Background is public.
	r.Get("/api/background", s.handleGetBackground)
	r.Get("/api/background/image", s.handleGetBackgroundImage)
	r.With(s.requireAdmin).Post("/api/background/refresh", s.handleRefreshBackground)

	// Widgets are public.
	r.Get("/api/widgets/weather", s.handleGetWeather)
	r.Get("/api/widgets/geocode", s.handleSearchCity)
	r.Get("/api/widgets/timezone", s.handleGetCityTimezone)
	r.Get("/api/widgets/timezones", s.handleGetTimezones)

	// Host metrics are public (visitor dashboard).
	r.Get("/api/metrics/host", s.handleGetHostMetrics)

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

var _ = strings.Builder{}
