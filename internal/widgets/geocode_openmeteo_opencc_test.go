package widgets

import (
	"context"
	"strings"
	"testing"
)

func TestSearchCitiesZhUsesSimplifiedCityName(t *testing.T) {
	// Open-Meteo currently returns Traditional for London under language=zh.
	// We merge with zh-CN to guarantee Simplified.
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
