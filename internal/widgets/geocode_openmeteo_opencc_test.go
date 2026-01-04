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
