package store

import (
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

func (s *Store) ListGroups() ([]Group, error) {
	rows, err := s.db.Query(`SELECT id, name, kind, sort_order, created_at FROM groups ORDER BY sort_order ASC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Group, 0)
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.ID, &g.Name, &g.Kind, &g.SortOrder, &g.CreatedAt); err != nil {
			return nil, err
		}
		if g.Kind == "" {
			g.Kind = "app"
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (s *Store) CreateGroup(name string, kind string) (Group, error) {
	now := time.Now().Unix()
	id := uuid.NewString()
	if kind == "" {
		kind = "app"
	}

	var nextOrder int
	_ = s.db.QueryRow(`SELECT COALESCE(MAX(sort_order), 0) + 1 FROM groups`).Scan(&nextOrder)

	_, err := s.db.Exec(`INSERT INTO groups (id, name, kind, sort_order, created_at) VALUES (?, ?, ?, ?, ?)`, id, name, kind, nextOrder, now)
	if err != nil {
		return Group{}, err
	}
	return Group{ID: id, Name: name, Kind: kind, SortOrder: nextOrder, CreatedAt: now}, nil
}

func (s *Store) HasSystemGroup() (bool, error) {
	var v int
	err := s.db.QueryRow(`SELECT 1 FROM groups WHERE kind = 'system' LIMIT 1`).Scan(&v)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (s *Store) GroupKindByID(id string) (string, bool, error) {
	var kind string
	err := s.db.QueryRow(`SELECT kind FROM groups WHERE id = ?`, id).Scan(&kind)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	if kind == "" {
		kind = "app"
	}
	return kind, true, nil
}

func (s *Store) UpdateGroup(id, name string) error {
	res, err := s.db.Exec(`UPDATE groups SET name = ? WHERE id = ?`, name, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("not found")
	}
	return nil
}

func (s *Store) DeleteGroup(id string) error {
	_, err := s.db.Exec(`DELETE FROM groups WHERE id = ?`, id)
	return err
}

func (s *Store) ReorderGroups(ids []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`UPDATE groups SET sort_order = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for i, id := range ids {
		if _, err := stmt.Exec(i+1, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) GroupExists(id string) (bool, error) {
	var v int
	err := s.db.QueryRow(`SELECT 1 FROM groups WHERE id = ? LIMIT 1`, id).Scan(&v)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
