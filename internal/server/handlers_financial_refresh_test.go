package server

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/morezhou/hearth/internal/widgets"
)

func TestFinancialMarketHandlerRefreshFlags(t *testing.T) {
	for _, flag := range []string{"refresh", "nocache"} {
		t.Run(flag, func(t *testing.T) {
			id := financialHandlerTestID.Add(1)
			symbols := []string{
				fmt.Sprintf("FORCEA%d", id), fmt.Sprintf("FORCEB%d", id),
				fmt.Sprintf("FORCEC%d", id), fmt.Sprintf("FORCED%d", id),
			}
			s := &Server{}
			oldClient := widgets.DefaultClient
			t.Cleanup(func() { widgets.DefaultClient = oldClient })
			var calls, price atomic.Int32
			price.Store(110)
			widgets.DefaultClient = &http.Client{Transport: financialHandlerTransport(func(r *http.Request) (*http.Response, error) {
				calls.Add(1)
				current := price.Load()
				body := fmt.Sprintf(`{"chart":{"result":[{"meta":{"regularMarketPrice":%d,"regularMarketTime":1700000900,"currency":"USD","previousClose":100},"timestamp":[1700000000,1700000900],"indicators":{"quote":[{"close":[100,%d]}]}}],"error":null}}`, current, current)
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
			})}
			waitForRows := func(want float64) {
				t.Helper()
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				for ctx.Err() == nil {
					res, err := widgets.FetchMarkets(ctx, symbols)
					if err != nil {
						t.Fatal(err)
					}
					if !res.Refreshing {
						for _, row := range res.Items {
							if row.Pending || row.Price != want {
								t.Fatalf("handler did not force fresh quote: %#v, want %v", row, want)
							}
						}
						return
					}
					time.Sleep(20 * time.Millisecond)
				}
				t.Fatal("forced handler loads did not finish")
			}
			waitForRows(110)
			if calls.Load() != 4 {
				t.Fatalf("unexpected initial calls: %d", calls.Load())
			}
			price.Store(120)
			w := httptest.NewRecorder()
			requestURL := "/api/widgets/markets?symbols=" + strings.Join(symbols, ",") + "&" + flag + "=1"
			s.handleGetMarkets(w, httptest.NewRequest(http.MethodGet, requestURL, nil))
			if w.Code != http.StatusOK {
				t.Fatalf("forced handler failed: %d %s", w.Code, w.Body.String())
			}
			waitForRows(120)
			if calls.Load() != 8 {
				t.Fatalf("%s did not bypass fresh cache: calls=%d", flag, calls.Load())
			}
		})
	}
}
