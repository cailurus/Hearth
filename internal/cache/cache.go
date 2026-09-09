// Package cache provides bounded caches with coalesced background refresh.
package cache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type Entry[T any] struct {
	Value     T         `json:"value"`
	FetchedAt time.Time `json:"fetchedAt"`
}

type State struct {
	FetchedAt  time.Time
	Stale      bool
	Refreshing bool
	Err        error
}

type failure struct {
	err     error
	retryAt time.Time
}

const (
	maxEntries      = 256
	maxFlights      = 32
	maxSnapshotSize = 4 << 20
)

type Cache[T any] struct {
	mu          sync.Mutex
	items       map[string]Entry[T]
	flights     map[string]chan struct{}
	failures    map[string]failure
	ttl         time.Duration
	maxAge      time.Duration
	loadTimeout time.Duration
	directory   string
}

func New[T any](ttl time.Duration) *Cache[T] {
	return &Cache[T]{
		items:       make(map[string]Entry[T]),
		flights:     make(map[string]chan struct{}),
		failures:    make(map[string]failure),
		ttl:         ttl,
		maxAge:      max(4*ttl, 24*time.Hour),
		loadTimeout: 20 * time.Second,
	}
}

// SetMaxStale sets the maximum age since the last successful fetch, including TTL.
func (c *Cache[T]) SetMaxStale(age time.Duration) {
	if age <= 0 {
		panic("cache maximum age must be positive")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.maxAge = age
}

func (c *Cache[T]) SetLoadTimeout(timeout time.Duration) {
	if timeout <= 0 {
		panic("cache load timeout must be positive")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.loadTimeout = timeout
}

// SetPersistence must be called during startup, before the cache is used.
// Each cache/schema gets its own private directory; keys are never stored as filenames.
func (c *Cache[T]) SetPersistence(directory string) error {
	if directory == "" {
		return errors.New("cache directory is required")
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create cache directory: %w", err)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.flights) != 0 || (c.directory != "" && c.directory != directory) {
		return errors.New("cannot reconfigure an active persistent cache")
	}
	c.directory = directory
	return c.trimDiskLocked()
}

func (c *Cache[T]) Get(key string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entryLocked(key)
	if !ok || time.Since(entry.FetchedAt) >= c.ttl {
		var zero T
		return zero, false
	}
	return entry.Value, true
}

// GetStale returns a usable value even beyond TTL; bool reports existence, not freshness.
func (c *Cache[T]) GetStale(key string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entryLocked(key)
	if !ok {
		var zero T
		return zero, false
	}
	return entry.Value, true
}

func (c *Cache[T]) Set(key string, value T) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.putLocked(key, Entry[T]{Value: value, FetchedAt: time.Now()})
	delete(c.failures, key)
}

// Load returns valid stale data immediately while one refresh runs in the background.
// A forced refresh waits for that attempt, retaining old data with an explicit error.
// Only successful loads replace snapshots. Context cancellation stops a caller waiting,
// not another caller's shared refresh, which has its own bounded lifetime.
func (c *Cache[T]) Load(ctx context.Context, key string, loader func(context.Context) (T, error), force ...bool) (T, State, error) {
	if err := ctx.Err(); err != nil {
		var zero T
		return zero, State{Err: err}, err
	}
	forced := len(force) > 0 && force[0]
	c.mu.Lock()
	entry, usable := c.entryLocked(key)
	state := c.stateLocked(key, entry)
	if usable && !state.Stale && !forced {
		c.mu.Unlock()
		return entry.Value, state, nil
	}

	done, running := c.flights[key]
	if !running {
		if failed, ok := c.failures[key]; ok && time.Now().Before(failed.retryAt) && !forced {
			c.mu.Unlock()
			if usable {
				return entry.Value, state, nil
			}
			var zero T
			return zero, state, failed.err
		}
		if len(c.flights) >= maxFlights {
			state.Err = errors.New("too many simultaneous cache refreshes")
			c.mu.Unlock()
			if usable {
				return entry.Value, state, nil
			}
			var zero T
			return zero, state, state.Err
		}
		done = make(chan struct{})
		c.flights[key] = done
		timeout := c.loadTimeout
		go c.refresh(context.WithoutCancel(ctx), key, done, timeout, loader)
	}
	if usable && !forced {
		state.Refreshing = true
		c.mu.Unlock()
		return entry.Value, state, nil
	}
	c.mu.Unlock()

	select {
	case <-done:
		c.mu.Lock()
		entry, usable = c.entryLocked(key)
		state = c.stateLocked(key, entry)
		c.mu.Unlock()
		if usable {
			return entry.Value, state, nil
		}
		if state.Err == nil {
			state.Err = errors.New("cache refresh produced no usable data")
		}
		var zero T
		return zero, state, state.Err
	case <-ctx.Done():
		c.mu.Lock()
		entry, usable = c.entryLocked(key)
		state = c.stateLocked(key, entry)
		c.mu.Unlock()
		state.Err = ctx.Err()
		if usable {
			return entry.Value, state, nil
		}
		var zero T
		return zero, state, ctx.Err()
	}
}

func (c *Cache[T]) refresh(ctx context.Context, key string, done chan struct{}, timeout time.Duration, loader func(context.Context) (T, error)) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	value, err := loader(ctx)
	if err == nil {
		err = ctx.Err()
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		c.failures[key] = failure{err: err, retryAt: time.Now().Add(30 * time.Second)}
		slog.Warn("widget cache refresh failed", "cacheKey", snapshotName(key), "error", err)
		if len(c.failures) > maxEntries {
			for k, f := range c.failures {
				if k != key && time.Now().After(f.retryAt) {
					delete(c.failures, k)
				}
			}
			if len(c.failures) > maxEntries {
				for k := range c.failures {
					if k != key {
						delete(c.failures, k)
						break
					}
				}
			}
		}
	} else {
		c.putLocked(key, Entry[T]{Value: value, FetchedAt: time.Now()})
		delete(c.failures, key)
	}
	delete(c.flights, key)
	close(done)
}

