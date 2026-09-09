package widgets

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/morezhou/hearth/internal/cache"
)

type MarketQuote struct {
	Symbol       string    `json:"symbol"`
	Kind         string    `json:"kind"` // "stock" | "crypto"
	Name         string    `json:"name,omitempty"`
	Price        float64   `json:"price"`
	PriceUSD     float64   `json:"priceUsd,omitempty"` // compatibility alias, only for USD quotes
	Currency     string    `json:"currency"`
	ObservedAt   int64     `json:"observedAt"`
	FetchedAt    int64     `json:"fetchedAt"`
	Source       string    `json:"source"`
	Error        string    `json:"error,omitempty"`
	Stale        bool      `json:"stale,omitempty"`
	Pending      bool      `json:"pending,omitempty"`
	ChangePct24h float64   `json:"changePct24h"`
	Series       []float64 `json:"series"`
	TotalSlots   int       `json:"totalSlots,omitempty"` // full trading day slot count (for partial charts)
}

type MarketsResponse struct {
	DataStatus
	FetchedAt int64         `json:"fetchedAt"`
	Items     []MarketQuote `json:"items"`
}

type MarketSymbol struct {
	Symbol string `json:"symbol"`
	Kind   string `json:"kind"` // "stock" | "crypto"
	Name   string `json:"name"`
	Market string `json:"market"` // "US" | "HK" | "" (crypto has no market)
}

var defaultMarketSymbols = []string{"BTC", "ETH", "AAPL", "MSFT"}

var marketsTTLCache = newMarketsCache()

func newMarketsCache() *cache.Cache[MarketQuote] {
	c := cache.New[MarketQuote](5 * time.Minute)
	c.SetMaxStale(24 * time.Hour)
	c.SetLoadTimeout(financialLoadTimeout)
	return c
}

func newFinancialSearchCache[T any]() *cache.Cache[T] {
	c := cache.New[T](10 * time.Minute)
	c.SetMaxStale(24 * time.Hour)
	c.SetLoadTimeout(12 * time.Second)
	return c
}

var yahooSearchTTLCache = newFinancialSearchCache[[]MarketSymbol]()
var coinGeckoSearchTTLCache = newFinancialSearchCache[[]coinGeckoSearchCoin]()

type coinGeckoAPIKeyContextKey struct{}

// WithCoinGeckoAPIKey enables CoinGecko's optional Demo plan, without changing
// the account-free Yahoo primary or the account-free CoinGecko fallback.
func WithCoinGeckoAPIKey(ctx context.Context, key string) context.Context {
	return context.WithValue(ctx, coinGeckoAPIKeyContextKey{}, strings.TrimSpace(key))
}

func coinGeckoAPIKey(ctx context.Context) string {
	key, _ := ctx.Value(coinGeckoAPIKeyContextKey{}).(string)
	return key
}

func coinGeckoScope(ctx context.Context) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(coinGeckoAPIKey(ctx))))
}

type coinGeckoSymbolEntry struct {
	ID   string
	Name string
}

var coinGeckoSymbolTTLCache = cache.New[coinGeckoSymbolEntry](7 * 24 * time.Hour)

