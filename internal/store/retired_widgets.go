package store

import (
	"database/sql"
	"errors"
	"strings"
)

var ErrRetiredWidget = errors.New("widget is no longer supported")

func isRetiredWidgetURL(raw string) bool {
	// Match widgetKindFromUrl: only query/fragment suffixes are ignored.
	// Do not broaden this to unknown widget kinds or ordinary service URLs.
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	return raw == "widget:deals"
}

func removeRetiredWidgetApps(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT id, url FROM apps`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id, url string
		if err := rows.Scan(&id, &url); err != nil {
			return err
		}
		if isRetiredWidgetURL(url) {
			ids = append(ids, id)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	for _, id := range ids {
		if _, err := tx.Exec(`DELETE FROM apps WHERE id = ?`, id); err != nil {
			return err
		}
	}
	return nil
}
