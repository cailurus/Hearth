package widgets

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

type NextHoliday struct {
	DataStatus
	FetchedAt    int64             `json:"fetchedAt"`
	Country      string            `json:"country"`
	Date         string            `json:"date"`
	Name         string            `json:"name"`
	LocalName    string            `json:"localName"`
	DaysUntil    int               `json:"daysUntil"`
	Source       string            `json:"source"`
	SourceURL    string            `json:"sourceUrl"`
	SourceErrors []FeedSourceError `json:"sourceErrors,omitempty"`
}

type HolidayItem struct {
	Country   string `json:"country"`
	Date      string `json:"date"`
	Name      string `json:"name"`
	LocalName string `json:"localName"`
	DaysUntil int    `json:"daysUntil"`
	Source    string `json:"source"`
	SourceURL string `json:"sourceUrl"`
}

type HolidaySource struct {
	Source    string `json:"source"`
	SourceURL string `json:"sourceUrl"`
}

type HolidaysResponse struct {
	DataStatus
	FetchedAt    int64             `json:"fetchedAt"`
	Items        []HolidayItem     `json:"items"`
	Sources      []HolidaySource   `json:"sources"`
	SourceErrors []FeedSourceError `json:"sourceErrors,omitempty"`
}

type HolidayCountry struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type nagerHoliday struct {
	Date      string `json:"date"`
	LocalName string `json:"localName"`
	Name      string `json:"name"`
}

type holidayYearData struct {
	Items     []nagerHoliday `json:"items"`
	Published bool           `json:"published"`
	HolidaySource
}

//go:embed data/holiday-cn/2026.json data/holiday-cn/LICENSE data/holiday-cn/provenance.json
var bundledChinaHolidays embed.FS

var holidayYearCache = newHolidayYearCache()
var holidayCountriesTTLCache = newFeedCache[[]HolidayCountry](7*24*time.Hour, 365*24*time.Hour)
var holidayFetchSlots = make(chan struct{}, 4)
var bundledCalendarMu sync.Mutex

func newHolidayYearCache() *cache.Cache[holidayYearData] {
	return newFeedCache[holidayYearData](12*time.Hour, 2*365*24*time.Hour)
}

func ensureBundledChinaYear(year int) (bool, error) {
	return seedChinaHolidayYear(holidayYearCache, bundledChinaHolidays, year)
}

func seedChinaHolidayYear(c *cache.Cache[holidayYearData], assets fs.FS, year int) (bool, error) {
	if year != 2026 {
		return false, nil
	}
	bundledCalendarMu.Lock()
	defer bundledCalendarMu.Unlock()
	if _, ok := c.GetStale(holidayYearKey("CN", year)); ok {
		return false, nil
	}
	// Read persisted data first, then use the verified offline snapshot.
	body, err := fs.ReadFile(assets, "data/holiday-cn/2026.json")
	if err != nil {
		return false, fmt.Errorf("read bundled China calendar: %w", err)
	}
	data, err := parseChinaHolidayYear(body, year)
	if err != nil {
		return false, fmt.Errorf("parse bundled China calendar: %w", err)
	}
	c.Set(holidayYearKey("CN", year), data)
	return true, nil
}

func normalizeCountryCodes(codes []string) []string {
	out := make([]string, 0, len(codes))
	seen := map[string]bool{}
	for _, raw := range codes {
		c := strings.ToUpper(strings.TrimSpace(raw))
		if len(c) != 2 || c[0] < 'A' || c[0] > 'Z' || c[1] < 'A' || c[1] > 'Z' || seen[c] {
			continue
		}
		seen[c] = true
		out = append(out, c)
	}
	return out
}

func parseISODateUTC(s string) (time.Time, error) {
	return time.Parse("2006-01-02", strings.TrimSpace(s))
}

type chinaHolidayCN struct {
	Year int `json:"year"`
	Days []struct {
		Name     string `json:"name"`
		Date     string `json:"date"`
		IsOffDay bool   `json:"isOffDay"`
	} `json:"days"`
}

func chinaHolidayEnglishName(local string) string {
	switch strings.TrimSpace(local) {
	case "元旦":
		return "New Year's Day"
	case "春节":
		return "Spring Festival"
	case "清明节":
		return "Qingming Festival"
	case "劳动节":
		return "Labour Day"
	case "端午节":
		return "Dragon Boat Festival"
	case "中秋节":
		return "Mid-Autumn Festival"
	case "国庆节":
		return "National Day"
	default:
		return strings.TrimSpace(local)
	}
}

func holidayYearKey(country string, year int) string {
	return fmt.Sprintf("%s|%d", country, year)
}