func normalizeSymbols(in []string) []string {
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, raw := range in {
		s := strings.TrimSpace(raw)
		if s == "" {
			continue
		}
		// Allow "BTC-USD" but keep the raw for display, normalize for matching.
		s = strings.ToUpper(s)
		if seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	// Enforce exactly 4 symbols (cannot increase or decrease).
	for _, d := range defaultMarketSymbols {
		if len(out) >= 4 {
			break
		}
		if seen[d] {
			continue
		}
		seen[d] = true
		out = append(out, d)
	}
	if len(out) > 4 {
		out = out[:4]
	}
	// If still short (e.g., all defaults were already duplicates), pad with BTC/ETH.
	for len(out) < 4 {
		out = append(out, defaultMarketSymbols[len(out)%len(defaultMarketSymbols)])
	}
	return out
}

var popularCryptoSymbols = map[string]bool{
	"BTC":   true,
	"ETH":   true,
	"SOL":   true,
	"BNB":   true,
	"XRP":   true,
	"ADA":   true,
	"DOGE":  true,
	"DOT":   true,
	"LTC":   true,
	"AVAX":  true,
	"MATIC": true,
	"TRX":   true,
	"LINK":  true,
	"UNI":   true,
	"ATOM":  true,
	"BCH":   true,
	"ETC":   true,
	"XLM":   true,
	"FIL":   true,
}

var cryptoFullNames = map[string]string{
	"BTC":   "Bitcoin",
	"ETH":   "Ethereum",
	"SOL":   "Solana",
	"BNB":   "BNB",
	"XRP":   "XRP",
	"ADA":   "Cardano",
	"DOGE":  "Dogecoin",
	"DOT":   "Polkadot",
	"LTC":   "Litecoin",
	"AVAX":  "Avalanche",
	"MATIC": "Polygon",
	"TRX":   "TRON",
	"LINK":  "Chainlink",
	"UNI":   "Uniswap",
	"ATOM":  "Cosmos",
	"BCH":   "Bitcoin Cash",
	"ETC":   "Ethereum Classic",
	"XLM":   "Stellar",
	"FIL":   "Filecoin",
}

// yahooFinanceSearch searches Yahoo Finance for stock/ETF symbols by query.
// Returns results with full company name, exchange info, and normalized symbol.
func yahooFinanceSearch(ctx context.Context, query string, limit int) ([]MarketSymbol, error) {
	key := strings.ToLower(strings.TrimSpace(query)) + ":" + strconv.Itoa(limit)
	items, state, err := yahooSearchTTLCache.Load(ctx, key, func(ctx context.Context) ([]MarketSymbol, error) {
		return loadYahooFinanceSearch(ctx, query, limit)
	})
	return items, errors.Join(err, state.Err)
}

func loadYahooFinanceSearch(ctx context.Context, query string, limit int) ([]MarketSymbol, error) {
	if limit <= 0 {
		limit = 8
	}
	q := url.Values{}
	q.Set("q", query)
	q.Set("quotesCount", strconv.Itoa(limit))
	q.Set("newsCount", "0")
	endpoint := "https://query2.finance.yahoo.com/v1/finance/search?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	body, _, status, err := financialRequest(ctx, req)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("yahoo search: status=%d", status)
	}

	var payload struct {
		Quotes []struct {
			Symbol    string `json:"symbol"`
			LongName  string `json:"longname"`
			ShortName string `json:"shortname"`
			Exchange  string `json:"exchange"`
			ExchDisp  string `json:"exchDisp"`
			QuoteType string `json:"quoteType"`
		} `json:"quotes"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if payload.Quotes == nil {
		return nil, errors.New("yahoo search: missing quotes")
	}

	results := make([]MarketSymbol, 0)
	for _, q := range payload.Quotes {
		if q.QuoteType != "EQUITY" && q.QuoteType != "ETF" {
			continue
		}

		sym := strings.TrimSpace(q.Symbol)
		name := strings.TrimSpace(q.LongName)
		if name == "" {
			name = strings.TrimSpace(q.ShortName)
		}

		// Determine market from exchange
		market := "US"
		exchUp := strings.ToUpper(q.Exchange)
		if exchUp == "HKG" || strings.Contains(strings.ToUpper(q.ExchDisp), "HONG KONG") {
			market = "HK"
			// Normalize Yahoo's "0700.HK" → "0700" for display
			sym = strings.TrimSuffix(sym, ".HK")
		} else if strings.HasSuffix(sym, ".HK") {
			market = "HK"
			sym = strings.TrimSuffix(sym, ".HK")
		}

		results = append(results, MarketSymbol{
			Symbol: sym,
			Kind:   "stock",
			Name:   name,
			Market: market,
		})
		if len(results) >= limit {
			break
		}
	}
	return results, nil
}

// isHKStock checks if a symbol looks like a Hong Kong stock (numeric code).
func isHKStock(sym string) bool {
	s := strings.TrimSpace(strings.ToUpper(sym))
	s = strings.TrimPrefix(s, "HK:")
	s = strings.TrimSuffix(s, ".HK")
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func isCryptoSymbol(symUpper string) bool {
	s := strings.TrimSpace(strings.ToUpper(symUpper))
	if s == "" {
		return false
	}
	// HK stocks are numeric — don't treat them as crypto
	if isHKStock(s) {
		return false
	}
	if strings.HasPrefix(s, "CRYPTO:") {
		return true
	}
	if strings.HasSuffix(s, "-USD") {
		return true
	}
	if popularCryptoSymbols[s] {
		return true
	}
	return false
}

func stripCryptoPrefix(symUpper string) string {
	s := strings.TrimSpace(strings.ToUpper(symUpper))
	s = strings.TrimSpace(strings.TrimPrefix(s, "CRYPTO:"))
	return strings.TrimSuffix(s, "-USD")
}

// Yahoo Finance rate limiter: ensures minimum interval between requests.
var yahooLimiter struct {
	mu   sync.Mutex
	last time.Time
}

func yahooRateWait(ctx context.Context) error {
	const minInterval = 200 * time.Millisecond
	for {
		yahooLimiter.mu.Lock()
		wait := time.Until(yahooLimiter.last.Add(minInterval))
		if wait <= 0 {
			yahooLimiter.last = time.Now()
			yahooLimiter.mu.Unlock()
			return ctx.Err()
		}
		yahooLimiter.mu.Unlock()
		timer := time.NewTimer(wait)
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		}
	}
}

// toYahooSymbol converts internal symbol to Yahoo Finance format.
func toYahooSymbol(sym string, isCrypto bool) string {
	s := strings.TrimSpace(strings.ToUpper(sym))
	if isCrypto {
		return stripCryptoPrefix(s) + "-USD"
	}
	if isHKStock(s) {
		s = strings.TrimPrefix(s, "HK:")
		s = strings.TrimSuffix(s, ".HK")
		return s + ".HK"
	}
	return s
}

// fetchYahooChart fetches price and historical data from Yahoo Finance chart API.
func fetchYahooChart(ctx context.Context, symbol string, isCrypto bool) (MarketQuote, error) {
	if err := yahooRateWait(ctx); err != nil {
		return MarketQuote{}, err
	}

	yahooSym := toYahooSymbol(symbol, isCrypto)
	// Stocks need prior sessions across weekends; crypto needs a rolling 24h
	// window, not five days labeled as a daily chart.
	q := url.Values{}
	if isCrypto {
		now := time.Now()
		q.Set("period1", strconv.FormatInt(now.Add(-48*time.Hour).Unix(), 10))
		q.Set("period2", strconv.FormatInt(now.Unix(), 10))
	} else {
		q.Set("range", "5d")
	}
	q.Set("interval", "15m")
	q.Set("includePrePost", "false")
	endpoint := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?%s",
		url.PathEscape(yahooSym), q.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return MarketQuote{}, err
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	body, _, status, err := financialRequest(ctx, req)
	if err != nil {
		return MarketQuote{}, err
	}
	if status != http.StatusOK {
		return MarketQuote{}, fmt.Errorf("yahoo chart: status=%d", status)
	}
	return decodeYahooChart(body, symbol, isCrypto, time.Now())
}

func decodeYahooChart(body []byte, symbol string, isCrypto bool, now time.Time) (MarketQuote, error) {
	var payload struct {
		Chart struct {
			Result []struct {
				Meta struct {
					Symbol               string  `json:"symbol"`
					ShortName            string  `json:"shortName"`
					LongName             string  `json:"longName"`
					RegularMarketPrice   float64 `json:"regularMarketPrice"`
					RegularMarketTime    int64   `json:"regularMarketTime"`
					Currency             string  `json:"currency"`
					PreviousClose        float64 `json:"previousClose"`
					ChartPreviousClose   float64 `json:"chartPreviousClose"`
					CurrentTradingPeriod struct {
						Regular struct {
							Start int64 `json:"start"`
							End   int64 `json:"end"`
						} `json:"regular"`
					} `json:"currentTradingPeriod"`
				} `json:"meta"`
				Timestamp  []int64 `json:"timestamp"`
				Indicators struct {
					Quote []struct {
						Close []*float64 `json:"close"`
					} `json:"quote"`
				} `json:"indicators"`
			} `json:"result"`
			Error *struct {
				Code        string `json:"code"`
				Description string `json:"description"`
			} `json:"error"`
		} `json:"chart"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return MarketQuote{}, err
	}
	if payload.Chart.Error != nil {
		return MarketQuote{}, fmt.Errorf("yahoo chart: %s: %s",
			payload.Chart.Error.Code, payload.Chart.Error.Description)
	}
	if len(payload.Chart.Result) == 0 {
		return MarketQuote{}, errors.New("yahoo chart: no result")
	}

	result := payload.Chart.Result[0]
	meta := result.Meta

	price := meta.RegularMarketPrice
	currency := strings.ToUpper(strings.TrimSpace(meta.Currency))
	unitScale := 1.0
	switch strings.TrimSpace(meta.Currency) {
	case "GBp", "GBX":
		currency, unitScale = "GBP", 0.01
	case "ZAc":
		currency, unitScale = "ZAR", 0.01
	case "ILA":
		currency, unitScale = "ILS", 0.01
	}
	if !validFinancialValue(price) || !validCurrencyCode(currency) {
		return MarketQuote{}, errors.New("yahoo chart: missing valid price or currency")
	}

	name := strings.TrimSpace(meta.LongName)
	if name == "" {
		name = strings.TrimSpace(meta.ShortName)
	}

	kind := "stock"
	displaySym := strings.ToUpper(strings.TrimSpace(symbol))
	if isCrypto {
		kind = "crypto"
		displaySym = stripCryptoPrefix(displaySym)
		if name == "" {
			if n, ok := cryptoFullNames[displaySym]; ok {
				name = n
			}
		}
	}

	timestamps := result.Timestamp
	var allCloses []*float64
	if len(result.Indicators.Quote) > 0 {
		allCloses = result.Indicators.Quote[0].Close
	}

	type point struct {
		time  int64
		price float64
	}
	points := make([]point, 0, len(timestamps))
	for i, ts := range timestamps {
		if i < len(allCloses) && allCloses[i] != nil && validFinancialValue(*allCloses[i]) && ts > 0 && ts <= now.Unix() {
			points = append(points, point{ts, *allCloses[i]})
		}
	}
	if len(points) == 0 {
		return MarketQuote{}, errors.New("yahoo chart: missing timestamped series")
	}
	observedAt := meta.RegularMarketTime
	if observedAt <= 0 {
		observedAt = points[len(points)-1].time
	}
	var closes []float64
	var totalSlots int
	prevClose := meta.PreviousClose
	if isCrypto {
		cutoff := observedAt - 24*3600
		prevClose = 0
		for _, p := range points {
			if p.time <= cutoff {
				prevClose = p.price
			}
			if p.time >= cutoff && p.time <= observedAt {
				closes = append(closes, p.price)
			}
		}
		if !validFinancialValue(prevClose) {
			return MarketQuote{}, errors.New("yahoo chart: missing 24h baseline")
		}
	} else {
		// Yahoo's 5d chartPreviousClose is the start of the chart, not
		// necessarily yesterday. Prefer explicit previousClose, then the
		// actual close of the session preceding the quote's session.
		sessions := [][]point{{points[0]}}
		for _, p := range points[1:] {
			last := sessions[len(sessions)-1]
			if p.time-last[0].time >= 12*3600 {
				sessions = append(sessions, []point{p})
			} else {
				sessions[len(sessions)-1] = append(last, p)
			}
		}
		latest := sessions[len(sessions)-1]
		for _, p := range latest {
			closes = append(closes, p.price)
		}
		if !validFinancialValue(prevClose) && len(sessions) > 1 {
			prior := sessions[len(sessions)-2]
			prevClose = prior[len(prior)-1].price
		}
		if !validFinancialValue(prevClose) {
			prevClose = meta.ChartPreviousClose
		}
		regStart := meta.CurrentTradingPeriod.Regular.Start
		regEnd := meta.CurrentTradingPeriod.Regular.End
		if now.Unix() >= regStart && now.Unix() < regEnd && latest[0].time >= regStart {
			totalSlots = int((regEnd - regStart) / 900)
		}
	}
	if len(closes) == 0 || !validFinancialValue(prevClose) {
		return MarketQuote{}, errors.New("yahoo chart: missing series or previous close")
	}
	changePct := (price - prevClose) / prevClose * 100
	series := sampleFinancialSeries(closes, 30)
	// Yahoo occasionally quotes minor units; expose ISO major units, never
	// relabel pence as pounds (or convert foreign currency to USD).
	price *= unitScale
	for i := range series {
		series[i] *= unitScale
	}
	if totalSlots > 0 {
		totalSlots = int(math.Ceil(float64(totalSlots) * float64(len(series)) / float64(len(closes))))
		if totalSlots < len(series) {
			totalSlots = len(series)
		}
	}
	legacyUSD := 0.0
	if currency == "USD" {
		legacyUSD = price
	}

	return MarketQuote{
		Symbol:       displaySym,
		Kind:         kind,
		Name:         name,
		Price:        price,
		PriceUSD:     legacyUSD,
		Currency:     currency,
		ObservedAt:   observedAt,
		FetchedAt:    now.Unix(),
		Source:       "yahoo",
		ChangePct24h: changePct,
		Series:       series,
		TotalSlots:   totalSlots,
	}, nil
}

