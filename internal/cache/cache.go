// Package cache provides a generic in-memory TTL cache.
package cache

import (
	"sync"
	"time"
)

// Entry holds a cached value with its fetch timestamp.
type Entry[T any] struct {
	Value     T
	FetchedAt time.Time
}

// Cache is a generic thread-safe TTL cache keyed by string.
type Cache[T any] struct {
	mu    sync.Mutex
	items map[string]Entry[T]
	ttl   time.Duration
}

// New creates a cache with the given TTL.
func New[T any](ttl time.Duration) *Cache[T] {
	return &Cache[T]{
		items: make(map[string]Entry[T]),
		ttl:   ttl,
	}
}

// Get returns a cached value if it exists and hasn't expired.
func (c *Cache[T]) Get(key string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.items[key]
	if !ok {
		var zero T
		return zero, false
	}
	if time.Since(entry.FetchedAt) >= c.ttl {
		var zero T
		return zero, false
	}
	return entry.Value, true
}

// GetStale returns a cached value even if expired, plus a bool indicating freshness.
func (c *Cache[T]) GetStale(key string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.items[key]
	if !ok {
		var zero T
		return zero, false
	}
	return entry.Value, true
}

// Set stores a value in the cache.
func (c *Cache[T]) Set(key string, value T) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[key] = Entry[T]{Value: value, FetchedAt: time.Now()}
}
