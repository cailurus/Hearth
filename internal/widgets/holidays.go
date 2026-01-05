package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type NextHoliday struct {
	FetchedAt int64  `json:"fetchedAt"`
	Country   string `json:"country"`
	Date      string `json:"date"` // YYYY-MM-DD
	Name      string `json:"name"`
	LocalName string `json:"localName"`
	DaysUntil int    `json:"daysUntil"`
}

type HolidayItem struct {
	Country   string `json:"country"`
	Date      string `json:"date"` // YYYY-MM-DD
	Name      string `json:"name"`
	LocalName string `json:"localName"`
	DaysUntil int    `json:"daysUntil"`
}

type HolidaysResponse struct {
	FetchedAt int64         `json:"fetchedAt"`
	Items     []HolidayItem `json:"items"`
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

var holidaysCache = struct {
	mu    sync.Mutex
	items map[string]struct {
		FetchedAt int64
		List      []nagerHoliday
	}
}{
	items: map[string]struct {
		FetchedAt int64
		List      []nagerHoliday
	}{},
}

var holidayCountriesCache = struct {
	mu        sync.Mutex
	fetchedAt int64
	items     []HolidayCountry
}{}

func normalizeCountryCodes(codes []string) []string {
	out := make([]string, 0, len(codes))
	seen := map[string]bool{}
	for _, raw := range codes {
		c := strings.ToUpper(strings.TrimSpace(raw))
		if len(c) != 2 {
			continue
		}
		if c[0] < 'A' || c[0] > 'Z' || c[1] < 'A' || c[1] > 'Z' {
			continue
		}
		if seen[c] {
			continue
		}
		seen[c] = true
		out = append(out, c)
	}
	return out
}

func parseISODateUTC(s string) (time.Time, error) {
	parts := strings.Split(strings.TrimSpace(s), "-")
	if len(parts) != 3 {
		return time.Time{}, errors.New("invalid date")
	}
	y, err := time.Parse("2006", parts[0])
	if err != nil {
		return time.Time{}, errors.New("invalid year")
	}
	m, err := time.Parse("01", parts[1])
	if err != nil {
		return time.Time{}, errors.New("invalid month")
	}
	d, err := time.Parse("02", parts[2])
	if err != nil {
		return time.Time{}, errors.New("invalid day")
	}
	return time.Date(y.Year(), m.Month(), d.Day(), 0, 0, 0, 0, time.UTC), nil
}

type chinaHolidayCN struct {
	Year int `json:"year"`
	Days []struct {
		Name     string `json:"name"`
		Date     string `json:"date"`
		IsOffDay bool   `json:"isOffDay"`
	} `json:"days"`
}

type holidayCandidate struct {
	Country   string
	Date      string
	Name      string
	LocalName string
	Day       time.Time
}

var chinaOffDaysCache = struct {
	mu    sync.Mutex
	items map[int]struct {
		FetchedAt int64
		Days      []nagerHoliday
	}
}{
	items: map[int]struct {
		FetchedAt int64
		Days      []nagerHoliday
	}{},
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

func fetchChinaOffDays(ctx context.Context, year int) ([]nagerHoliday, error) {
	if year <= 0 {
		return nil, errors.New("invalid year")
	}

	const ttl = 30 * 24 * time.Hour
	chinaOffDaysCache.mu.Lock()
	if v, ok := chinaOffDaysCache.items[year]; ok {
		age := time.Since(time.Unix(v.FetchedAt, 0))
		if v.FetchedAt > 0 && age >= 0 && age < ttl && len(v.Days) > 0 {
			out := make([]nagerHoliday, len(v.Days))
			copy(out, v.Days)
			chinaOffDaysCache.mu.Unlock()
			return out, nil
		}
	}
	chinaOffDaysCache.mu.Unlock()

	endpoint := fmt.Sprintf("https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/%d.json", year)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Hearth/0.1")

	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("holiday-cn: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload chinaHolidayCN
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	out := make([]nagerHoliday, 0, len(payload.Days))
	for _, d := range payload.Days {
		if !d.IsOffDay {
			continue
		}
		local := strings.TrimSpace(d.Name)
		date := strings.TrimSpace(d.Date)
		if local == "" || date == "" {
			continue
		}
		out = append(out, nagerHoliday{Date: date, LocalName: local, Name: chinaHolidayEnglishName(local)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date < out[j].Date })

	chinaOffDaysCache.mu.Lock()
	chinaOffDaysCache.items[year] = struct {
		FetchedAt int64
		Days      []nagerHoliday
	}{FetchedAt: time.Now().Unix(), Days: out}
	chinaOffDaysCache.mu.Unlock()

	return out, nil
}

// UpcomingPublicHolidays returns the next N upcoming public holidays
// across all provided countries, sorted by date.
func UpcomingPublicHolidays(ctx context.Context, countryCodes []string, now time.Time, limit int) (HolidaysResponse, error) {
	cc := normalizeCountryCodes(countryCodes)
	if len(cc) == 0 {
		return HolidaysResponse{}, errors.New("countries required")
	}
	if limit <= 0 {
		limit = 3
	}
	if limit > 10 {
		limit = 10
	}

	nowUTC := now.UTC()
	today := time.Date(nowUTC.Year(), nowUTC.Month(), nowUTC.Day(), 0, 0, 0, 0, time.UTC)
	years := []int{today.Year(), today.Year() + 1}

	cands := make([]holidayCandidate, 0, 64)

	for _, country := range cc {
		for _, year := range years {
			var list []nagerHoliday
			var err error
			if country == "CN" {
				list, err = fetchChinaOffDays(ctx, year)
			} else {
				list, err = fetchNagerPublicHolidays(ctx, year, country)
			}
			if err != nil {
				continue
			}
			for _, h := range list {
				day, err := parseISODateUTC(h.Date)
				if err != nil {
					continue
				}
				if day.Before(today) {
					continue
				}
				cands = append(cands, holidayCandidate{Country: country, Date: h.Date, Name: h.Name, LocalName: h.LocalName, Day: day})
			}
		}
	}

	if len(cands) == 0 {
		return HolidaysResponse{}, errors.New("no upcoming holiday")
	}

	sort.Slice(cands, func(i, j int) bool {
		if cands[i].Day.Equal(cands[j].Day) {
			if cands[i].Country == cands[j].Country {
				if cands[i].Name == cands[j].Name {
					return cands[i].LocalName < cands[j].LocalName
				}
				return cands[i].Name < cands[j].Name
			}
			return cands[i].Country < cands[j].Country
		}
		return cands[i].Day.Before(cands[j].Day)
	})

	// De-dup by holiday event per country (country+name/localName):
	// keeps the earliest upcoming date for each event (important for multi-day holidays).
	seen := map[string]bool{}
	out := HolidaysResponse{FetchedAt: time.Now().Unix(), Items: make([]HolidayItem, 0, limit)}
	for _, c := range cands {
		k := c.Country + "|" + c.Name + "|" + c.LocalName
		if seen[k] {
			continue
		}
		seen[k] = true
		days := int(c.Day.Sub(today).Hours() / 24)
		if days < 0 {
			days = 0
		}
		out.Items = append(out.Items, HolidayItem{
			Country:   c.Country,
			Date:      c.Date,
			Name:      c.Name,
			LocalName: c.LocalName,
			DaysUntil: days,
		})
		if len(out.Items) >= limit {
			break
		}
	}

	if len(out.Items) == 0 {
		return HolidaysResponse{}, errors.New("no upcoming holiday")
	}
	return out, nil
}

// ListHolidayCountries returns available country codes (cached).
func ListHolidayCountries(ctx context.Context) ([]HolidayCountry, error) {
	const ttl = 7 * 24 * time.Hour

	holidayCountriesCache.mu.Lock()
	if holidayCountriesCache.fetchedAt > 0 {
		age := time.Since(time.Unix(holidayCountriesCache.fetchedAt, 0))
		if age >= 0 && age < ttl && len(holidayCountriesCache.items) > 0 {
			out := make([]HolidayCountry, len(holidayCountriesCache.items))
			copy(out, holidayCountriesCache.items)
			holidayCountriesCache.mu.Unlock()
			return out, nil
		}
	}
	holidayCountriesCache.mu.Unlock()

	endpoint := "https://date.nager.at/api/v3/AvailableCountries"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Hearth/0.1")

	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("nagerdate countries: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload []struct {
		CountryCode string `json:"countryCode"`
		Name        string `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	out := make([]HolidayCountry, 0, len(payload))
	for _, c := range payload {
		code := strings.ToUpper(strings.TrimSpace(c.CountryCode))
		name := strings.TrimSpace(c.Name)
		if len(code) != 2 {
			continue
		}
		out = append(out, HolidayCountry{Code: code, Name: name})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Code == out[j].Code {
			return out[i].Name < out[j].Name
		}
		return out[i].Code < out[j].Code
	})

	holidayCountriesCache.mu.Lock()
	holidayCountriesCache.fetchedAt = time.Now().Unix()
	holidayCountriesCache.items = out
	holidayCountriesCache.mu.Unlock()

	return out, nil
}

// NextPublicHoliday returns the next upcoming public holiday.
// When multiple countries are provided, returns the earliest upcoming holiday among them.
func NextPublicHoliday(ctx context.Context, countryCodes []string, now time.Time) (NextHoliday, error) {
	cc := normalizeCountryCodes(countryCodes)
	if len(cc) == 0 {
		return NextHoliday{}, errors.New("countries required")
	}

	nowUTC := now.UTC()
	today := time.Date(nowUTC.Year(), nowUTC.Month(), nowUTC.Day(), 0, 0, 0, 0, time.UTC)
	years := []int{today.Year(), today.Year() + 1}

	type candidate struct {
		Country string
		H       nagerHoliday
		Day     time.Time
	}
	var best *candidate

	for _, country := range cc {
		for _, year := range years {
			var list []nagerHoliday
			var err error
			if country == "CN" {
				list, err = fetchChinaOffDays(ctx, year)
			} else {
				list, err = fetchNagerPublicHolidays(ctx, year, country)
			}
			if err != nil {
				continue
			}
			for _, h := range list {
				day, err := parseISODateUTC(h.Date)
				if err != nil {
					continue
				}
				if day.Before(today) {
					continue
				}
				if best == nil || day.Before(best.Day) {
					copyH := h
					copyCountry := country
					best = &candidate{Country: copyCountry, H: copyH, Day: day}
				}
			}
		}
	}

	if best == nil {
		return NextHoliday{}, errors.New("no upcoming holiday")
	}

	days := int(best.Day.Sub(today).Hours() / 24)
	if days < 0 {
		days = 0
	}

	return NextHoliday{
		FetchedAt: time.Now().Unix(),
		Country:   best.Country,
		Date:      best.H.Date,
		Name:      best.H.Name,
		LocalName: best.H.LocalName,
		DaysUntil: days,
	}, nil
}

func fetchNagerPublicHolidays(ctx context.Context, year int, country string) ([]nagerHoliday, error) {
	country = strings.ToUpper(strings.TrimSpace(country))
	if country == "" || year <= 0 {
		return nil, errors.New("invalid country/year")
	}
	key := fmt.Sprintf("%s|%d", country, year)

	const ttl = 12 * time.Hour

	holidaysCache.mu.Lock()
	if v, ok := holidaysCache.items[key]; ok {
		age := time.Since(time.Unix(v.FetchedAt, 0))
		if v.FetchedAt > 0 && age >= 0 && age < ttl && len(v.List) > 0 {
			list := make([]nagerHoliday, len(v.List))
			copy(list, v.List)
			holidaysCache.mu.Unlock()
			return list, nil
		}
	}
	holidaysCache.mu.Unlock()

	endpoint := fmt.Sprintf("https://date.nager.at/api/v3/PublicHolidays/%d/%s", year, country)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Hearth/0.1")

	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("nagerdate: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var list []nagerHoliday
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return nil, err
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Date < list[j].Date })

	holidaysCache.mu.Lock()
	holidaysCache.items[key] = struct {
		FetchedAt int64
		List      []nagerHoliday
	}{FetchedAt: time.Now().Unix(), List: list}
	holidaysCache.mu.Unlock()

	return list, nil
}
