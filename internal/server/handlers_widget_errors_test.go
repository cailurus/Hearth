package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/morezhou/hearth/internal/widgets"
)

type failedWidgetTransport struct{}

func (failedWidgetTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return &http.Response{
		StatusCode: http.StatusNotFound,
		Status:     "404 Not Found",
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(`{"error":"unavailable"}`)),
		Request:    req,
	}, nil
}

func TestWidgetProviderFailuresReturnErrors(t *testing.T) {
	previous := widgets.DefaultClient
	widgets.DefaultClient = &http.Client{Transport: failedWidgetTransport{}}
	t.Cleanup(func() { widgets.DefaultClient = previous })
	s := newTestServer(t)
	for _, path := range []string{
		"/api/widgets/currency?pairs=USD-ZZZ",
		"/api/widgets/rss?feed=https%3A%2F%2Fwidget-error.example%2Fmissing",
	} {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			s.Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
			if w.Code != http.StatusBadGateway {
				t.Fatalf("expected provider error, got %d: %s", w.Code, w.Body.String())
			}
			var body struct {
				Error string `json:"error"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Error == "" {
				t.Fatalf("missing visible error: %s", w.Body.String())
			}
		})
	}
}

func TestInvalidRSSURLIsNotSilentlyIgnored(t *testing.T) {
	s := newTestServer(t)
	w := httptest.NewRecorder()
	s.Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/widgets/rss?feed=not-a-url", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid feed returned %d: %s", w.Code, w.Body.String())
	}
}
