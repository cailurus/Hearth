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