func holidayAttribution(country string) HolidaySource {
	if country == "CN" {
		return HolidaySource{"holiday-cn", "https://github.com/NateScarlet/holiday-cn"}
	}
	return HolidaySource{"Nager.Date", "https://date.nager.at/"}
}

func parseChinaHolidayYear(body []byte, year int) (holidayYearData, error) {
	var payload chinaHolidayCN
	if err := json.Unmarshal(body, &payload); err != nil || payload.Year != year || payload.Days == nil {
		return holidayYearData{}, errors.New("holiday-cn: invalid annual calendar")
	}
	out := holidayYearData{Items: make([]nagerHoliday, 0), HolidaySource: holidayAttribution("CN")}
	for _, day := range payload.Days {
		date, err := parseISODateUTC(day.Date)
		local := strings.TrimSpace(day.Name)
		if err != nil || date.Year() < year-1 || date.Year() > year+1 || local == "" {
			return holidayYearData{}, errors.New("holiday-cn: invalid holiday date or name")
		}
		if day.IsOffDay {
			out.Items = append(out.Items, nagerHoliday{
				Date: date.Format("2006-01-02"), LocalName: local, Name: chinaHolidayEnglishName(local),
			})
		}
	}
	out.Published = len(out.Items) > 0
	sort.Slice(out.Items, func(i, j int) bool { return out.Items[i].Date < out.Items[j].Date })
	return out, nil
}

func fetchHolidayJSON(ctx context.Context, endpoint, source string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("%s: invalid provider URL", source)
	}
	req.Header.Set("User-Agent", "Hearth/1.0")
	req.Header.Set("Accept", "application/json")
	resp, err := DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s: request failed", source)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: HTTP %d", source, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("%s: could not read response", source)
	}
	return body, nil
}

func fetchHolidayYear(ctx context.Context, country string, year int) (holidayYearData, error) {
	if err := acquireFeedSlot(ctx, holidayFetchSlots); err != nil {
		return holidayYearData{}, errors.New("calendar: request timed out")
	}
	defer func() { <-holidayFetchSlots }()
	source := holidayAttribution(country)
	endpoint := fmt.Sprintf("https://date.nager.at/api/v3/PublicHolidays/%d/%s", year, country)
	if country == "CN" {
		endpoint = fmt.Sprintf("https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/%d.json", year)
	}
	body, err := fetchHolidayJSON(ctx, endpoint, source.Source)
	if err != nil {
		return holidayYearData{}, err
	}
	if country == "CN" {
		return parseChinaHolidayYear(body, year)
	}
	var items []nagerHoliday
	if err := json.Unmarshal(body, &items); err != nil || items == nil {
		return holidayYearData{}, errors.New("Nager.Date: invalid annual calendar")
	}
	for i := range items {
		day, err := parseISODateUTC(items[i].Date)
		items[i].Name = strings.TrimSpace(items[i].Name)
		items[i].LocalName = strings.TrimSpace(items[i].LocalName)
		if err != nil || day.Year() < year-1 || day.Year() > year+1 || (items[i].Name == "" && items[i].LocalName == "") {
			return holidayYearData{}, errors.New("Nager.Date: invalid holiday date or name")
		}
		items[i].Date = day.Format("2006-01-02")
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Date < items[j].Date })
	return holidayYearData{Items: items, Published: len(items) > 0, HolidaySource: source}, nil
}

