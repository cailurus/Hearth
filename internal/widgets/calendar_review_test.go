package widgets

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

func TestHolidayBundleReadAndParseFailuresAreExplicit(t *testing.T) {
	for _, tc := range []struct {
		name, want string
		assets     fstest.MapFS
	}{
		{"missing", "read bundled China calendar", fstest.MapFS{}},
		{"malformed", "parse bundled China calendar", fstest.MapFS{
			"data/holiday-cn/2026.json": {Data: []byte(`{"year":2026,"days":`)},
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newHolidayYearCache()
			seeded, err := seedChinaHolidayYear(c, tc.assets, 2026)
			if seeded || err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("bundle failure was hidden: seeded=%v err=%v", seeded, err)
			}
			if _, ok := c.GetStale(holidayYearKey("CN", 2026)); ok {
				t.Fatal("invalid bundle was cached")
			}
		})
	}
}

func TestHolidayBundleRefreshStartsWithoutDelayingFirstRead(t *testing.T) {
	resetHolidayFixtureCache(t)
	holidayYearCache.Set(holidayYearKey("CN", 2027), holidayYearData{HolidaySource: holidayAttribution("CN")})
	release := make(chan struct{})
	var calls atomic.Int32
	useFeedFixtureTransport(t, func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		if !strings.HasSuffix(req.URL.Path, "/2026.json") {
			t.Errorf("unexpected source: %s", req.URL)
		}
		<-release
		return feedFixtureResponse(`{"year":2026,"days":[{"date":"2026-09-24","name":"更新测试节","isOffDay":true}]}`, http.StatusOK)
	})
	start := time.Now()
	out, err := UpcomingPublicHolidays(context.Background(), []string{"CN"}, time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC), 3)
	if err != nil || len(out.Items) != 2 || !out.Refreshing || time.Since(start) > 500*time.Millisecond {
		t.Errorf("bundle initial read waited for upstream or hid refresh: %+v, %v", out, err)
	}
	waitFeedFixture(t, func() bool { return calls.Load() == 1 })
	close(release)
	waitFeedFixture(t, func() bool {
		data, ok := holidayYearCache.Get(holidayYearKey("CN", 2026))
		return ok && len(data.Items) == 1 && data.Items[0].LocalName == "更新测试节"
	})
	next, err := UpcomingPublicHolidays(context.Background(), []string{"CN"}, time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC), 3)
	if err != nil || len(next.Items) != 1 || next.Items[0].Date != "2026-09-24" || next.Refreshing || calls.Load() != 1 {
		t.Fatalf("initial background update was not retained: %+v, %v; calls=%d", next, err, calls.Load())
	}
}

func TestHolidayAnnualProvidersAcceptAdjacentYearDates(t *testing.T) {
	for _, country := range []string{"CN", "US"} {
		t.Run(country, func(t *testing.T) {
			resetHolidayFixtureCache(t)
			holidayYearCache.Set(holidayYearKey(country, 2026), holidayYearData{
				Published: true, HolidaySource: holidayAttribution(country),
				Items: []nagerHoliday{{Date: "2026-06-01", Name: "Past fixture", LocalName: "Past fixture"}},
			})
			useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
				if country == "CN" {
					return feedFixtureResponse(`{"year":2027,"days":[
						{"date":"2026-12-31","name":"跨年测试节","isOffDay":true},
						{"date":"2027-01-01","name":"跨年测试节","isOffDay":true},
						{"date":"2028-01-01","name":"下一年测试节","isOffDay":true}
					]}`, http.StatusOK)
				}
				return feedFixtureResponse(`[
					{"date":"2026-12-31","name":"Observed fixture","localName":"Observed fixture"},
					{"date":"2027-01-01","name":"Observed fixture","localName":"Observed fixture"},
					{"date":"2028-01-01","name":"Next-year fixture","localName":"Next-year fixture"}
				]`, http.StatusOK)
			})
			data, _, err := holidayYearCache.Load(context.Background(), holidayYearKey(country, 2027),
				func(ctx context.Context) (holidayYearData, error) { return fetchHolidayYear(ctx, country, 2027) })
			if err != nil || len(data.Items) != 3 || data.Items[0].Date != "2026-12-31" || data.Items[2].Date != "2028-01-01" {
				t.Fatalf("valid adjacent-year calendar was rejected: %+v, %v", data, err)
			}
			out, err := UpcomingPublicHolidays(context.Background(), []string{country}, time.Date(2026, 12, 30, 0, 0, 0, 0, time.UTC), 10)
			if err != nil || len(out.Items) != 2 || out.Items[0].Date != "2026-12-31" || out.Items[0].DaysUntil != 1 {
				t.Fatalf("cross-year countdown or event de-duplication failed: %+v, %v", out, err)
			}
		})
	}
}

func TestRSSCompletedFailureWinsAggregateTimeout(t *testing.T) {
	c := newFeedCache[int](time.Hour, 24*time.Hour)
	failure := errors.New("completed fixture failure")
	results := make([]feedResult[int], 1)
	pending := map[int]bool{0: true}
	done := make(chan feedCompletion[int], 1)
	done <- feedCompletion[int]{index: 0, result: feedResult[int]{state: cache.State{Err: failure}, err: failure}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	finishFeedSources(ctx, c, []feedLoad[int]{{key: "fixture"}}, results, pending, done)
	if results[0].state.Refreshing || !errors.Is(results[0].state.Err, failure) || !errors.Is(results[0].err, failure) {
		t.Fatalf("completed error replaced by artificial pending status: %+v", results[0])
	}
}

func TestRSSCompletedCacheFailureWinsPendingWorker(t *testing.T) {
	c := newFeedCache[int](time.Hour, 24*time.Hour)
	const key = "fixture"
	c.Set(key, 7)
	failure := errors.New("completed fixture failure")
	_, _, err := c.Load(context.Background(), key, func(context.Context) (int, error) { return 0, failure }, true)
	if err != nil {
		t.Fatalf("fixture should retain usable cached data: %v", err)
	}
	results := make([]feedResult[int], 1)
	pending := map[int]bool{0: true}
	done := make(chan feedCompletion[int], 1)
	finishFeedSources(context.Background(), c, []feedLoad[int]{{key: key}}, results, pending, done)
	if results[0].value != 7 || results[0].state.Refreshing || !errors.Is(results[0].state.Err, failure) {
		t.Fatalf("known cache failure overwritten while worker completion was delayed: %+v", results[0])
	}
}
