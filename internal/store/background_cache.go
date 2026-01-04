package store

import (
	"database/sql"
	"errors"
	"time"
)

type BackgroundCacheEntry struct {
	CacheKey  string
	FilePath  string
	FetchedAt int64
}

func (s *Store) GetBackgroundCache(cacheKey string) (BackgroundCacheEntry, bool, error) {
	var e BackgroundCacheEntry
	err := s.db.QueryRow(`SELECT cache_key, file_path, fetched_at FROM background_cache WHERE cache_key = ?`, cacheKey).
		Scan(&e.CacheKey, &e.FilePath, &e.FetchedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return BackgroundCacheEntry{}, false, nil
		}
		return BackgroundCacheEntry{}, false, err
	}
	return e, true, nil
}

func (s *Store) SetBackgroundCache(cacheKey, filePath string) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`INSERT INTO background_cache (cache_key, file_path, fetched_at) VALUES (?, ?, ?)
		ON CONFLICT(cache_key) DO UPDATE SET file_path=excluded.file_path, fetched_at=excluded.fetched_at`,
		cacheKey, filePath, now,
	)
	return err
}

func (s *Store) DeleteBackgroundCache(cacheKey string) error {
	_, err := s.db.Exec(`DELETE FROM background_cache WHERE cache_key = ?`, cacheKey)
	return err
}
