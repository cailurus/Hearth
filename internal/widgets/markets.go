package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type MarketQuote struct {
	Symbol       string    `json:"symbol"`
	Kind         string    `json:"kind"` // "stock" | "crypto"
	Name         string    `json:"name,omitempty"`
	PriceUSD     float64   `json:"priceUsd"`
	ChangePct24h float64   `json:"changePct24h"`
	Series       []float64 `json:"series"`
}

type MarketsResponse struct {
	FetchedAt int64         `json:"fetchedAt"`
	Items     []MarketQuote `json:"items"`
}

type MarketSymbol struct {
	Symbol string `json:"symbol"`
	Kind   string `json:"kind"`   // "stock" | "crypto"
	Name   string `json:"name"`
	Market string `json:"market"` // "US" | "HK" | "" (crypto has no market)
}

var defaultMarketSymbols = []string{"BTC", "ETH", "AAPL", "MSFT"}

var marketsCache = struct {
	mu    sync.Mutex
	items map[string]MarketsResponse
}{
	items: map[string]MarketsResponse{},
}

var coinGeckoSymbolCache = struct {
	mu    sync.Mutex
	items map[string]struct {
		ID      string
		Name    string
		Fetched int64
	}
}{
	items: map[string]struct {
		ID      string
		Name    string
		Fetched int64
	}{},
}

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

