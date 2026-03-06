package store

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

type Note struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	SortOrder int    `json:"sortOrder"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

func (s *Store) ListNotes() ([]Note, error) {
	rows, err := s.db.Query(`SELECT id, title, content, sort_order, created_at, updated_at FROM notes ORDER BY sort_order ASC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []Note
	for rows.Next() {
		var n Note
		if err := rows.Scan(&n.ID, &n.Title, &n.Content, &n.SortOrder, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		notes = append(notes, n)
	}
	if notes == nil {
		notes = []Note{}
	}
	return notes, rows.Err()
}

func (s *Store) CreateNote(title, content string) (Note, error) {
	if title == "" {
		return Note{}, errors.New("title required")
	}

	var maxOrder int
	_ = s.db.QueryRow(`SELECT COALESCE(MAX(sort_order), 0) FROM notes`).Scan(&maxOrder)

	now := time.Now().Unix()
	n := Note{
		ID:        uuid.NewString(),
		Title:     title,
		Content:   content,
		SortOrder: maxOrder + 1,
		CreatedAt: now,
		UpdatedAt: now,
	}

	_, err := s.db.Exec(
		`INSERT INTO notes (id, title, content, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
		n.ID, n.Title, n.Content, n.SortOrder, n.CreatedAt, n.UpdatedAt,
	)
	if err != nil {
		return Note{}, err
	}
	return n, nil
}

func (s *Store) UpdateNote(id, title, content string) error {
	if title == "" {
		return errors.New("title required")
	}
	now := time.Now().Unix()
	result, err := s.db.Exec(
		`UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?`,
		title, content, now, id,
	)
	if err != nil {
		return err
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return errors.New("note not found")
	}
	return nil
}

func (s *Store) DeleteNote(id string) error {
	_, err := s.db.Exec(`DELETE FROM notes WHERE id = ?`, id)
	return err
}
