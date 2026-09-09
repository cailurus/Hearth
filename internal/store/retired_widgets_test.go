package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

const retiredWidgetURL = "widget:deals"

func retiredWidgetURLs() []string {
	var urls []string
	for _, suffix := range []string{"", "?", "#", "?region=us", "#legacy", "?region=cn#legacy", "#legacy?region=jp"} {
		urls = append(urls, retiredWidgetURL+suffix)
	}
	return urls
}

func retainedWidgetFixture(t *testing.T, s *Store) Export {
	t.Helper()
	groups, err := s.ListGroups()
	if err != nil {
		t.Fatal(err)
	}
	systemID := groups[0].ID
	serviceGroup, err := s.CreateGroup("My services", "app")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateGroup("Empty favorites", "bookmark"); err != nil {
		t.Fatal(err)
	}
	description, iconPath, iconSource := `{"custom":"keep"}`, "custom.svg", "url"
	urls := []string{
		"https://example.com/" + retiredWidgetURL,
		"https://example.com/?next=" + retiredWidgetURL,
		"widget:weather?city=Shanghai#forecast", "widget:metrics", "widget:timezones",
		"widget:markets", "widget:holidays", "widget:docker", "widget:notes",
		"widget:rss", "widget:currency", "widget:custom",
		retiredWidgetURL + "-custom", retiredWidgetURL + "/custom",
		retiredWidgetURL + " ", strings.ToUpper(retiredWidgetURL), " " + retiredWidgetURL,
	}
	for i, url := range urls {
		groupID := systemID
		if strings.HasPrefix(url, "https:") {
			groupID = serviceGroup.ID
		}
		app, err := s.CreateApp(&groupID, fmt.Sprintf("Retained %d", i), &description, url, &iconPath, &iconSource)
		if err != nil {
			t.Fatalf("create %q: %v", url, err)
		}
		if err := s.UpdateApp(app.ID, app.GroupID, app.Name, app.Description, app.URL, app.IconPath, app.IconSource); err != nil {
			t.Fatalf("update %q: %v", url, err)
		}
	}
	if _, err := s.CreateNote("Private note", "Keep the original text"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetKV("siteTitle", "My dashboard"); err != nil {
		t.Fatal(err)
	}
	payload, err := s.ExportAll()
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func assertRetainedData(t *testing.T, s *Store, want Export) {
	t.Helper()
	got, err := s.ExportAll()
	if err != nil {
		t.Fatal(err)
	}
	got.Exported = want.Exported
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("retained data changed:\ngot: %#v\nwant: %#v", got, want)
	}
}

func TestRetiredWidgetMigration(t *testing.T) {
	s := newTestStore(t)
	s.db.SetMaxOpenConns(1)
	want := retainedWidgetFixture(t, s)
	for i, url := range retiredWidgetURLs() {
		var groupID *string
		if i%2 == 0 {
			groupID = &want.Groups[i%len(want.Groups)].ID
		}
		// Seed rows directly to model an installation predating write validation.
		_, err := s.db.Exec(`INSERT INTO apps (id, group_id, name, url, created_at) VALUES (?, ?, ?, ?, ?)`,
			fmt.Sprintf("legacy-%d", i), groupID, "Legacy widget", url, 1)
		if err != nil {
			t.Fatal(err)
		}
	}

	for i := 0; i < 2; i++ {
		if err := New(s.db).Migrate(); err != nil {
			t.Fatalf("migration %d: %v", i, err)
		}
		assertRetainedData(t, s, want)
	}
}

func TestRetiredWidgetImport(t *testing.T) {
	for _, version := range []int{1, 2} {
		t.Run(fmt.Sprintf("version-%d", version), func(t *testing.T) {
			s := newTestStore(t)
			s.db.SetMaxOpenConns(1)
			want := retainedWidgetFixture(t, s)
			payload := want
			payload.Version = version
			payload.Apps = append([]AppItem(nil), want.Apps...)
			for i, url := range retiredWidgetURLs() {
				payload.Apps = append(payload.Apps, AppItem{
					ID: fmt.Sprintf("legacy-%d", i), Name: "Legacy widget", URL: url,
					GroupID: &want.Groups[i%len(want.Groups)].ID, CreatedAt: 1,
				})
			}
			// A stale backup must not delete a live link or widget that reused its ID.
			for _, app := range want.Apps {
				payload.Apps = append(payload.Apps, AppItem{
					ID: app.ID, Name: "Legacy widget", URL: retiredWidgetURL,
				})
			}
			// Keep a local-only entry, and restore all other retained entries via import.
			local := want.Apps[0]
			if _, err := s.db.Exec(`DELETE FROM apps WHERE id != ?`, local.ID); err != nil {
				t.Fatal(err)
			}
			payload.Apps = payload.Apps[1:]
			b, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			_, err = s.db.Exec(`INSERT INTO apps (id, name, url, created_at) VALUES (?, ?, ?, ?)`,
				"existing-legacy", "Legacy widget", retiredWidgetURL, 1)
			if err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				if err := s.ImportJSON(b); err != nil {
					t.Fatalf("import %d: %v", i, err)
				}
				assertRetainedData(t, s, want)
			}
		})
	}
}

func TestRetiredWidgetWrites(t *testing.T) {
	s := newTestStore(t)
	want := retainedWidgetFixture(t, s)
	app := want.Apps[0]
	for _, url := range retiredWidgetURLs() {
		t.Run(url, func(t *testing.T) {
			_, err := s.CreateApp(app.GroupID, "Legacy widget", nil, url, nil, nil)
			if !errors.Is(err, ErrRetiredWidget) {
				t.Fatalf("create %q: got %v, want ErrRetiredWidget", url, err)
			}
			err = s.UpdateApp(app.ID, app.GroupID, "Legacy widget", nil, url, nil, nil)
			if !errors.Is(err, ErrRetiredWidget) {
				t.Fatalf("update %q: got %v, want ErrRetiredWidget", url, err)
			}
			assertRetainedData(t, s, want)
		})
	}
}
