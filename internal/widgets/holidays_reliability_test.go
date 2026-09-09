package widgets

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func resetHolidayFixtureCache(t *testing.T) {
	t.Helper()
	old := holidayYearCache
	holidayYearCache = newHolidayYearCache()
	t.Cleanup(func() { holidayYearCache = old })
}

func settleHolidayFixture(t *testing.T, country string, year int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, _, _ = holidayYearCache.Load(ctx, holidayYearKey(country, year), func(ctx context.Context) (holidayYearData, error) {
		return fetchHolidayYear(ctx, country, year)
	})
	if ctx.Err() != nil {
		t.Fatal("calendar fixture did not finish")
	}
}

func TestHolidayOfflineBundled2026AndDayChanges(t *testing.T) {
	resetHolidayFixtureCache(t)
	var currentYearCalls, futureYearCalls atomic.Int32
	useFeedFixtureTransport(t, func(req *http.Request) (*http.Response, error) {
		if strings.HasSuffix(req.URL.Path, "/2026.json") {
			currentYearCalls.Add(1)
		} else {
			futureYearCalls.Add(1)
		}
		return nil, errors.New("offline fixture")
	})
	first, err := UpcomingPublicHolidays(context.Background(), []string{"cn"}, time.Date(2026, 9, 24, 23, 0, 0, 0, time.UTC), 3)
	if err != nil || len(first.Items) != 2 || first.Items[0].Date != "2026-09-25" ||
		first.Items[0].DaysUntil != 1 || first.Items[0].Source != "holiday-cn" || first.Items[0].SourceURL == "" {
		t.Fatalf("bundled offline calendar unavailable: %+v, %v", first, err)
	}
	waitFeedFixture(t, func() bool {
		_, state, _ := holidayYearCache.Load(context.Background(), holidayYearKey("CN", 2026), nil)
		return state.Err != nil && !state.Refreshing
	})
	settleHolidayFixture(t, "CN", 2027)
	second, err := UpcomingPublicHolidays(context.Background(), []string{"CN"}, time.Date(2026, 9, 25, 1, 0, 0, 0, time.UTC), 3)
	if err != nil || second.Items[0].DaysUntil != 0 || second.FetchedAt != first.FetchedAt || len(second.SourceErrors) != 2 {
		t.Fatalf("daily countdown or failure attribution incorrect: %+v, %v", second, err)
	}
	third, err := NextPublicHoliday(context.Background(), []string{"CN"}, time.Date(2026, 9, 26, 1, 0, 0, 0, time.UTC))
	if err != nil || third.Date != "2026-09-26" || third.DaysUntil != 0 || third.Source != "holiday-cn" ||
		third.FetchedAt != first.FetchedAt || len(third.SourceErrors) != 2 {
		t.Fatalf("multi-day event must use earliest still-upcoming day: %+v, %v", third, err)
	}
	if currentYearCalls.Load() != 1 || futureYearCalls.Load() != 1 {
		t.Fatalf("offline boot repeatedly refreshed the bundled or future year: current=%d future=%d",
			currentYearCalls.Load(), futureYearCalls.Load())
	}
}

func TestHolidayUnpublishedFutureIsCachedWithoutInventingDates(t *testing.T) {
	resetHolidayFixtureCache(t)
	if _, err := ensureBundledChinaYear(2026); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	useFeedFixtureTransport(t, func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		if !strings.HasSuffix(req.URL.Path, "/2027.json") {
			t.Errorf("unexpected calendar source: %s", req.URL)
		}
		return feedFixtureResponse(`{"year":2027,"days":[]}`, http.StatusOK)
	})
	now := time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC)
	_, _ = UpcomingPublicHolidays(context.Background(), []string{"CN"}, now, 10)
	settleHolidayFixture(t, "CN", 2027)
	for range 3 {
		out, err := UpcomingPublicHolidays(context.Background(), []string{"CN"}, now, 10)
		if err != nil || len(out.SourceErrors) != 1 || !strings.Contains(out.SourceErrors[0].Error, "not yet published") ||
			out.Refreshing || out.Warning == "" {
			t.Fatalf("unpublished year must be explicit but not repeatedly loading: %+v, %v", out, err)
		}
		for _, item := range out.Items {
			if strings.HasPrefix(item.Date, "2027-") {
				t.Fatalf("invented an unpublished holiday: %+v", item)
			}
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("empty future year repeatedly fetched: %d", calls.Load())
	}
}