func fetchMarketQuote(ctx context.Context, symbol string, crypto, force bool) (MarketQuote, error) {
	if !crypto {
		return fetchYahooChart(ctx, symbol, false)
	}
	// Keep at least half of a short loader budget available to CoinGecko.
	// Cancel only Yahoo's child: the fallback still needs the original context.
	yahooTimeout := 5 * time.Second
	if deadline, ok := ctx.Deadline(); ok {
		yahooTimeout = min(yahooTimeout, time.Until(deadline)/2)
	}
	yahooCtx, cancelYahoo := context.WithTimeout(ctx, yahooTimeout)
	quote, yahooErr := fetchYahooChart(yahooCtx, symbol, true)
	cancelYahoo()
	if yahooErr == nil {
		return quote, nil
	}
	items, cgErr := fetchCoinGecko(ctx, []string{symbol}, force)
	if cgErr != nil {
		return MarketQuote{}, errors.Join(yahooErr, cgErr)
	}
	if len(items) != 1 {
		return MarketQuote{}, errors.New("coingecko: missing requested quote")
	}
	return items[0], nil
}

// FetchMarkets fetches market data from Yahoo Finance (primary) with CoinGecko
// fallback for crypto. Results are cached for ~5 minutes.
func FetchMarkets(ctx context.Context, symbols []string, force ...bool) (MarketsResponse, error) {
	symbols = normalizeSymbols(symbols)
	forced := len(force) > 0 && force[0]
	out := MarketsResponse{Items: make([]MarketQuote, len(symbols))}
	loads := make([]financialLoad[MarketQuote], len(symbols))
	for i, s := range symbols {
		crypto := isCryptoSymbol(s)
		kind, display := "stock", s
		if crypto {
			kind, display = "crypto", stripCryptoPrefix(s)
		}
		out.Items[i] = MarketQuote{Symbol: display, Kind: kind}
		if !validMarketSymbol(s) {
			out.Items[i].Error = "invalid market symbol"
			continue
		}
		key := kind + ":" + toYahooSymbol(s, crypto)
		if crypto {
			key += ":" + coinGeckoScope(ctx)
		}
		loads[i] = financialLoad[MarketQuote]{
			key: key,
			loader: func(ctx context.Context) (MarketQuote, error) {
				return fetchMarketQuote(ctx, s, crypto, forced)
			},
		}
	}
	results := loadFinancialRows(ctx, marketsTTLCache, loads, func(row MarketQuote) bool {
		return validFinancialValue(row.Price)
	}, forced)

	available := 0
	var warnings []string
	for i, result := range results {
		row := out.Items[i]
		if validFinancialValue(result.value.Price) {
			symbol := row.Symbol
			row = result.value
			row.Symbol = symbol
		}
		if result.err != nil {
			row.Error = result.err.Error()
		} else if result.state.Err != nil {
			row.Error = result.state.Err.Error()
		}
		row.Stale = result.state.Stale
		row.Pending = result.pending && !validFinancialValue(row.Price)
		out.Items[i] = row
		status := statusFromCache(result.state)
		out.Stale = out.Stale || status.Stale
		out.Refreshing = out.Refreshing || status.Refreshing
		if row.Error != "" {
			warnings = append(warnings, row.Symbol+": "+row.Error)
		}
		if validFinancialValue(row.Price) {
			available++
			if out.FetchedAt == 0 || row.FetchedAt < out.FetchedAt {
				out.FetchedAt = row.FetchedAt
			}
		}
	}
	out.Warning = strings.Join(warnings, "; ")
	if available == 0 {
		return out, errors.New("markets: all requested symbols are unavailable")
	}
	return out, nil
}

