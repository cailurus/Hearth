package store

import (
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

func (s *Store) ListApps() ([]AppItem, error) {
	rows, err := s.db.Query(`SELECT id, group_id, name, description, url, icon_path, icon_source, sort_order, created_at FROM apps ORDER BY group_id ASC, sort_order ASC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]AppItem, 0)
	for rows.Next() {
		var a AppItem
		if err := rows.Scan(&a.ID, &a.GroupID, &a.Name, &a.Description, &a.URL, &a.IconPath, &a.IconSource, &a.SortOrder, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) CreateApp(groupID *string, name string, description *string, url string, iconPath, iconSource *string) (AppItem, error) {
	now := time.Now().Unix()
	id := uuid.NewString()

	var nextOrder int
	_ = s.db.QueryRow(`SELECT COALESCE(MAX(sort_order), 0) + 1 FROM apps WHERE group_id IS ?`, groupID).Scan(&nextOrder)

	_, err := s.db.Exec(`INSERT INTO apps (id, group_id, name, description, url, icon_path, icon_source, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, groupID, name, description, url, iconPath, iconSource, nextOrder, now,
	)
	if err != nil {
		return AppItem{}, err
	}
	return AppItem{ID: id, GroupID: groupID, Name: name, Description: description, URL: url, IconPath: iconPath, IconSource: iconSource, SortOrder: nextOrder, CreatedAt: now}, nil
}

func (s *Store) UpdateApp(id string, groupID *string, name string, description *string, url string, iconPath, iconSource *string) error {
	res, err := s.db.Exec(`UPDATE apps SET group_id = ?, name = ?, description = ?, url = ?, icon_path = ?, icon_source = ? WHERE id = ?`, groupID, name, description, url, iconPath, iconSource, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("not found")
	}
	return nil
}

func (s *Store) DeleteApp(id string) error {
	_, err := s.db.Exec(`DELETE FROM apps WHERE id = ?`, id)
	return err
}

func (s *Store) ReorderApps(groupID *string, ids []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`UPDATE apps SET sort_order = ? WHERE id = ? AND group_id IS ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for i, id := range ids {
		if _, err := stmt.Exec(i+1, id, groupID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) MoveGroupAppsToUngrouped(groupID string) error {
	_, err := s.db.Exec(`UPDATE apps SET group_id = NULL WHERE group_id = ?`, groupID)
	return err
}

func (s *Store) AppByID(id string) (AppItem, bool, error) {
	var a AppItem
	err := s.db.QueryRow(`SELECT id, group_id, name, description, url, icon_path, icon_source, sort_order, created_at FROM apps WHERE id = ?`, id).
		Scan(&a.ID, &a.GroupID, &a.Name, &a.Description, &a.URL, &a.IconPath, &a.IconSource, &a.SortOrder, &a.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AppItem{}, false, nil
		}
		return AppItem{}, false, err
	}
	return a, true, nil
}
