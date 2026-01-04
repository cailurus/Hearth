package store

import (
	"database/sql"
	"errors"
	"time"
)

type IconCacheEntry struct {
	CacheKey   string
	IconPath   string
	IconSource string
	UpdatedAt  int64
}

func (s *Store) GetIconCache(cacheKey string) (IconCacheEntry, bool, error) {
	var e IconCacheEntry
	err := s.db.QueryRow(`SELECT cache_key, icon_path, icon_source, updated_at FROM icon_cache WHERE cache_key = ?`, cacheKey).
		Scan(&e.CacheKey, &e.IconPath, &e.IconSource, &e.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return IconCacheEntry{}, false, nil
		}
		return IconCacheEntry{}, false, err
	}
	return e, true, nil
}

func (s *Store) SetIconCache(cacheKey, iconPath, iconSource string) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`INSERT INTO icon_cache (cache_key, icon_path, icon_source, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(cache_key) DO UPDATE SET icon_path=excluded.icon_path, icon_source=excluded.icon_source, updated_at=excluded.updated_at`,
		cacheKey, iconPath, iconSource, now,
	)
	return err
}
