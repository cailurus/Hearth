package auth

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestNewService(t *testing.T) {
	db := newTestDB(t)
	setupSchema(t, db)

	svc, err := New(Config{DB: db, SessionTTL: "1h", InitialPassword: "admin"})
	if err != nil {
		t.Fatalf("New failed: %v", err)
	}
	if svc == nil {
		t.Fatal("service should not be nil")
	}
}

func TestDefaultAdmin(t *testing.T) {
	db := newTestDB(t)
	setupSchema(t, db)

	_, err := New(Config{DB: db, SessionTTL: "1h", InitialPassword: "admin"})
	if err != nil {
		t.Fatalf("New failed: %v", err)
	}

	var count int
	err = db.QueryRow("SELECT COUNT(1) FROM users WHERE username = 'admin'").Scan(&count)
	if err != nil {
		t.Fatalf("query failed: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 admin user, got %d", count)
	}
}

func TestLoginLogout(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.Login("admin", "wrong", "127.0.0.1")
	if err == nil {
		t.Error("login with wrong password should fail")
	}

	svc.clearLoginAttempts("admin")

	token, err := svc.Login("admin", "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}
	if token == "" {
		t.Error("token should not be empty")
	}

	userID, err := svc.Validate(token)
	if err != nil {
		t.Fatalf("validate failed: %v", err)
	}
	if userID == "" {
		t.Error("userID should not be empty")
	}

	err = svc.Logout(token)
	if err != nil {
		t.Fatalf("logout failed: %v", err)
	}

	_, err = svc.Validate(token)
	if err == nil {
		t.Error("token should be invalid after logout")
	}
}

func TestChangePassword(t *testing.T) {
	svc := newTestService(t)

	token, err := svc.Login("admin", "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}

	userID, err := svc.Validate(token)
	if err != nil {
		t.Fatalf("validate failed: %v", err)
	}

	err = svc.ChangePassword(userID, "admin", "newpassword")
	if err != nil {
		t.Fatalf("change password failed: %v", err)
	}

	svc.clearLoginAttempts("admin")

	_, err = svc.Login("admin", "admin", "127.0.0.1")
	if err == nil {
		t.Error("old password should not work")
	}

	svc.clearLoginAttempts("admin")

	_, err = svc.Login("admin", "newpassword", "127.0.0.1")
	if err != nil {
		t.Fatalf("login with new password failed: %v", err)
	}
}

// TestRateLimitPersistence verifies that rate limiting survives restarts
// because we now store attempt history in SQLite rather than in-memory.
func TestRateLimitPersistence(t *testing.T) {
	db := newTestDB(t)
	setupSchema(t, db)

	svc1, err := New(Config{DB: db, SessionTTL: "1h", InitialPassword: "admin"})
	if err != nil {
		t.Fatalf("New 1: %v", err)
	}

	// Burn the rate limit on svc1 (5 failed attempts).
	for i := 0; i < 5; i++ {
		if _, err := svc1.Login("admin", "wrong", "10.0.0.5"); err == nil {
			t.Fatalf("attempt %d: expected error", i)
		}
	}
	// 6th attempt — should be ErrTooManyAttempts even with the correct password.
	if _, err := svc1.Login("admin", "admin", "10.0.0.5"); err != ErrTooManyAttempts {
		t.Fatalf("expected ErrTooManyAttempts, got %v", err)
	}

	// Simulate a restart: brand-new Service against the same DB.
	svc1.Stop()
	svc2, err := New(Config{DB: db, SessionTTL: "1h", InitialPassword: "admin"})
	if err != nil {
		t.Fatalf("New 2: %v", err)
	}
	defer svc2.Stop()

	// The block must persist across the restart. Previously this was an
	// in-memory map and a restart trivially bypassed the limit.
	if _, err := svc2.Login("admin", "admin", "10.0.0.5"); err != ErrTooManyAttempts {
		t.Fatalf("after restart: expected ErrTooManyAttempts (persisted), got %v", err)
	}
}

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func setupSchema(t *testing.T, db *sql.DB) {
	t.Helper()
	stmts := []string{
		"CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
		"CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)",
		"CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, remote_ip TEXT NOT NULL DEFAULT '', attempt_at INTEGER NOT NULL, blocked_at INTEGER NOT NULL DEFAULT 0)",
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("failed to create schema: %v", err)
		}
	}
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	db := newTestDB(t)
	setupSchema(t, db)
	svc, err := New(Config{DB: db, SessionTTL: "1h", InitialPassword: "admin"})
	if err != nil {
		t.Fatalf("failed to create service: %v", err)
	}
	return svc
}
