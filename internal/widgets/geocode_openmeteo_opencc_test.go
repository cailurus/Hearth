package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func setupLocalizedCityFixtures(t *testing.T) {
	t.Helper()
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "nominatim.openstreetmap.org" {
			return nil, errors.New("city suggestions must not fetch forecast/timezone data")
		}
		cities := map[string][4]string{
			"london":    {"London", "伦敦", "England", "英格兰;英格蘭"},
			"changchun": {"Changchun", "长春", "Jilin", "吉林省"},
			"beijing":   {"Beijing", "北京", "Beijing", "北京"},
			"shanghai":  {"Shanghai", "上海", "Shanghai", "上海"},
			"shenzhen":  {"Shenzhen", "深圳", "Guangdong", "广东省"},
		}
		entry, ok := cities[strings.ToLower(req.URL.Query().Get("q"))]
		if !ok {
			return weatherTestResponse(`[]`)
		}
		name, region := entry[0], entry[2]
		if strings.HasPrefix(req.URL.Query().Get("accept-language"), "zh") {
			name, region = entry[1], entry[3]
		}
		body, _ := json.Marshal([]nominatimResult{{
			PlaceID: 1, Lat: "43.88", Lon: "125.32", Name: name,
			Address: nominatimAddr{State: region, Country: "Country"},
		}})
		return weatherTestResponse(string(body))
	})
}

func TestSearchCitiesZhUsesSimplifiedCityName(t *testing.T) {
	setupLocalizedCityFixtures(t)
	list, err := SearchCities(context.Background(), "London", 1, "zh")
	if err != nil {
		t.Fatalf("SearchCities error: %v", err)
	}
	if len(list) == 0 {
		t.Fatalf("expected results")
	}
	if strings.Contains(list[0].DisplayName, "倫敦") {
		t.Fatalf("expected simplified city name, got %q", list[0].DisplayName)
	}
}

func TestSearchCitiesChangchun(t *testing.T) {
	setupLocalizedCityFixtures(t)
	// Test that searching "长春" returns Changchun in Jilin as a top result
	// The major city (population ~4.7M) should be prioritized over villages
	testCases := []struct {
		query    string
		language string
	}{
		{"长春", "zh"},
		{"changchun", "zh"},
		{"changchun", "en"},
	}

	for _, tc := range testCases {
		t.Run(tc.query+"_"+tc.language, func(t *testing.T) {
			list, err := SearchCities(context.Background(), tc.query, 5, tc.language)
			if err != nil {
				t.Fatalf("SearchCities error: %v", err)
			}
			if len(list) == 0 {
				t.Fatalf("expected results")
			}

			// The first result should be the major city in Jilin
			first := list[0].DisplayName
			if tc.language == "zh" {
				// Should contain 吉林 (Jilin in Chinese)
				if !strings.Contains(first, "吉林") {
					t.Errorf("expected first result to be in Jilin (吉林), got %q", first)
				}
			} else {
				// Should contain Jilin
				if !strings.Contains(first, "Jilin") {
					t.Errorf("expected first result to be in Jilin, got %q", first)
				}
			}
		})
	}
}

func TestSearchCitiesBilingual(t *testing.T) {
	setupLocalizedCityFixtures(t)
	// Test that English pinyin search works for Chinese cities
	testCases := []struct {
		query       string
		expectCity  string // Partial match
		expectAdmin string // Partial match
	}{
		{"beijing", "Beijing", ""},
		{"shanghai", "Shanghai", ""},
		{"shenzhen", "Shenzhen", "Guangdong"},
	}

	for _, tc := range testCases {
		t.Run(tc.query, func(t *testing.T) {
			list, err := SearchCities(context.Background(), tc.query, 3, "en")
			if err != nil {
				t.Fatalf("SearchCities error: %v", err)
			}
			if len(list) == 0 {
				t.Fatalf("expected results for %q", tc.query)
			}
			first := list[0].DisplayName
			if !strings.Contains(first, tc.expectCity) {
				t.Errorf("expected %q in result, got %q", tc.expectCity, first)
			}
			if tc.expectAdmin != "" && !strings.Contains(first, tc.expectAdmin) {
				t.Errorf("expected %q in result, got %q", tc.expectAdmin, first)
			}
		})
	}
}

func TestSearchCitiesOpenMeteoMergesSimplifiedNames(t *testing.T) {
	setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "nominatim.openstreetmap.org" {
			return nil, errors.New("nominatim unavailable")
		}
		name, admin := "London", "England"
		switch req.URL.Query().Get("language") {
		case "zh":
			name, admin = "倫敦", "英格兰"
		case "zh-CN":
			name, admin = "伦敦", "England"
		}
		body, _ := json.Marshal(map[string]any{"results": []map[string]any{{
			"id": 1, "name": name, "admin1": admin, "latitude": 51.5, "longitude": -0.12,
			"population": 8000000, "country": "United Kingdom",
		}}})
		return weatherTestResponse(string(body))
	})
	list, err := SearchCities(context.Background(), "London", 1, "zh")
	if err != nil || len(list) != 1 || !strings.Contains(list[0].DisplayName, "伦敦, 英格兰") {
		t.Fatalf("localized merge failed: %+v, %v", list, err)
	}
}

func TestSearchCitiesSelectionSeedsWeatherLocation(t *testing.T) {
	setupLocalizedCityFixtures(t)
	list, err := SearchCities(context.Background(), "changchun", 3, "en")
	if err != nil {
		t.Fatal(err)
	}
	DefaultClient = &http.Client{Transport: weatherTestTransport(func(req *http.Request) (*http.Response, error) {
		return nil, errors.New("selected location should already be cached")
	})}
	point, _, err := ResolveWeatherLocation(context.Background(), list[0].DisplayName, "en")
	if err != nil || point.Lat != list[0].Lat || point.Lon != list[0].Lon {
		t.Fatalf("selected location was resolved again: %+v, %v", point, err)
	}
}

func TestGeocodingRejectsMissingOrInvalidCoordinates(t *testing.T) {
	for _, body := range []string{
		`{"results":[{"id":1,"name":"Invalid","latitude":null,"longitude":2}]}`,
		`{"results":[{"id":1,"name":"Invalid","latitude":91,"longitude":2}]}`,
	} {
		t.Run(body, func(t *testing.T) {
			setupWeatherTest(t, func(req *http.Request) (*http.Response, error) {
				if req.URL.Host == "nominatim.openstreetmap.org" {
					return weatherTestResponse(`[{"place_id":1,"name":"Invalid","lat":"NaN","lon":"2"}]`)
				}
				return weatherTestResponse(body)
			})
			_, _, err := ResolveWeatherLocation(context.Background(), "Invalid", "en")
			if err == nil || errors.Is(err, ErrCityNotFound) {
				t.Fatalf("invalid upstream coordinates were accepted or reported as not found: %v", err)
			}
		})
	}
}
