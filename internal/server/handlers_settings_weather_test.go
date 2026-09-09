package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func putWeatherSettingsForTest(s *Server, weatherJSON string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	s.handlePutSettings(w, httptest.NewRequest(http.MethodPut, "/api/settings", strings.NewReader(`{"weather":`+weatherJSON+`}`)))
	return w
}

func TestWeatherSettingsSelectedCoordinatesRoundTrip(t *testing.T) {
	s := newWeatherHandlerServer(t)
	w := putWeatherSettingsForTest(s, `{"city":"Selected City","lat":0,"lon":121.4737}`)
	if w.Code != http.StatusOK {
		t.Fatalf("cannot save selected coordinates: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	s.handleGetSettings(w, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	var settings Settings
	if err := json.Unmarshal(w.Body.Bytes(), &settings); err != nil {
		t.Fatal(err)
	}
	if settings.Weather.City != "Selected City" || settings.Weather.Lat == nil || *settings.Weather.Lat != 0 ||
		settings.Weather.Lon == nil || *settings.Weather.Lon != 121.4737 {
		t.Fatalf("optional numeric coordinates did not round trip: %+v", settings.Weather)
	}
	for _, entry := range [][2]string{{kvWeatherLat, "0"}, {kvWeatherLon, "121.4737"}} {
		if got := s.getStringSetting(entry[0], ""); got != entry[1] {
			t.Fatalf("not persisted in existing key %s: %q", entry[0], got)
		}
	}
}

func TestWeatherSettingsUnchangedCityOnlyPreservesCoordinates(t *testing.T) {
	s := newWeatherHandlerServer(t)
	for _, body := range []string{`{"city":"Original","lat":12.5,"lon":-70.1}`, `{"city":" Original "}`} {
		if w := putWeatherSettingsForTest(s, body); w.Code != http.StatusOK {
			t.Fatal(w.Body.String())
		}
	}
	settings := s.weatherSettings()
	if settings.Lat == nil || *settings.Lat != 12.5 || settings.Lon == nil || *settings.Lon != -70.1 {
		t.Fatalf("city-only compatibility save erased coordinates: %+v", settings)
	}
}

func TestWeatherSettingsChangedCityClearsObsoleteCoordinates(t *testing.T) {
	s := newWeatherHandlerServer(t)
	for _, body := range []string{`{"city":"Original","lat":12.5,"lon":-70.1}`, `{"city":"New City"}`} {
		if w := putWeatherSettingsForTest(s, body); w.Code != http.StatusOK {
			t.Fatal(w.Body.String())
		}
	}
	settings := s.weatherSettings()
	if settings.City != "New City" || settings.Lat != nil || settings.Lon != nil {
		t.Fatalf("new city kept obsolete coordinates: %+v", settings)
	}
	for _, key := range []string{kvWeatherLat, kvWeatherLon} {
		if got := s.getStringSetting(key, ""); got != "" {
			t.Fatalf("obsolete KV coordinates remain: %s=%s", key, got)
		}
	}
	if w := putWeatherSettingsForTest(s, `{"city":"Third City","lat":-90,"lon":180}`); w.Code != http.StatusOK {
		t.Fatal(w.Body.String())
	}
	settings = s.weatherSettings()
	if settings.City != "Third City" || settings.Lat == nil || *settings.Lat != -90 || settings.Lon == nil || *settings.Lon != 180 {
		t.Fatalf("new selection did not replace coordinates: %+v", settings)
	}
}

func TestWeatherSettingsRejectInvalidCoordinatesBeforeSaving(t *testing.T) {
	s := newWeatherHandlerServer(t)
	if w := putWeatherSettingsForTest(s, `{"city":"Original","lat":1,"lon":2}`); w.Code != http.StatusOK {
		t.Fatal(w.Body.String())
	}
	for _, body := range []string{
		`{"city":"Invalid","lat":1}`, `{"city":"Invalid","lon":2}`,
		`{"city":"Invalid","lat":null,"lon":2}`, `{"city":"Invalid","lat":91,"lon":2}`,
		`{"city":"Invalid","lat":1,"lon":-181}`, `{"city":"Invalid","lat":"1","lon":2}`,
		`{"city":"Invalid","lat":1e309,"lon":2}`,
	} {
		w := putWeatherSettingsForTest(s, body)
		if w.Code != http.StatusBadRequest {
			t.Errorf("invalid coordinates accepted: %s => %d", body, w.Code)
		}
		settings := s.weatherSettings()
		if settings.City != "Original" || settings.Lat == nil || *settings.Lat != 1 || settings.Lon == nil || *settings.Lon != 2 {
			t.Fatalf("invalid input partially mutated settings: %+v", settings)
		}
	}
}

func TestWeatherSettingsCityOnlyAndInvalidLegacyCoordinates(t *testing.T) {
	s := newWeatherHandlerServer(t)
	if w := putWeatherSettingsForTest(s, `{"city":"Legacy City"}`); w.Code != http.StatusOK {
		t.Fatal(w.Body.String())
	}
	for _, coordinates := range [][2]string{{"", ""}, {"NaN", "1"}, {"1", ""}, {"91", "2"}} {
		if err := s.store.SetKV(kvWeatherLat, coordinates[0]); err != nil {
			t.Fatal(err)
		}
		if err := s.store.SetKV(kvWeatherLon, coordinates[1]); err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		s.handleGetSettings(w, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
		var settings Settings
		if err := json.Unmarshal(w.Body.Bytes(), &settings); err != nil {
			t.Fatal(err)
		}
		if settings.Weather.City != "Legacy City" || settings.Weather.Lat != nil || settings.Weather.Lon != nil {
			t.Fatalf("invalid stored coordinates exposed: %+v", settings.Weather)
		}
	}
}