func TestHolidayPartialCountryFailuresPreserveOtherCountries(t *testing.T) {
	resetHolidayFixtureCache(t)
	if _, err := ensureBundledChinaYear(2026); err != nil {
		t.Fatal(err)
	}
	useFeedFixtureTransport(t, func(req *http.Request) (*http.Response, error) {
		switch {
		case strings.HasSuffix(req.URL.Path, "/2027.json"):
			return feedFixtureResponse(`{"year":2027,"days":[]}`, http.StatusOK)
		case strings.HasSuffix(req.URL.Path, "/DE"):
			return feedFixtureResponse("untrusted response body", http.StatusServiceUnavailable)
		case strings.Contains(req.URL.Path, "/2026/US"):
			return feedFixtureResponse(`[{"date":"2026-09-26","name":"Fixture event","localName":"Fixture event"}]`, http.StatusOK)
		case strings.Contains(req.URL.Path, "/2027/US"):
			return feedFixtureResponse(`[{"date":"2027-01-01","name":"Next fixture event","localName":"Next fixture event"}]`, http.StatusOK)
		default:
			t.Errorf("unexpected source: %s", req.URL)
			return nil, errors.New("unexpected fixture request")
		}
	})
	now := time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC)
	_, _ = UpcomingPublicHolidays(context.Background(), []string{"CN", "US", "DE"}, now, 10)
	for _, country := range []string{"CN", "US", "DE"} {
		for _, year := range []int{2026, 2027} {
			settleHolidayFixture(t, country, year)
		}
	}
	out, err := UpcomingPublicHolidays(context.Background(), []string{"CN", "US", "DE"}, now, 10)
	if err != nil || len(out.Items) != 4 || len(out.SourceErrors) != 3 || len(out.Sources) != 2 || out.Warning == "" {
		t.Fatalf("country failure masked or usable countries lost: %+v, %v", out, err)
	}
	if out.Items[0].Country != "CN" || out.Items[1].Country != "US" || out.Items[1].Source != "Nager.Date" {
		t.Fatalf("incorrect chronology/attribution: %+v", out.Items)
	}
	for _, sourceError := range out.SourceErrors {
		if strings.Contains(sourceError.Error, "untrusted response body") {
			t.Fatal("provider error body should not be exposed")
		}
	}
}

func TestHolidayAllFailedIsNotReportedAsNoHoliday(t *testing.T) {
	resetHolidayFixtureCache(t)
	useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
		return nil, errors.New("offline fixture")
	})
	out, err := UpcomingPublicHolidays(context.Background(), []string{"US"}, time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC), 3)
	if err == nil || !strings.Contains(err.Error(), "no usable annual calendars") ||
		len(out.SourceErrors) != 2 || out.FetchedAt != 0 {
		t.Fatalf("calendar errors were masked: %+v, %v", out, err)
	}
}

func TestHolidayPersistentSnapshotPrecedesBundle(t *testing.T) {
	resetHolidayFixtureCache(t)
	dir := feedFixtureDirectory(t)
	if err := holidayYearCache.SetPersistence(dir); err != nil {
		t.Fatal(err)
	}
	key := holidayYearKey("CN", 2026)
	snapshot := holidayYearData{
		Published: true, HolidaySource: holidayAttribution("CN"),
		Items: []nagerHoliday{{Date: "2026-10-12", Name: "Persistent fixture", LocalName: "Persistent fixture"}},
	}
	holidayYearCache.Set(key, snapshot)
	holidayYearCache.Set(holidayYearKey("CN", 2027), holidayYearData{HolidaySource: holidayAttribution("CN")})
	_, original, err := holidayYearCache.Load(context.Background(), key, nil)
	if err != nil {
		t.Fatal(err)
	}
	holidayYearCache = newHolidayYearCache()
	if err := holidayYearCache.SetPersistence(dir); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	useFeedFixtureTransport(t, func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, errors.New("offline fixture")
	})
	out, err := UpcomingPublicHolidays(context.Background(), []string{"CN"}, time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC), 3)
	if err != nil || len(out.Items) != 1 || out.Items[0].Name != "Persistent fixture" ||
		out.FetchedAt != original.FetchedAt.Unix() || calls.Load() != 0 {
		t.Fatalf("persisted calendar overwritten or refetched: %+v, %v; calls=%d", out, err, calls.Load())
	}
	_, restored, err := holidayYearCache.Load(context.Background(), key, nil)
	if err != nil || !restored.FetchedAt.Equal(original.FetchedAt) {
		t.Fatalf("snapshot timestamp was bumped: %+v -> %+v (%v)", original, restored, err)
	}
}