// UpcomingPublicHolidays derives countdowns from annual snapshots on every call.
func UpcomingPublicHolidays(ctx context.Context, countryCodes []string, now time.Time, limit int) (HolidaysResponse, error) {
	cc := normalizeCountryCodes(countryCodes)
	if len(cc) == 0 {
		return HolidaysResponse{}, errors.New("countries required")
	}
	if len(cc) > 20 {
		return HolidaysResponse{}, errors.New("at most 20 holiday countries supported")
	}
	if limit <= 0 {
		limit = 3
	}
	if limit > 10 {
		limit = 10
	}
	nowUTC := now.UTC()
	today := time.Date(nowUTC.Year(), nowUTC.Month(), nowUTC.Day(), 0, 0, 0, 0, time.UTC)
	loads := make([]feedLoad[holidayYearData], 0, len(cc)*2)
	for _, country := range cc {
		for _, year := range []int{today.Year(), today.Year() + 1} {
			seeded := false
			if country == "CN" {
				var err error
				seeded, err = ensureBundledChinaYear(year)
				if err != nil {
					slog.Warn("cannot load bundled holiday calendar", "year", year, "error", err)
				}
			}
			loads = append(loads, feedLoad[holidayYearData]{
				key:     holidayYearKey(country, year),
				source:  fmt.Sprintf("%s (%s %d)", holidayAttribution(country).Source, country, year),
				refresh: seeded,
				loader: func(ctx context.Context) (holidayYearData, error) {
					data, err := fetchHolidayYear(ctx, country, year)
					if err == nil && !data.Published {
						if old, ok := holidayYearCache.GetStale(holidayYearKey(country, year)); ok && old.Published {
							return holidayYearData{}, errors.New("annual calendar not yet published")
						}
					}
					return data, err
				},
			})
		}
	}
	results := loadFeedSources(ctx, holidayYearCache, loads, false)
	out := HolidaysResponse{Items: make([]HolidayItem, 0), Sources: make([]HolidaySource, 0)}
	candidates := make([]HolidayItem, 0, 64)
	seenSources := map[string]bool{}
	anyOK := false
	for i, result := range results {
		mergeFeedStatus(&out.DataStatus, &out.FetchedAt, result.state)
		source := holidayAttribution(cc[i/2])
		if !seenSources[source.Source] {
			out.Sources = append(out.Sources, source)
			seenSources[source.Source] = true
		}
		err := result.err
		if result.state.Err != nil {
			err = result.state.Err
		}
		if !result.state.FetchedAt.IsZero() {
			if !result.value.Published {
				err = errors.New("annual calendar not yet published")
			} else {
				anyOK = true
			}
			for _, holiday := range result.value.Items {
				day, parseErr := parseISODateUTC(holiday.Date)
				if parseErr != nil || day.Before(today) {
					continue
				}
				candidates = append(candidates, HolidayItem{
					Country: cc[i/2], Date: holiday.Date, Name: holiday.Name, LocalName: holiday.LocalName,
					DaysUntil: int(day.Sub(today).Hours() / 24), Source: source.Source, SourceURL: source.SourceURL,
				})
			}
		}
		if err != nil {
			out.SourceErrors = append(out.SourceErrors, FeedSourceError{loads[i].source, err.Error()})
		}
	}
	if len(out.SourceErrors) > 0 {
		out.Warning = "some annual calendars are unavailable"
	}
	if !anyOK {
		return out, errors.New("no usable annual calendars")
	}
	sort.Slice(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		if a.Country != b.Country {
			return a.Country < b.Country
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.LocalName < b.LocalName
	})
	// Keep the earliest upcoming day of each event, including multi-day holidays.
	seen := map[string]bool{}
	for _, candidate := range candidates {
		key := candidate.Country + "|" + candidate.Name + "|" + candidate.LocalName
		if seen[key] {
			continue
		}
		seen[key] = true
		out.Items = append(out.Items, candidate)
		if len(out.Items) >= limit {
			break
		}
	}
	if len(out.Items) == 0 {
		return out, errors.New("no upcoming holiday in available calendars")
	}
	return out, nil
}

func ListHolidayCountries(ctx context.Context) ([]HolidayCountry, error) {
	list, _, err := holidayCountriesTTLCache.Load(ctx, "countries", func(ctx context.Context) ([]HolidayCountry, error) {
		body, err := fetchHolidayJSON(ctx, "https://date.nager.at/api/v3/AvailableCountries", "Nager.Date")
		if err != nil {
			return nil, err
		}
		var payload []struct {
			CountryCode string `json:"countryCode"`
			Name        string `json:"name"`
		}
		if err := json.Unmarshal(body, &payload); err != nil || len(payload) == 0 {
			return nil, errors.New("Nager.Date: invalid country list")
		}
		out := make([]HolidayCountry, 0, len(payload))
		for _, country := range payload {
			codes := normalizeCountryCodes([]string{country.CountryCode})
			if len(codes) != 1 || strings.TrimSpace(country.Name) == "" {
				return nil, errors.New("Nager.Date: invalid country")
			}
			out = append(out, HolidayCountry{Code: codes[0], Name: strings.TrimSpace(country.Name)})
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
		return out, nil
	})
	return list, err
}

func NextPublicHoliday(ctx context.Context, countryCodes []string, now time.Time) (NextHoliday, error) {
	result, err := UpcomingPublicHolidays(ctx, countryCodes, now, 1)
	out := NextHoliday{DataStatus: result.DataStatus, FetchedAt: result.FetchedAt, SourceErrors: result.SourceErrors}
	if err != nil {
		return out, err
	}
	item := result.Items[0]
	out.Country, out.Date, out.Name, out.LocalName = item.Country, item.Date, item.Name, item.LocalName
	out.DaysUntil, out.Source, out.SourceURL = item.DaysUntil, item.Source, item.SourceURL
	return out, nil
}