func validMarketSymbol(s string) bool {
	if s == "" || len(s) > 40 {
		return false
	}
	for _, c := range s {
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.ContainsRune(".-:^=", c) {
			continue
		}
		return false
	}
	if isCryptoSymbol(s) && stripCryptoPrefix(s) == "" {
		return false
	}
	return true
}

func SearchMarketSymbols(ctx context.Context, query string, limit int) ([]MarketSymbol, error) {
	q := strings.TrimSpace(query)
	if limit <= 0 {
		limit = 12
	}
	if limit > 20 {
		limit = 20
	}

	results := make([]MarketSymbol, 0, limit)
	seen := map[string]bool{}
	push := func(sym MarketSymbol) {
		k := strings.ToUpper(strings.TrimSpace(sym.Kind)) + ":" + strings.ToUpper(strings.TrimSpace(sym.Symbol))
		if k == ":" || seen[k] {
			return
		}
		seen[k] = true
		results = append(results, sym)
	}

	// Always include defaults first when no query.
	if q == "" {
		push(MarketSymbol{Symbol: "BTC", Kind: "crypto", Name: "Bitcoin"})
		push(MarketSymbol{Symbol: "ETH", Kind: "crypto", Name: "Ethereum"})
		push(MarketSymbol{Symbol: "AAPL", Kind: "stock", Name: "APPLE INC", Market: "US"})
		push(MarketSymbol{Symbol: "MSFT", Kind: "stock", Name: "MICROSOFT CORP", Market: "US"})
		for _, sym := range []string{"SOL", "BNB", "XRP", "DOGE"} {
			push(MarketSymbol{Symbol: sym, Kind: "crypto", Name: cryptoFullNames[sym]})
		}
		push(MarketSymbol{Symbol: "0700", Kind: "stock", Name: "Tencent Holdings Ltd", Market: "HK"})
		push(MarketSymbol{Symbol: "9988", Kind: "stock", Name: "Alibaba Group", Market: "HK"})
		if len(results) > limit {
			results = results[:limit]
		}
		return results, nil
	}

	// Parallel: Yahoo Finance search (stocks) + CoinGecko search (crypto)
	type yahooResult struct {
		items []MarketSymbol
		err   error
	}
	yahooCh := make(chan yahooResult, 1)
	go func() {
		items, err := yahooFinanceSearch(ctx, q, limit)
		yahooCh <- yahooResult{items, err}
	}()

	type geckoResult struct {
		coins []coinGeckoSearchCoin
		err   error
	}
	geckoCh := make(chan geckoResult, 1)
	go func() {
		coins, err := coinGeckoSearch(ctx, q, limit)
		geckoCh <- geckoResult{coins, err}
	}()

	// Collect results: Yahoo (stocks) first, then CoinGecko (crypto)
	yr, gr := <-yahooCh, <-geckoCh
	if len(yr.items) > 0 {
		for _, m := range yr.items {
			push(m)
			if len(results) >= limit {
				break
			}
		}
	}
	if len(gr.coins) > 0 {
		for _, c := range gr.coins {
			push(MarketSymbol{Symbol: strings.ToUpper(c.Symbol), Kind: "crypto", Name: c.Name})
			if len(results) >= limit {
				break
			}
		}
	}

	if len(results) > limit {
		results = results[:limit]
	}
	return results, errors.Join(yr.err, gr.err)
}

