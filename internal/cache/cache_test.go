package cache

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLoadCoalescesColdRequests(t *testing.T) {
	c := New[int](time.Minute)
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	loader := func(context.Context) (int, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return 42, nil
	}
	var wg sync.WaitGroup
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			value, state, err := c.Load(context.Background(), "key", loader)
			if err != nil || value != 42 || state.FetchedAt.IsZero() {
				t.Errorf("value=%d state=%+v err=%v", value, state, err)
			}
		}()
	}
	<-started
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("got %d upstream calls", calls.Load())
	}
}

func TestStaleLoadDoesNotWaitAndKeepsLastGoodValue(t *testing.T) {
	c := New[int](time.Minute)
	fetchedAt := time.Now().Add(-2 * time.Minute)
	c.items["key"] = Entry[int]{Value: 42, FetchedAt: fetchedAt}
	release := make(chan struct{})
	upstreamErr := errors.New("upstream offline")
	loader := func(context.Context) (int, error) {
		<-release
		return 0, upstreamErr
	}
	start := time.Now()
	value, state, err := c.Load(context.Background(), "key", loader)
	if time.Since(start) > 200*time.Millisecond {
		t.Fatal("stale cache waited for upstream")
	}
	if err != nil || value != 42 || !state.Stale || !state.Refreshing {
		t.Fatalf("value=%d state=%+v err=%v", value, state, err)
	}
	c.mu.Lock()
	done := c.flights["key"]
	c.mu.Unlock()
	close(release)
	<-done

	value, state, err = c.Load(context.Background(), "key", loader)
	if err != nil || value != 42 || !errors.Is(state.Err, upstreamErr) || state.Refreshing {
		t.Fatalf("failed refresh discarded data or error: value=%d state=%+v err=%v", value, state, err)
	}
	if !state.FetchedAt.Equal(fetchedAt) {
		t.Fatal("failed refresh changed last-good timestamp")
	}
}

func TestColdFailureIsNotCachedAsSuccessAndForceRetries(t *testing.T) {
	c := New[int](time.Minute)
	offline := errors.New("offline")
	var calls int
	loader := func(context.Context) (int, error) {
		calls++
		return 0, offline
	}
	for range 2 {
		_, state, err := c.Load(context.Background(), "key", loader)
		if !errors.Is(err, offline) || !errors.Is(state.Err, offline) {
			t.Fatalf("failure was hidden: state=%+v err=%v", state, err)
		}
	}
	if calls != 1 {
		t.Fatalf("failed source hammered during backoff: %d calls", calls)
	}
	if _, ok := c.GetStale("key"); ok {
		t.Fatal("failed value was cached")
	}
	value, state, err := c.Load(context.Background(), "key", func(context.Context) (int, error) {
		return 7, nil
	}, true)
	if err != nil || value != 7 || state.Err != nil {
		t.Fatalf("force retry failed: value=%d state=%+v err=%v", value, state, err)
	}
}

func TestForceRefreshReportsFailureAlongsideUsableData(t *testing.T) {
	c := New[int](time.Hour)
	c.Set("key", 42)
	failure := errors.New("refresh failed")
	value, state, err := c.Load(context.Background(), "key", func(context.Context) (int, error) {
		return 0, failure
	}, true)
	if err != nil || value != 42 || !errors.Is(state.Err, failure) {
		t.Fatalf("value=%d state=%+v err=%v", value, state, err)
	}
}

func TestMaximumAgeAndLoaderDeadline(t *testing.T) {
	c := New[int](time.Minute)
	c.SetMaxStale(3 * time.Minute)
	c.SetLoadTimeout(20 * time.Millisecond)
	c.items["old"] = Entry[int]{Value: 42, FetchedAt: time.Now().Add(-4 * time.Minute)}
	value, _, err := c.Load(context.Background(), "old", func(ctx context.Context) (int, error) {
		<-ctx.Done()
		return 0, ctx.Err()
	})
	if !errors.Is(err, context.DeadlineExceeded) || value != 0 {
		t.Fatalf("expired value served or timeout hidden: value=%d err=%v", value, err)
	}
}

func TestRefreshCapacityIsBounded(t *testing.T) {
	c := New[int](time.Minute)
	for i := range maxFlights {
		c.flights[fmt.Sprint(i)] = make(chan struct{})
	}
	loader := func(context.Context) (int, error) {
		t.Error("refresh started beyond capacity")
		return 42, nil
	}
	if _, _, err := c.Load(context.Background(), "missing", loader); err == nil {
		t.Fatal("capacity limit did not surface an error")
	}
	c.items["stale"] = Entry[int]{Value: 42, FetchedAt: time.Now().Add(-2 * time.Minute)}
	value, state, err := c.Load(context.Background(), "stale", loader)
	if err != nil || value != 42 || state.Err == nil || !state.Stale {
		t.Fatalf("capacity limit discarded usable data: %d %+v %v", value, state, err)
	}
}

func TestCallerCancellationDoesNotCancelSharedRefresh(t *testing.T) {
	type contextKey struct{}
	ctx, cancel := context.WithCancel(context.WithValue(context.Background(), contextKey{}, "credential"))
	c := New[int](time.Minute)
	started := make(chan struct{})
	release := make(chan struct{})
	callerDone := make(chan error, 1)
	go func() {
		_, _, err := c.Load(ctx, "key", func(loadCtx context.Context) (int, error) {
			if loadCtx.Value(contextKey{}) != "credential" {
				t.Error("lost request context value")
			}
			close(started)
			<-release
			return 42, loadCtx.Err()
		})
		callerDone <- err
	}()
	<-started
	c.mu.Lock()
	done := c.flights["key"]
	c.mu.Unlock()
	cancel()
	if err := <-callerDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("caller did not cancel: %v", err)
	}
	close(release)
	<-done
	if value, ok := c.Get("key"); !ok || value != 42 {
		t.Fatal("shared refresh did not finish")
	}
}

func TestPersistenceRestoresSnapshotAndUsesPrivateHashedFiles(t *testing.T) {
	directory := t.TempDir()
	key := "https://example.com/feed?token=private"
	c := New[string](time.Hour)
	if err := c.SetPersistence(directory); err != nil {
		t.Fatal(err)
	}
	c.Set(key, "last good data")
	files, err := os.ReadDir(directory)
	if err != nil || len(files) != 1 {
		t.Fatalf("snapshots=%v err=%v", files, err)
	}
	if strings.Contains(files[0].Name(), "private") || files[0].Name() != snapshotName(key) {
		t.Fatal("cache key exposed in filename")
	}
	info, err := files[0].Info()
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("snapshot permissions: %v %v", info, err)
	}

	restored := New[string](time.Hour)
	if err := restored.SetPersistence(directory); err != nil {
		t.Fatal(err)
	}
	value, _, err := restored.Load(context.Background(), key, func(context.Context) (string, error) {
		t.Error("fresh persisted data unnecessarily fetched")
		return "", errors.New("offline")
	})
	if err != nil || value != "last good data" {
		t.Fatalf("restored=%q err=%v", value, err)
	}
}

func TestCorruptSnapshotFallsThroughToExplicitFetchFailure(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, snapshotName("key")), []byte("{broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	c := New[string](time.Hour)
	if err := c.SetPersistence(directory); err != nil {
		t.Fatal(err)
	}
	offline := errors.New("offline")
	_, _, err := c.Load(context.Background(), "key", func(context.Context) (string, error) {
		return "", offline
	})
	if !errors.Is(err, offline) {
		t.Fatalf("corrupt snapshot hid failure: %v", err)
	}
}
