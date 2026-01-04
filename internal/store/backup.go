package store

import (
	"database/sql"
	"encoding/json"
	"time"
)

type Export struct {
	Version  int               `json:"version"`
	Exported int64             `json:"exportedAt"`
	Settings map[string]string `json:"settings"`
	Groups   []Group           `json:"groups"`
	Apps     []AppItem         `json:"apps"`
}

func (s *Store) ExportAll() (Export, error) {
	settings := map[string]string{}
	rows, err := s.db.Query(`SELECT key, value FROM kv`)
	if err != nil {
		return Export{}, err
	}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			_ = rows.Close()
			return Export{}, err
		}
		settings[k] = v
	}
	_ = rows.Close()

	groups, err := s.ListGroups()
	if err != nil {
		return Export{}, err
	}
	apps, err := s.ListApps()
	if err != nil {
		return Export{}, err
	}

	return Export{
		Version:  2,
		Exported: time.Now().Unix(),
		Settings: settings,
		Groups:   groups,
		Apps:     apps,
	}, nil
}

func (s *Store) ImportAll(payload Export) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Settings
	for k, v := range payload.Settings {
		if _, err := tx.Exec(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, v); err != nil {
			return err
		}
	}

	// Groups
	for _, g := range payload.Groups {
		kind := g.Kind
		if kind == "" {
			kind = "app"
		}
		_, err := tx.Exec(`INSERT INTO groups (id, name, kind, sort_order, created_at) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, sort_order=excluded.sort_order`, g.ID, g.Name, kind, g.SortOrder, g.CreatedAt)
		if err != nil {
			return err
		}
	}

	// Apps
	for _, a := range payload.Apps {
		_, err := tx.Exec(`INSERT INTO apps (id, group_id, name, description, url, icon_path, icon_source, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id, name=excluded.name, description=excluded.description, url=excluded.url, icon_path=excluded.icon_path, icon_source=excluded.icon_source, sort_order=excluded.sort_order`,
			a.ID, a.GroupID, a.Name, a.Description, a.URL, a.IconPath, a.IconSource, a.SortOrder, a.CreatedAt)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) ExportJSON() ([]byte, error) {
	p, err := s.ExportAll()
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(p, "", "  ")
}

func (s *Store) ImportJSON(b []byte) error {
	var p Export
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	return s.ImportAll(p)
}

var _ = sql.ErrNoRows