type coinGeckoSearchCoin struct {
	ID     string
	Name   string
	Symbol string
}

func coinGeckoSearch(ctx context.Context, query string, limit int, force ...bool) ([]coinGeckoSearchCoin, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, errors.New("query required")
	}
	if limit <= 0 {
		limit = 10
	}
	key := coinGeckoScope(ctx) + ":" + strings.ToLower(q)
	coins, state, err := coinGeckoSearchTTLCache.Load(ctx, key, func(ctx context.Context) ([]coinGeckoSearchCoin, error) {
		return loadCoinGeckoSearch(ctx, q)
	}, force...)
	if len(coins) > limit {
		coins = coins[:limit]
	}
	return coins, errors.Join(err, state.Err)
}

func loadCoinGeckoSearch(ctx context.Context, query string) ([]coinGeckoSearchCoin, error) {
	params := url.Values{}
	params.Set("query", query)
	endpoint := "https://api.coingecko.com/api/v3/search?" + params.Encode()
	var payload struct {
		Coins []struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Symbol string `json:"symbol"`
		} `json:"coins"`
	}
	if err := coinGeckoGet(ctx, endpoint, &payload); err != nil {
		return nil, err
	}
	if payload.Coins == nil {
		return nil, errors.New("coingecko search: missing coins")
	}

	out := make([]coinGeckoSearchCoin, 0, len(payload.Coins))
	for _, c := range payload.Coins {
		if strings.TrimSpace(c.Symbol) == "" || strings.TrimSpace(c.ID) == "" {
			continue
		}
		out = append(out, coinGeckoSearchCoin{ID: strings.TrimSpace(c.ID), Name: strings.TrimSpace(c.Name), Symbol: strings.TrimSpace(c.Symbol)})
	}
	return out, nil
}

