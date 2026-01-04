package store

import (
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// ResetAll clears all persisted configuration and cached data.
// It also resets authentication back to the default admin/admin.
func (s *Store) ResetAll() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Order matters for FKs.
	stmts := []string{
		`DELETE FROM sessions;`,
		`DELETE FROM users;`,
		`DELETE FROM apps;`,
		`DELETE FROM groups;`,
		`DELETE FROM kv;`,
		`DELETE FROM icon_cache;`,
		`DELETE FROM background_cache;`,
	}
	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			return err
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	if _, err := tx.Exec(
		`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`,
		uuid.NewString(), "admin", string(hash), now,
	); err != nil {
		return err
	}

	return tx.Commit()
}