func TestHolidayAnnualPayloadValidation(t *testing.T) {
	for _, body := range []string{
		`null`, `{}`, `{"year":2027,"days":[]}`,
		`{"year":2026,"days":[{"name":"Fixture","date":"2026-02-30","isOffDay":true}]}`,
		`{"year":2026,"days":[{"name":"","date":"2026-02-01","isOffDay":true}]}`,
		`{"year":2026,"days":[{"name":"Fixture","date":"2024-12-31","isOffDay":true}]}`,
		`{"year":2026,"days":[{"name":"Fixture","date":"2028-01-01","isOffDay":true}]}`,
	} {
		if _, err := parseChinaHolidayYear([]byte(body), 2026); err == nil {
			t.Errorf("invalid calendar accepted: %s", body)
		}
	}
	for _, date := range []string{"2026-02-30", "2026-00-01", "2026-01-00"} {
		if _, err := parseISODateUTC(date); err == nil {
			t.Errorf("invalid date silently normalized: %s", date)
		}
	}
}

func TestHolidayCountryYearConcurrencyBounded(t *testing.T) {
	resetHolidayFixtureCache(t)
	var active, peak atomic.Int32
	release := make(chan struct{})
	useFeedFixtureTransport(t, func(req *http.Request) (*http.Response, error) {
		n := active.Add(1)
		for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
		}
		<-release
		active.Add(-1)
		parts := strings.Split(req.URL.Path, "/")
		year := parts[len(parts)-2]
		body := fmt.Sprintf(`[{"date":"%s-10-01","name":"Fixture event","localName":"Fixture event"}]`, year)
		return feedFixtureResponse(body, http.StatusOK)
	})
	countries := []string{"US", "GB", "DE", "FR", "JP", "IT", "CA", "BR"}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, _ = UpcomingPublicHolidays(ctx, countries, time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC), 10)
	close(release)
	for _, country := range countries {
		for _, year := range []int{2026, 2027} {
			settleHolidayFixture(t, country, year)
		}
	}
	if peak.Load() > 4 || peak.Load() == 0 {
		t.Fatalf("calendar concurrency exceeded the provider bound: %d", peak.Load())
	}
}

func TestHolidayUnpublishedRefreshCannotReplacePublishedSnapshot(t *testing.T) {
	resetHolidayFixtureCache(t)
	holidayYearCache = newFeedCache[holidayYearData](time.Nanosecond, 2*365*24*time.Hour)
	ensureBundledChinaYear(2026)
	holidayYearCache.Set(holidayYearKey("CN", 2027), holidayYearData{HolidaySource: holidayAttribution("CN")})
	release := make(chan struct{})
	var calls atomic.Int32
	useFeedFixtureTransport(t, func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		<-release
		year := "2026"
		if strings.HasSuffix(req.URL.Path, "/2027.json") {
			year = "2027"
		}
		return feedFixtureResponse(fmt.Sprintf(`{"year":%s,"days":[]}`, year), http.StatusOK)
	})
	now := time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC)
	first, err := UpcomingPublicHolidays(context.Background(), []string{"CN"}, now, 3)
	if err != nil || !first.Refreshing || !first.Stale || len(first.Items) != 2 {
		t.Errorf("stale calendar not served during refresh: %+v, %v", first, err)
	}
	waitFeedFixture(t, func() bool { return calls.Load() == 2 })
	close(release)
	waitFeedFixture(t, func() bool {
		_, state, _ := holidayYearCache.Load(context.Background(), holidayYearKey("CN", 2026),
			func(context.Context) (holidayYearData, error) {
				return holidayYearData{}, errors.New("unexpected fixture refresh")
			})
		return !state.Refreshing && state.Err != nil
	})
	// Join the other refresh before restoring package-level fixture state.
	_, _, _ = holidayYearCache.Load(context.Background(), holidayYearKey("CN", 2027),
		func(context.Context) (holidayYearData, error) {
			return holidayYearData{}, errors.New("fixture stopped")
		}, true)
	data, ok := holidayYearCache.GetStale(holidayYearKey("CN", 2026))
	if !ok || !data.Published || len(data.Items) != 33 {
		t.Fatalf("empty annual update replaced known published holidays: %+v", data)
	}
}