type coinGeckoCooldown struct {
	until time.Time
	err   error
}

var coinGeckoBackoff = struct {
	sync.Mutex
	items map[string]coinGeckoCooldown
}{items: make(map[string]coinGeckoCooldown)}

func coinGeckoCooldownError(scope string) error {
	coinGeckoBackoff.Lock()
	cooldown := coinGeckoBackoff.items[scope]
	coinGeckoBackoff.Unlock()
	if time.Now().Before(cooldown.until) {
		return cooldown.err
	}
	return nil
}

func coinGeckoGet(ctx context.Context, endpoint string, dst any) error {
	scope := coinGeckoScope(ctx)
	if err := coinGeckoCooldownError(scope); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Hearth/1.0")
	if key := coinGeckoAPIKey(ctx); key != "" {
		req.Header.Set("X-CG-Demo-API-Key", key)
	}
	body, headers, status, err := financialRequest(ctx, req, func() error {
		return coinGeckoCooldownError(scope)
	})
	if err != nil {
		return err
	}
	backoff := time.Duration(0)
	if status < 200 || status >= 300 {
		err = fmt.Errorf("coingecko: status=%d", status)
		switch status {
		case http.StatusTooManyRequests:
			backoff = time.Minute
			if seconds, e := strconv.Atoi(headers.Get("Retry-After")); e == nil && seconds > 0 {
				backoff = time.Duration(min(seconds, 86400)) * time.Second
			} else if until, e := http.ParseTime(headers.Get("Retry-After")); e == nil && time.Until(until) > 0 {
				backoff = min(time.Until(until), 24*time.Hour)
			}
			backoff = max(backoff, time.Minute)
			err = fmt.Errorf("coingecko: rate limited (429); retry after %s", backoff.Round(time.Second))
		case http.StatusUnauthorized, http.StatusForbidden:
			backoff = 5 * time.Minute
			err = fmt.Errorf("coingecko: API key or access rejected (status=%d)", status)
		}
	} else {
		var failure struct {
			Status struct {
				Code int `json:"error_code"`
			} `json:"status"`
			Error string `json:"error"`
		}
		// Successful market responses are arrays; only object-shaped payloads
		// can be CoinGecko's HTTP-200 application errors.
		if json.Unmarshal(body, &failure) == nil && (failure.Status.Code != 0 || failure.Error != "") {
			err = fmt.Errorf("coingecko: provider rejected request (code=%d)", failure.Status.Code)
			backoff = 5 * time.Minute
		}
	}
	if backoff > 0 {
		coinGeckoBackoff.Lock()
		if len(coinGeckoBackoff.items) >= 64 {
			for key, item := range coinGeckoBackoff.items {
				if time.Now().After(item.until) {
					delete(coinGeckoBackoff.items, key)
				}
			}
		}
		if _, exists := coinGeckoBackoff.items[scope]; exists || len(coinGeckoBackoff.items) < 64 {
			coinGeckoBackoff.items[scope] = coinGeckoCooldown{time.Now().Add(backoff), err}
		}
		coinGeckoBackoff.Unlock()
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return fmt.Errorf("coingecko: invalid response: %w", err)
	}
	return nil
}