func (c *Cache[T]) stateLocked(key string, entry Entry[T]) State {
	return State{
		FetchedAt:  entry.FetchedAt,
		Stale:      !entry.FetchedAt.IsZero() && time.Since(entry.FetchedAt) >= c.ttl,
		Refreshing: c.flights[key] != nil,
		Err:        c.failures[key].err,
	}
}

func snapshotName(key string) string {
	hash := sha256.Sum256([]byte(key))
	return hex.EncodeToString(hash[:]) + ".json"
}

func (c *Cache[T]) entryLocked(key string) (Entry[T], bool) {
	entry, ok := c.items[key]
	if !ok && c.directory != "" {
		path := filepath.Join(c.directory, snapshotName(key))
		file, err := os.Open(path)
		if err == nil {
			decoder := json.NewDecoder(io.LimitReader(file, maxSnapshotSize+1))
			info, statErr := file.Stat()
			if statErr != nil {
				err = statErr
			} else if info.Size() > maxSnapshotSize {
				err = errors.New("widget cache snapshot exceeds size limit")
			} else {
				err = decoder.Decode(&entry)
				if err == nil {
					var extra any
					if trailing := decoder.Decode(&extra); !errors.Is(trailing, io.EOF) {
						err = errors.New("widget cache snapshot contains trailing data")
					}
				}
			}
			closeErr := file.Close()
			if err == nil {
				err = closeErr
			}
			if err != nil {
				slog.Warn("invalid widget cache snapshot", "path", path, "error", err)
			} else {
				ok = true
				c.items[key] = entry
				c.trimMemoryLocked(key)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			slog.Warn("cannot read widget cache snapshot", "path", path, "error", err)
		}
	}
	if !ok || entry.FetchedAt.IsZero() || entry.FetchedAt.After(time.Now().Add(time.Minute)) || time.Since(entry.FetchedAt) > c.maxAge {
		return Entry[T]{}, false
	}
	return entry, true
}

func (c *Cache[T]) putLocked(key string, entry Entry[T]) {
	c.items[key] = entry
	c.trimMemoryLocked(key)
	if c.directory == "" {
		return
	}
	if err := c.persistLocked(key, entry); err != nil {
		slog.Warn("cannot persist widget cache snapshot", "path", c.directory, "error", err)
	}
}

func (c *Cache[T]) trimMemoryLocked(keep string) {
	if len(c.items) <= maxEntries {
		return
	}
	oldestKey := ""
	var oldest time.Time
	for key, entry := range c.items {
		if key != keep && (oldest.IsZero() || entry.FetchedAt.Before(oldest)) {
			oldestKey, oldest = key, entry.FetchedAt
		}
	}
	delete(c.items, oldestKey)
}

func (c *Cache[T]) persistLocked(key string, entry Entry[T]) error {
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	if len(data) > maxSnapshotSize {
		return errors.New("widget cache snapshot exceeds size limit")
	}
	file, err := os.CreateTemp(c.directory, ".snapshot-*")
	if err != nil {
		return err
	}
	name := file.Name()
	defer func() {
		if err := os.Remove(name); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("cannot remove cache temporary file", "path", name, "error", err)
		}
	}()
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, filepath.Join(c.directory, snapshotName(key))); err != nil {
		return err
	}
	return c.trimDiskLocked()
}

func (c *Cache[T]) trimDiskLocked() error {
	files, err := os.ReadDir(c.directory)
	if err != nil {
		return err
	}
	var snapshots []os.FileInfo
	for _, file := range files {
		if file.IsDir() || len(file.Name()) != 69 || filepath.Ext(file.Name()) != ".json" {
			continue
		}
		if _, err := hex.DecodeString(file.Name()[:64]); err != nil {
			continue
		}
		info, err := file.Info()
		if err != nil {
			return err
		}
		snapshots = append(snapshots, info)
	}
	sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].ModTime().Before(snapshots[j].ModTime()) })
	for len(snapshots) > maxEntries {
		if err := os.Remove(filepath.Join(c.directory, snapshots[0].Name())); err != nil {
			return err
		}
		snapshots = snapshots[1:]
	}
	return nil
}
