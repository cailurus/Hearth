package store

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	db := newTestDB(t)
	s := New(db)
	if err := s.Migrate(); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}
	return s
}

func TestStoreMigrate(t *testing.T) {
	db := newTestDB(t)
	s := New(db)

	if err := s.Migrate(); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}

	// Run again to ensure idempotency
	if err := s.Migrate(); err != nil {
		t.Fatalf("Second Migrate failed: %v", err)
	}
}

func TestGroupsCRUD(t *testing.T) {
	s := newTestStore(t)

	// List should be empty (except system group created by Migrate)
	groups, err := s.ListGroups()
	if err != nil {
		t.Fatalf("ListGroups failed: %v", err)
	}
	initialCount := len(groups)

	// Create a group
	g, err := s.CreateGroup("Test Group", "app")
	if err != nil {
		t.Fatalf("CreateGroup failed: %v", err)
	}
	if g.Name != "Test Group" {
		t.Errorf("expected name 'Test Group', got '%s'", g.Name)
	}
	if g.Kind != "app" {
		t.Errorf("expected kind 'app', got '%s'", g.Kind)
	}
	if g.ID == "" {
		t.Error("expected non-empty ID")
	}

	// List should have one more group
	groups, err = s.ListGroups()
	if err != nil {
		t.Fatalf("ListGroups failed: %v", err)
	}
	if len(groups) != initialCount+1 {
		t.Errorf("expected %d groups, got %d", initialCount+1, len(groups))
	}

	// Check group exists
	exists, err := s.GroupExists(g.ID)
	if err != nil {
		t.Fatalf("GroupExists failed: %v", err)
	}
	if !exists {
		t.Error("expected group to exist")
	}

	// Get kind by ID
	kind, found, err := s.GroupKindByID(g.ID)
	if err != nil {
		t.Fatalf("GroupKindByID failed: %v", err)
	}
	if !found {
		t.Error("expected group to be found")
	}
	if kind != "app" {
		t.Errorf("expected kind 'app', got '%s'", kind)
	}

	// Update
	if err := s.UpdateGroup(g.ID, "Updated Group"); err != nil {
		t.Fatalf("UpdateGroup failed: %v", err)
	}
	// Verify update by listing groups
	groups, _ = s.ListGroups()
	var found2 bool
	for _, grp := range groups {
		if grp.ID == g.ID && grp.Name == "Updated Group" {
			found2 = true
			break
		}
	}
	if !found2 {
		t.Error("expected to find updated group")
	}

	// Delete
	if err := s.DeleteGroup(g.ID); err != nil {
		t.Fatalf("DeleteGroup failed: %v", err)
	}
	groups, _ = s.ListGroups()
	if len(groups) != initialCount {
		t.Errorf("expected %d groups after delete, got %d", initialCount, len(groups))
	}
}

func TestAppsCRUD(t *testing.T) {
	s := newTestStore(t)

	// Create a group first
	g, err := s.CreateGroup("Apps Group", "app")
	if err != nil {
		t.Fatalf("CreateGroup failed: %v", err)
	}

	// List apps (should be empty)
	apps, err := s.ListApps()
	if err != nil {
		t.Fatalf("ListApps failed: %v", err)
	}
	initialCount := len(apps)

	// Create an app
	groupID := g.ID
	created, err := s.CreateApp(&groupID, "Test App", nil, "https://example.com", nil, nil)
	if err != nil {
		t.Fatalf("CreateApp failed: %v", err)
	}
	if created.ID == "" {
		t.Error("expected non-empty ID")
	}
	if created.Name != "Test App" {
		t.Errorf("expected name 'Test App', got '%s'", created.Name)
	}

	// List apps
	apps, err = s.ListApps()
	if err != nil {
		t.Fatalf("ListApps failed: %v", err)
	}
	if len(apps) != initialCount+1 {
		t.Errorf("expected %d apps, got %d", initialCount+1, len(apps))
	}

	// Update app
	err = s.UpdateApp(created.ID, &groupID, "Updated App", nil, "https://example.com", nil, nil)
	if err != nil {
		t.Fatalf("UpdateApp failed: %v", err)
	}
	app, found, err := s.AppByID(created.ID)
	if err != nil {
		t.Fatalf("AppByID failed: %v", err)
	}
	if !found {
		t.Error("expected app to be found")
	}
	if app.Name != "Updated App" {
		t.Errorf("expected name 'Updated App', got '%s'", app.Name)
	}

	// Delete app
	if err := s.DeleteApp(created.ID); err != nil {
		t.Fatalf("DeleteApp failed: %v", err)
	}
	apps, _ = s.ListApps()
	if len(apps) != initialCount {
		t.Errorf("expected %d apps after delete, got %d", initialCount, len(apps))
	}
}

func TestKVOperations(t *testing.T) {
	s := newTestStore(t)

	// Get non-existent key
	val, found, err := s.GetKV("test_key")
	if err != nil {
		t.Fatalf("GetKV failed: %v", err)
	}
	if found {
		t.Errorf("expected key not found, but got found=true with value '%s'", val)
	}

	// Set key
	if err := s.SetKV("test_key", "test_value"); err != nil {
		t.Fatalf("SetKV failed: %v", err)
	}

	// Get key
	val, found, err = s.GetKV("test_key")
	if err != nil {
		t.Fatalf("GetKV failed: %v", err)
	}
	if !found {
		t.Error("expected key to be found")
	}
	if val != "test_value" {
		t.Errorf("expected 'test_value', got '%s'", val)
	}

	// Update key
	if err := s.SetKV("test_key", "updated_value"); err != nil {
		t.Fatalf("SetKV update failed: %v", err)
	}
	val, _, _ = s.GetKV("test_key")
	if val != "updated_value" {
		t.Errorf("expected 'updated_value', got '%s'", val)
	}
}