func fetchCoinGecko(ctx context.Context, symbolsUpper []string, force ...bool) ([]MarketQuote, error) {
	ids := make([]string, 0, len(symbolsUpper))
	idToSymbol := map[string]string{}
	idToName := map[string]string{}

	for _, symRaw := range symbolsUpper {
		sym := stripCryptoPrefix(symRaw)
		if sym == "" {
			return nil, errors.New("coingecko: empty crypto symbol")
		}
		id, name, err := coinGeckoResolveSymbol(ctx, sym, force...)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
		idToSymbol[id] = sym
		idToName[id] = name
	}
	if len(ids) == 0 {
		return nil, errors.New("coingecko: unable to resolve crypto symbols")
	}

	q := url.Values{}
	q.Set("vs_currency", "usd")
	q.Set("ids", strings.Join(ids, ","))
	q.Set("sparkline", "true")
	q.Set("price_change_percentage", "24h")

	endpoint := "https://api.coingecko.com/api/v3/coins/markets?" + q.Encode()
	var payload []struct {
		ID         string   `json:"id"`
		Symbol     string   `json:"symbol"`
		Name       string   `json:"name"`
		Price      float64  `json:"current_price"`
		ChangePct  *float64 `json:"price_change_percentage_24h"`
		UpdatedAt  string   `json:"last_updated"`
		Sparkline7 struct {
			Price []float64 `json:"price"`
		} `json:"sparkline_in_7d"`
	}
	if err := coinGeckoGet(ctx, endpoint, &payload); err != nil {
		return nil, err
	}

	out := make([]MarketQuote, 0, len(payload))
	for _, row := range payload {
		symbol := idToSymbol[row.ID]
		if symbol == "" {
			continue
		}
		name := strings.TrimSpace(row.Name)
		if name == "" {
			name = strings.TrimSpace(idToName[row.ID])
		}
		observedAt, err := time.Parse(time.RFC3339Nano, row.UpdatedAt)
		if err != nil || observedAt.Unix() <= 0 || !validFinancialValue(row.Price) || row.ChangePct == nil || math.IsNaN(*row.ChangePct) || math.IsInf(*row.ChangePct, 0) {
			return nil, fmt.Errorf("coingecko: invalid quote for %s", symbol)
		}
		// CoinGecko's seven-day sparkline is hourly. Take only its trailing
		// 24h, then sample; never compress a seven-day chart into a 24h label.
		prices := row.Sparkline7.Price
		if len(prices) > 24 {
			prices = prices[len(prices)-24:]
		}
		if len(prices) == 0 {
			return nil, fmt.Errorf("coingecko: missing series for %s", symbol)
		}
		for _, price := range prices {
			if !validFinancialValue(price) {
				return nil, fmt.Errorf("coingecko: invalid series for %s", symbol)
			}
		}
		series := sampleFinancialSeries(prices, 30)
		out = append(out, MarketQuote{
			Symbol:       symbol,
			Kind:         "crypto",
			Name:         name,
			Price:        row.Price,
			PriceUSD:     row.Price,
			Currency:     "USD",
			ObservedAt:   observedAt.Unix(),
			FetchedAt:    time.Now().Unix(),
			Source:       "coingecko",
			ChangePct24h: *row.ChangePct,
			Series:       series,
		})
	}
	if len(out) != len(ids) {
		return nil, errors.New("coingecko: missing requested quotes")
	}
	return out, nil
}