func marketsCacheKey(symbols []string) string {
	return strings.Join(symbols, "|")
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

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo search: status=%d", resp.StatusCode)
	}

	var payload struct {
		Quotes []struct {
			Symbol   string `json:"symbol"`
			LongName string `json:"longname"`
			ShortName string `json:"shortname"`
			Exchange string `json:"exchange"`
			ExchDisp string `json:"exchDisp"`
			QuoteType string `json:"quoteType"`
		} `json:"quotes"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}

	var results []MarketSymbol
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
	if strings.HasPrefix(s, "CRYPTO:") {
		return strings.TrimSpace(strings.TrimPrefix(s, "CRYPTO:"))
	}
	if strings.HasSuffix(s, "-USD") {
		return strings.TrimSuffix(s, "-USD")
	}
	return s
}

// Yahoo Finance rate limiter: ensures minimum interval between requests.
var yahooLimiter struct {
	mu   sync.Mutex
	last time.Time
}

func yahooRateWait() {
	yahooLimiter.mu.Lock()
	defer yahooLimiter.mu.Unlock()
	const minInterval = 200 * time.Millisecond
	if elapsed := time.Since(yahooLimiter.last); elapsed < minInterval {
		time.Sleep(minInterval - elapsed)
	}
	yahooLimiter.last = time.Now()
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
	yahooRateWait()

	yahooSym := toYahooSymbol(symbol, isCrypto)
	chartRange := "3mo"
	interval := "1d"
	if isCrypto {
		chartRange = "1d"
		interval = "1h"
	}

	q := url.Values{}
	q.Set("range", chartRange)
	q.Set("interval", interval)
	endpoint := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?%s",
		url.PathEscape(yahooSym), q.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return MarketQuote{}, err
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return MarketQuote{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return MarketQuote{}, err
	}
	if resp.StatusCode != http.StatusOK {
		preview := string(body)
		if len(preview) > 256 {
			preview = preview[:256]
		}
		return MarketQuote{}, fmt.Errorf("yahoo chart: status=%d body=%s", resp.StatusCode, strings.TrimSpace(preview))
	}

	var payload struct {
		Chart struct {
			Result []struct {
				Meta struct {
					Symbol             string  `json:"symbol"`
					ShortName          string  `json:"shortName"`
					LongName           string  `json:"longName"`
					RegularMarketPrice float64 `json:"regularMarketPrice"`
					ChartPreviousClose float64 `json:"chartPreviousClose"`
					PreviousClose      float64 `json:"previousClose"`
				} `json:"meta"`
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
	prevClose := meta.ChartPreviousClose
	if prevClose == 0 {
		prevClose = meta.PreviousClose
	}
	changePct := 0.0
	if prevClose > 0 {
		changePct = (price - prevClose) / prevClose * 100
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

	var closes []float64
	if len(result.Indicators.Quote) > 0 {
		for _, v := range result.Indicators.Quote[0].Close {
			if v != nil && *v > 0 {
				closes = append(closes, *v)
			}
		}
	}

	maxPoints := 30
	if isCrypto {
		maxPoints = 24
	}
	series := downsampleTail(closes, maxPoints)

	return MarketQuote{
		Symbol:       displaySym,
		Kind:         kind,
		Name:         name,
		PriceUSD:     price,
		ChangePct24h: changePct,
		Series:       series,
	}, nil
}

// FetchMarkets fetches market data from Yahoo Finance (primary) with CoinGecko
// fallback for crypto. Results are cached for ~5 minutes.
func FetchMarkets(ctx context.Context, symbols []string) (MarketsResponse, error) {
	symbols = normalizeSymbols(symbols)

	const ttl = 5 * time.Minute
	key := marketsCacheKey(symbols)
	marketsCache.mu.Lock()
	if cached, ok := marketsCache.items[key]; ok {
		age := time.Since(time.Unix(cached.FetchedAt, 0))
		if cached.FetchedAt > 0 && age >= 0 && age < ttl {
			marketsCache.mu.Unlock()
			return cached, nil
		}
	}
	marketsCache.mu.Unlock()

	getAnyCached := func() (MarketsResponse, bool) {
		marketsCache.mu.Lock()
		defer marketsCache.mu.Unlock()
		c, ok := marketsCache.items[key]
		return c, ok && c.FetchedAt > 0
	}

	items := make([]MarketQuote, len(symbols))
	var failedCrypto []int

	for i, s := range symbols {
		crypto := isCryptoSymbol(s)
		quote, err := fetchYahooChart(ctx, s, crypto)
		if err != nil {
			if crypto {
				failedCrypto = append(failedCrypto, i)
			} else {
				items[i] = MarketQuote{Symbol: strings.ToUpper(s), Kind: "stock"}
			}
			continue
		}
		items[i] = quote
	}

	// Fallback to CoinGecko for failed crypto symbols.
	if len(failedCrypto) > 0 {
		cryptoSyms := make([]string, len(failedCrypto))
		for j, idx := range failedCrypto {
			cryptoSyms[j] = symbols[idx]
		}
		if cgItems, err := fetchCoinGecko(ctx, cryptoSyms); err == nil {
			cgMap := map[string]MarketQuote{}
			for _, it := range cgItems {
				cgMap[strings.ToUpper(it.Symbol)] = it
			}
			for _, idx := range failedCrypto {
				sym := strings.ToUpper(symbols[idx])
				if it, ok := cgMap[sym]; ok {
					items[idx] = it
				} else {
					items[idx] = MarketQuote{Symbol: stripCryptoPrefix(sym), Kind: "crypto"}
				}
			}
		} else {
			if cached, ok := getAnyCached(); ok {
				return cached, nil
			}
			for _, idx := range failedCrypto {
				items[idx] = MarketQuote{
					Symbol: stripCryptoPrefix(strings.ToUpper(symbols[idx])),
					Kind:   "crypto",
				}
			}
		}
	}

	out := MarketsResponse{FetchedAt: time.Now().Unix(), Items: items}

	marketsCache.mu.Lock()
	marketsCache.items[key] = out
	marketsCache.mu.Unlock()

	return out, nil
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
	if yr := <-yahooCh; yr.err == nil {
		for _, m := range yr.items {
			push(m)
			if len(results) >= limit {
				break
			}
		}
	}
	if gr := <-geckoCh; gr.err == nil {
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
	return results, nil
}

type coinGeckoSearchCoin struct {
	ID     string
	Name   string
	Symbol string
}

func coinGeckoSearch(ctx context.Context, query string, limit int) ([]coinGeckoSearchCoin, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, errors.New("query required")
	}
	if limit <= 0 {
		limit = 10
	}

	params := url.Values{}
	params.Set("query", q)
	endpoint := "https://api.coingecko.com/api/v3/search?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Hearth/0.1")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("coingecko search: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload struct {
		Coins []struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Symbol string `json:"symbol"`
		} `json:"coins"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	out := make([]coinGeckoSearchCoin, 0, limit)
	for _, c := range payload.Coins {
		if strings.TrimSpace(c.Symbol) == "" {
			continue
		}
		out = append(out, coinGeckoSearchCoin{ID: strings.TrimSpace(c.ID), Name: strings.TrimSpace(c.Name), Symbol: strings.TrimSpace(c.Symbol)})
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func fetchCoinGecko(ctx context.Context, symbolsUpper []string) ([]MarketQuote, error) {
	ids := make([]string, 0, len(symbolsUpper))
	idToSymbol := map[string]string{}
	idToName := map[string]string{}

	for _, symRaw := range symbolsUpper {
		sym := stripCryptoPrefix(symRaw)
		if sym == "" {
			continue
		}
		id, name, err := coinGeckoResolveSymbol(ctx, sym)
		if err != nil {
			continue
		}
		ids = append(ids, id)
		idToSymbol[id] = strings.ToUpper(symRaw)
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
		return nil, fmt.Errorf("coingecko markets: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload []struct {
		ID         string  `json:"id"`
		Symbol     string  `json:"symbol"`
		Name       string  `json:"name"`
		Price      float64 `json:"current_price"`
		ChangePct  float64 `json:"price_change_percentage_24h"`
		Sparkline7 struct {
			Price []float64 `json:"price"`
		} `json:"sparkline_in_7d"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	out := make([]MarketQuote, 0, len(payload))
	for _, row := range payload {
		symbol := idToSymbol[row.ID]
		if symbol == "" {
			// Fallback to api-provided symbol.
			symbol = strings.ToUpper(row.Symbol)
		}
		name := strings.TrimSpace(row.Name)
		if name == "" {
			name = strings.TrimSpace(idToName[row.ID])
		}
		series := downsampleTail(row.Sparkline7.Price, 24)
		out = append(out, MarketQuote{
			Symbol:       symbol,
			Kind:         "crypto",
			Name:         name,
			PriceUSD:     row.Price,
			ChangePct24h: row.ChangePct,
			Series:       series,
		})
	}
	return out, nil
}

func coinGeckoResolveSymbol(ctx context.Context, symbolUpper string) (id string, name string, err error) {
	sym := strings.TrimSpace(strings.ToUpper(symbolUpper))
	if sym == "" {
		return "", "", errors.New("symbol required")
	}

	const ttl = 7 * 24 * time.Hour
	coinGeckoSymbolCache.mu.Lock()
	if v, ok := coinGeckoSymbolCache.items[sym]; ok {
		age := time.Since(time.Unix(v.Fetched, 0))
		if v.Fetched > 0 && age >= 0 && age < ttl && strings.TrimSpace(v.ID) != "" {
			coinGeckoSymbolCache.mu.Unlock()
			return v.ID, v.Name, nil
		}
	}
	coinGeckoSymbolCache.mu.Unlock()

	q := url.Values{}
	q.Set("query", sym)
	endpoint := "https://api.coingecko.com/api/v3/search?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("User-Agent", "Hearth/0.1")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", "", fmt.Errorf("coingecko search: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload struct {
		Coins []struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Symbol string `json:"symbol"`
		} `json:"coins"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", "", err
	}

	pickedID := ""
	pickedName := ""
	for _, c := range payload.Coins {
		if strings.EqualFold(strings.TrimSpace(c.Symbol), sym) {
			pickedID = strings.TrimSpace(c.ID)
			pickedName = strings.TrimSpace(c.Name)
			break
		}
	}
	if pickedID == "" && len(payload.Coins) > 0 {
		pickedID = strings.TrimSpace(payload.Coins[0].ID)
		pickedName = strings.TrimSpace(payload.Coins[0].Name)
	}
	if pickedID == "" {
		return "", "", fmt.Errorf("coingecko: no match for %s", sym)
	}

	coinGeckoSymbolCache.mu.Lock()
	coinGeckoSymbolCache.items[sym] = struct {
		ID      string
		Name    string
		Fetched int64
	}{
		ID:      pickedID,
		Name:    pickedName,
		Fetched: time.Now().Unix(),
	}
	coinGeckoSymbolCache.mu.Unlock()

	return pickedID, pickedName, nil
}

func downsampleTail(series []float64, maxN int) []float64 {
	if maxN <= 0 {
		return nil
	}
	if len(series) <= maxN {
		out := make([]float64, 0, len(series))
		for _, v := range series {
			if v == 0 {
				continue
			}
			out = append(out, v)
		}
		return out
	}
	start := len(series) - maxN
	out := make([]float64, 0, maxN)
	for _, v := range series[start:] {
		if v == 0 {
			continue
		}
		out = append(out, v)
	}
	return out
}
