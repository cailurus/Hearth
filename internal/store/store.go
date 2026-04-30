package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Store struct {
	db *sql.DB
}

func New(db *sql.DB) *Store {
	return &Store{db: db}
}

// Ping checks database connectivity.
func (s *Store) Ping() error {
	return s.db.Ping()
}

func (s *Store) Migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS kv (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS icon_cache (
			cache_key TEXT PRIMARY KEY,
			icon_path TEXT NOT NULL,
			icon_source TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS background_cache (
			cache_key TEXT PRIMARY KEY,
			file_path TEXT NOT NULL,
			fetched_at INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS groups (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			kind TEXT NOT NULL DEFAULT 'app',
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS apps (
			id TEXT PRIMARY KEY,
			group_id TEXT,
			name TEXT NOT NULL,
			url TEXT NOT NULL,
			icon_path TEXT,
			icon_source TEXT,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_apps_group_order ON apps(group_id, sort_order);`,
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);`,
		`CREATE TABLE IF NOT EXISTS notes (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS metrics_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ts INTEGER NOT NULL,
			cpu_percent REAL NOT NULL DEFAULT 0,
			mem_percent REAL NOT NULL DEFAULT 0,
			disk_percent REAL NOT NULL DEFAULT 0,
			net_bytes_sent INTEGER NOT NULL DEFAULT 0,
			net_bytes_recv INTEGER NOT NULL DEFAULT 0
		);`,
		`CREATE INDEX IF NOT EXISTS idx_metrics_history_ts ON metrics_history(ts);`,
		// audit_log: append-only record of admin actions. Currently only Docker
		// container actions are audited; the schema is generic enough to absorb
		// future events (settings changes, user mgmt, etc.) without migration.
		`CREATE TABLE IF NOT EXISTS audit_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ts INTEGER NOT NULL,
			user_id TEXT NOT NULL DEFAULT '',
			username TEXT NOT NULL DEFAULT '',
			action TEXT NOT NULL,
			target_type TEXT NOT NULL DEFAULT '',
			target_id TEXT NOT NULL DEFAULT '',
			target_name TEXT NOT NULL DEFAULT '',
			remote_ip TEXT NOT NULL DEFAULT '',
			result TEXT NOT NULL DEFAULT '',
			error_msg TEXT NOT NULL DEFAULT ''
		);`,
		`CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);`,
		// login_attempts: rate-limit state, persisted to survive restarts. Each
		// failed login appends a row; the row that pushes the count over the
		// threshold within attemptWindow has blocked_at set to the trigger time.
		`CREATE TABLE IF NOT EXISTS login_attempts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL,
			remote_ip TEXT NOT NULL DEFAULT '',
			attempt_at INTEGER NOT NULL,
			blocked_at INTEGER NOT NULL DEFAULT 0
		);`,
		`CREATE INDEX IF NOT EXISTS idx_login_attempts_username_time ON login_attempts(username, attempt_at);`,
	}

	for _, stmt := range stmts {
		if _, err := s.db.Exec(stmt); err != nil {
			return err
		}
	}

	// Best-effort schema evolution.
	if _, err := s.db.Exec(`ALTER TABLE apps ADD COLUMN description TEXT`); err != nil {
		// Ignore if column already exists.
		if !strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			return err
		}
	}
	if _, err := s.db.Exec(`ALTER TABLE groups ADD COLUMN kind TEXT NOT NULL DEFAULT 'app'`); err != nil {
		// Ignore if column already exists.
		errLower := strings.ToLower(err.Error())
		if !strings.Contains(errLower, "duplicate") && !strings.Contains(errLower, "already exists") {
			return err
		}
	}
	if _, err := s.db.Exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`); err != nil {
		// Ignore if column already exists.
		errLower := strings.ToLower(err.Error())
		if !strings.Contains(errLower, "duplicate") && !strings.Contains(errLower, "already exists") {
			return err
		}
	}
	// Migrate legacy default system group names.
	_, _ = s.db.Exec(`UPDATE groups SET kind = 'system' WHERE name IN ('系统组件', 'System Tools', 'System Widgets')`)

	// Legacy compatibility:
	// - Ensure there is exactly one system group.
	// - Move any widget apps (url starts with `widget:`) into the system group.
	//   This prevents mixed app/widget layouts (especially in ungrouped) from "jumping".
	{
		var systemID string
		err := s.db.QueryRow(`SELECT id FROM groups WHERE kind = 'system' ORDER BY sort_order ASC, created_at ASC LIMIT 1`).Scan(&systemID)
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}

			// Create a default system group.
			now := time.Now().Unix()
			id := uuid.NewString()
			var nextOrder int
			_ = s.db.QueryRow(`SELECT COALESCE(MAX(sort_order), 0) + 1 FROM groups`).Scan(&nextOrder)
			if _, err := s.db.Exec(
				`INSERT INTO groups (id, name, kind, sort_order, created_at) VALUES (?, ?, 'system', ?, ?)`,
				id,
				"系统组件",
				nextOrder,
				now,
			); err != nil {
				return err
			}
			systemID = id
		}

		// If multiple system groups exist (e.g., via import), keep the first and downgrade the rest.
		_, _ = s.db.Exec(`UPDATE groups SET kind = 'app' WHERE kind = 'system' AND id != ?`, systemID)

		// Move all widget apps into the system group.
		_, _ = s.db.Exec(
			`UPDATE apps
			 SET group_id = ?
			 WHERE url LIKE 'widget:%'
			   AND (group_id IS NULL OR group_id IN (SELECT id FROM groups WHERE kind != 'system'))`,
			systemID,
		)
	}
	return nil
}