func coinGeckoResolveSymbol(ctx context.Context, symbolUpper string, force ...bool) (id string, name string, err error) {
	sym := strings.TrimSpace(strings.ToUpper(symbolUpper))
	if sym == "" {
		return "", "", errors.New("symbol required")
	}

	key := coinGeckoScope(ctx) + ":" + sym
	if v, ok := coinGeckoSymbolTTLCache.Get(key); ok && v.ID != "" {
		return v.ID, v.Name, nil
	}

	coins, err := coinGeckoSearch(ctx, sym, 250, force...)
	if err != nil {
		return "", "", err
	}

	pickedID := ""
	pickedName := ""
	for _, c := range coins {
		if strings.EqualFold(strings.TrimSpace(c.Symbol), sym) {
			pickedID = strings.TrimSpace(c.ID)
			pickedName = strings.TrimSpace(c.Name)
			break
		}
	}
	if pickedID == "" {
		return "", "", fmt.Errorf("coingecko: no match for %s", sym)
	}

	coinGeckoSymbolTTLCache.Set(key, coinGeckoSymbolEntry{ID: pickedID, Name: pickedName})

	return pickedID, pickedName, nil
}

func sampleFinancialSeries(series []float64, maxN int) []float64 {
	if maxN <= 0 {
		return nil
	}
	if len(series) <= maxN {
		return append([]float64(nil), series...)
	}
	if maxN == 1 {
		return []float64{series[len(series)-1]}
	}
	out := make([]float64, maxN)
	for i := range out {
		idx := i * (len(series) - 1) / (maxN - 1)
		out[i] = series[idx]
	}
	return out
}
