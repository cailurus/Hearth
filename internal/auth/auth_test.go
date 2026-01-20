package auth

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestNewService(t *testing.T) {
	db := newTestDB(t)
	setupSchema(t, db)

	svc, err := New(Config{DB: db, SessionTTL: "1h"})
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

	_, err := New(Config{DB: db, SessionTTL: "1h"})
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

	_, err := svc.Login("admin", "wrong")
	if err == nil {
		t.Error("login with wrong password should fail")
	}

	svc.clearLoginAttempts("admin")

	token, err := svc.Login("admin", "admin")
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

	token, err := svc.Login("admin", "admin")
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

	_, err = svc.Login("admin", "admin")
	if err == nil {
		t.Error("old password should not work")
	}

	svc.clearLoginAttempts("admin")

	_, err = svc.Login("admin", "newpassword")
	if err != nil {
		t.Fatalf("login with new password failed: %v", err)
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
		"CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)",
		"CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)",
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
	svc, err := New(Config{DB: db, SessionTTL: "1h"})
	if err != nil {
		t.Fatalf("failed to create service: %v", err)
	}
	return svc
}
