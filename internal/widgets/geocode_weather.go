package widgets

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

var ErrCityNotFound = errors.New("city not found")

var (
	weatherLocationCache = newWeatherLocationCache()
	citySearchCache      = newCitySearchCache()
)

func newWeatherLocationCache() *cache.Cache[GeoPoint] {
	c := cache.New[GeoPoint](30 * 24 * time.Hour)
	c.SetMaxStale(365 * 24 * time.Hour)
	c.SetLoadTimeout(6 * time.Second)
	return c
}

func newCitySearchCache() *cache.Cache[[]GeoPoint] {
	c := cache.New[[]GeoPoint](24 * time.Hour)
	c.SetMaxStale(30 * 24 * time.Hour)
	c.SetLoadTimeout(6 * time.Second)
	return c
}

func weatherLocationKey(city, language string) string {
	city = strings.ReplaceAll(city, "，", ",")
	parts := strings.Split(city, ",")
	for i := range parts {
		parts[i] = strings.ToLower(strings.Join(strings.Fields(parts[i]), " "))
	}
	return normalizeGeoLanguage(language) + ":" + strings.Join(parts, ",")
}

// ResolveWeatherLocation never enriches a location with a separate timezone request.
// A retained location can serve weather while its own refresh runs independently.
func ResolveWeatherLocation(ctx context.Context, city, language string, force ...bool) (GeoPoint, DataStatus, error) {
	if strings.TrimSpace(city) == "" {
		return GeoPoint{}, DataStatus{}, errors.New("city required")
	}
	key := weatherLocationKey(city, language)
	forceLookup := len(force) > 0 && force[0]
	if forceLookup {
		// Retry a failed cold lookup on demand, but never make a weather refresh
		// wait for geocoding when a usable location already exists.
		_, usable := weatherLocationCache.GetStale(key)
		forceLookup = !usable
	}
	point, state, err := weatherLocationCache.Load(ctx, key, func(ctx context.Context) (GeoPoint, error) {
		return lookupWeatherLocation(ctx, city, language)
	}, forceLookup)
	return point, statusFromCache(state), err
}

func lookupWeatherLocation(ctx context.Context, city, language string) (GeoPoint, error) {
	primaryCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	point, primaryErr := lookupWeatherOpenMeteo(primaryCtx, city, language)
	cancel()
	if primaryErr == nil {
		return point, nil
	}
	fallbackCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	results, fallbackErr := SearchCitiesNominatim(fallbackCtx, city, 1, language)
	if fallbackErr == nil && len(results) > 0 {
		return results[0], nil
	}
	return GeoPoint{}, cityLookupError(primaryErr, fallbackErr)
}

func cityLookupError(upstreamErrors ...error) error {
	var failures []error
	for _, err := range upstreamErrors {
		if err != nil && !errors.Is(err, ErrCityNotFound) {
			failures = append(failures, err)
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("city lookup unavailable: %w", errors.Join(failures...))
	}
	return ErrCityNotFound
}

func matchesCityQualifier(city string, result geoResult) bool {
	parts := strings.Split(strings.ReplaceAll(city, "，", ","), ",")
	for _, part := range parts[1:] {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		matched := false
		for _, value := range []string{result.Name, result.Admin1, result.Country, result.CountryCode} {
			if strings.EqualFold(part, strings.TrimSpace(value)) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	return true
}

func lookupWeatherOpenMeteo(ctx context.Context, city, language string) (GeoPoint, error) {
	parts := strings.Split(strings.ReplaceAll(city, "，", ","), ",")
	query := strings.TrimSpace(parts[0])
	if query == "" {
		return GeoPoint{}, errors.New("city required")
	}
	query = translateChineseQuery(query)
	lang := normalizeGeoLanguage(language)
	if len(parts) > 1 {
		// Match disambiguating region/country names in the stored label's language.
		lang = "en"
		if containsCJK(city) {
			lang = "zh"
		}
	}
	payload, err := fetchGeo(ctx, query, 20, lang)
	if err != nil {
		return GeoPoint{}, err
	}
	sort.SliceStable(payload.Results, func(i, j int) bool {
		return payload.Results[i].Population > payload.Results[j].Population
	})
	for _, result := range payload.Results {
		if !matchesCityQualifier(city, result) {
			continue
		}
		label := []string{strings.TrimSpace(result.Name)}
		if result.Admin1 != "" && result.Admin1 != result.Name {
			label = append(label, strings.TrimSpace(result.Admin1))
		}
		if result.Country != "" {
			label = append(label, strings.TrimSpace(result.Country))
		}
		return GeoPoint{
			Lat: *result.Latitude, Lon: *result.Longitude,
			DisplayName: strings.Join(label, ", "), Timezone: result.Timezone,
		}, nil
	}
	return GeoPoint{}, ErrCityNotFound
}

func SearchCitiesCached(ctx context.Context, query string, count int, language string) ([]GeoPoint, DataStatus, error) {
	if strings.TrimSpace(query) == "" {
		return nil, DataStatus{}, errors.New("city required")
	}
	if count <= 0 {
		count = 8
	}
	if count > 20 {
		count = 20
	}
	key := fmt.Sprintf("%s:%d", weatherLocationKey(query, language), count)
	results, state, err := citySearchCache.Load(ctx, key, func(ctx context.Context) ([]GeoPoint, error) {
		primaryCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		results, primaryErr := SearchCitiesNominatim(primaryCtx, query, count, language)
		cancel()
		if primaryErr != nil {
			var fallbackErr error
			results, fallbackErr = SearchCitiesOpenMeteo(ctx, query, count, language)
			if fallbackErr != nil {
				return nil, cityLookupError(primaryErr, fallbackErr)
			}
		}
		for _, result := range results {
			// Cache complete display labels, not ambiguous bare names.
			weatherLocationCache.Set(weatherLocationKey(result.DisplayName, language), result)
		}
		return results, nil
	})
	return results, statusFromCache(state), err
}
