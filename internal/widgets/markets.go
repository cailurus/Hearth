package widgets

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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

// yahooLookupName resolves a symbol to its full company name via Yahoo Finance.
func yahooLookupName(ctx context.Context, symbol string) string {
	results, err := yahooFinanceSearch(ctx, symbol, 1)
	if err != nil || len(results) == 0 {
		return ""
	}
	// Only return name if the symbol matches
	symUp := strings.ToUpper(strings.TrimSuffix(symbol, ".HK"))
	if strings.ToUpper(results[0].Symbol) == symUp {
		return results[0].Name
	}
	return ""
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

// FetchMarkets aggregates free data sources:
// - Crypto: Binance public endpoints (USDT quoted; treated as USD)
// - Stocks: Stooq (USD)
// Results are cached for ~5 minutes.
func FetchMarkets(ctx context.Context, symbols []string) (MarketsResponse, error) {
	symbols = normalizeSymbols(symbols)
	// Always 4.

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

	cryptoSyms := make([]string, 0, len(symbols))
	stockSyms := make([]string, 0, len(symbols))
	for _, s := range symbols {
		if isCryptoSymbol(s) {
			cryptoSyms = append(cryptoSyms, s)
		} else {
			stockSyms = append(stockSyms, s)
		}
	}

	itemsBySymbol := map[string]MarketQuote{}

	if len(cryptoSyms) > 0 {
		cryptoItems, err := fetchBinanceCrypto(ctx, cryptoSyms)
		if err != nil {
			// Fallback to CoinGecko (some networks block Binance).
			if cgItems, err2 := fetchCoinGecko(ctx, cryptoSyms); err2 == nil {
				for _, it := range cgItems {
					itemsBySymbol[strings.ToUpper(it.Symbol)] = it
				}
			} else {
				// Prefer stale cache over failing the whole widget.
				if cached, ok := getAnyCached(); ok {
					return cached, nil
				}
				// Otherwise, keep going with stocks and leave crypto rows empty.
				cryptoItems = nil
			}
		}
		for keySym, it := range cryptoItems {
			itemsBySymbol[strings.ToUpper(keySym)] = it
		}
	}
	if len(stockSyms) > 0 {
		var stockWg sync.WaitGroup
		var stockMu sync.Mutex
		for _, s := range stockSyms {
			stockWg.Add(1)
			go func(sym string) {
				defer stockWg.Done()
				it, err := fetchStooqStock(ctx, sym)
				stockMu.Lock()
				defer stockMu.Unlock()
				if err != nil {
					itemsBySymbol[strings.ToUpper(sym)] = MarketQuote{Symbol: strings.ToUpper(sym), Kind: "stock"}
				} else {
					itemsBySymbol[strings.ToUpper(it.Symbol)] = it
				}
			}(s)
		}
		stockWg.Wait()
	}

	out := MarketsResponse{FetchedAt: time.Now().Unix()}
	out.Items = make([]MarketQuote, 0, len(symbols))
	for _, s := range symbols {
		keySym := strings.ToUpper(s)
		if it, ok := itemsBySymbol[keySym]; ok {
			out.Items = append(out.Items, it)
		} else {
			kind := "stock"
			if isCryptoSymbol(s) {
				kind = "crypto"
			}
			out.Items = append(out.Items, MarketQuote{Symbol: keySym, Kind: kind})
		}
	}

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

func fetchBinanceCrypto(ctx context.Context, symbolsUpper []string) (map[string]MarketQuote, error) {
	out := map[string]MarketQuote{}
	var mu sync.Mutex

	client := &http.Client{Timeout: 10 * time.Second}
	var anyOK int64
	var anyErr error
	var errMu sync.Mutex

	var wg sync.WaitGroup
	for _, symRaw := range symbolsUpper {
		origKey := strings.ToUpper(strings.TrimSpace(symRaw))
		base := strings.ToUpper(strings.TrimSpace(stripCryptoPrefix(symRaw)))
		if base == "" || origKey == "" {
			continue
		}

		wg.Add(1)
		go func(origKey, base string) {
			defer wg.Done()
			pair := base + "USDT"

			// 24h ticker
			endpoint := "https://api.binance.com/api/v3/ticker/24hr?" + url.Values{"symbol": []string{pair}}.Encode()
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
			if err != nil {
				errMu.Lock()
				anyErr = err
				errMu.Unlock()
				return
			}
			req.Header.Set("User-Agent", "Hearth/0.1")
			resp, err := client.Do(req)
			if err != nil {
				errMu.Lock()
				anyErr = err
				errMu.Unlock()
				return
			}
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
			_ = resp.Body.Close()
			if resp.StatusCode < 200 || resp.StatusCode >= 300 {
				errMu.Lock()
				anyErr = fmt.Errorf("binance ticker: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
				errMu.Unlock()
				return
			}

			var ticker struct {
				LastPrice         string `json:"lastPrice"`
				PriceChangePct24h string `json:"priceChangePercent"`
			}
			if err := json.Unmarshal(body, &ticker); err != nil {
				errMu.Lock()
				anyErr = err
				errMu.Unlock()
				return
			}

			price, err := strconv.ParseFloat(strings.TrimSpace(ticker.LastPrice), 64)
			if err != nil {
				errMu.Lock()
				anyErr = err
				errMu.Unlock()
				return
			}
			pct := 0.0
			if p, err := strconv.ParseFloat(strings.TrimSpace(ticker.PriceChangePct24h), 64); err == nil {
				pct = p
			}

			// 24h series (hourly closes)
			series := make([]float64, 0, 24)
			{
				q := url.Values{}
				q.Set("symbol", pair)
				q.Set("interval", "1h")
				q.Set("limit", "24")
				endpoint := "https://api.binance.com/api/v3/klines?" + q.Encode()
				req2, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
				if err == nil {
					req2.Header.Set("User-Agent", "Hearth/0.1")
					resp2, err := client.Do(req2)
					if err == nil {
						body2, _ := io.ReadAll(io.LimitReader(resp2.Body, 1024*1024))
						_ = resp2.Body.Close()
						if resp2.StatusCode >= 200 && resp2.StatusCode < 300 {
							var klines [][]any
							if err := json.Unmarshal(body2, &klines); err == nil {
								for _, k := range klines {
									if len(k) < 5 {
										continue
									}
									closeStr, ok := k[4].(string)
									if !ok {
										continue
									}
									if f, err := strconv.ParseFloat(strings.TrimSpace(closeStr), 64); err == nil && f > 0 {
										series = append(series, f)
									}
								}
							}
						}
					}
				}
			}

			name := strings.TrimSpace(cryptoFullNames[base])
			mu.Lock()
			out[origKey] = MarketQuote{
				Symbol:       base,
				Kind:         "crypto",
				Name:         name,
				PriceUSD:     price,
				ChangePct24h: pct,
				Series:       series,
			}
			mu.Unlock()
			atomic.AddInt64(&anyOK, 1)
		}(origKey, base)
	}

	wg.Wait()

	if atomic.LoadInt64(&anyOK) == 0 {
		if anyErr != nil {
			return nil, anyErr
		}
		return nil, errors.New("binance: no data")
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

func fetchStooqStock(ctx context.Context, symbolUpper string) (MarketQuote, error) {
	sym := strings.TrimSpace(strings.ToUpper(symbolUpper))
	if sym == "" {
		return MarketQuote{}, errors.New("symbol required")
	}

	code := strings.ToLower(sym)
	if strings.HasPrefix(code, "stock:") {
		code = strings.TrimSpace(strings.TrimPrefix(code, "stock:"))
	}
	if strings.HasPrefix(code, "hk:") {
		code = strings.TrimSpace(strings.TrimPrefix(code, "hk:"))
	}
	if !strings.Contains(code, ".") {
		if isHKStock(sym) {
			// Stooq uses no leading zeros for HK stocks: 0700 → 700.hk
			code = strings.TrimLeft(code, "0")
			if code == "" {
				code = "0"
			}
			code = code + ".hk"
		} else {
			code = code + ".us"
		}
	} else if strings.HasSuffix(code, ".hk") {
		// Also strip leading zeros for explicit .hk codes
		parts := strings.SplitN(code, ".", 2)
		num := strings.TrimLeft(parts[0], "0")
		if num == "" {
			num = "0"
		}
		code = num + ".hk"
	}

	name, lastClose, ok, err := fetchStooqQuote(ctx, code)
	if err != nil {
		return MarketQuote{}, err
	}
	if !ok {
		return MarketQuote{}, errors.New("stooq: no quote")
	}

	// Enrich name via Yahoo Finance (Stooq often returns abbreviated names)
	if betterName := yahooLookupName(ctx, sym); betterName != "" {
		name = betterName
	}

	closes, err := fetchStooqDailyClosesTail(ctx, code, 90)
	if err != nil {
		// Still return quote-only data.
		return MarketQuote{Symbol: sym, Kind: "stock", Name: name, PriceUSD: lastClose, ChangePct24h: 0, Series: nil}, nil
	}
	if len(closes) == 0 {
		return MarketQuote{Symbol: sym, Kind: "stock", Name: name, PriceUSD: lastClose, ChangePct24h: 0, Series: nil}, nil
	}

	price := closes[len(closes)-1]
	if price <= 0 {
		price = lastClose
	}
	changePct := 0.0
	if len(closes) >= 2 {
		prev := closes[len(closes)-2]
		if prev > 0 {
			changePct = (price - prev) / prev * 100
		}
	}

	series := downsampleTail(closes, 30)
	return MarketQuote{Symbol: sym, Kind: "stock", Name: name, PriceUSD: price, ChangePct24h: changePct, Series: series}, nil
}

func fetchStooqQuote(ctx context.Context, code string) (name string, close float64, ok bool, err error) {
	endpoint := fmt.Sprintf("https://stooq.com/q/l/?s=%s&f=snc&h&e=csv", url.QueryEscape(code))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", 0, false, err
	}
	req.Header.Set("User-Agent", "Hearth/0.1")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", 0, false, fmt.Errorf("stooq quote: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	reader := csv.NewReader(io.LimitReader(resp.Body, 64*1024))
	header, err := reader.Read()
	if err != nil {
		return "", 0, false, err
	}
	row, err := reader.Read()
	if err != nil {
		return "", 0, false, err
	}
	nameIdx, closeIdx := -1, -1
	for i, h := range header {
		s := strings.TrimSpace(h)
		if strings.EqualFold(s, "Name") {
			nameIdx = i
		}
		if strings.EqualFold(s, "Close") {
			closeIdx = i
		}
	}
	if nameIdx < 0 || closeIdx < 0 || nameIdx >= len(row) || closeIdx >= len(row) {
		return "", 0, false, errors.New("stooq quote: malformed")
	}
	name = strings.TrimSpace(row[nameIdx])
	if name == "" || strings.EqualFold(name, "N/A") {
		return "", 0, false, nil
	}
	v := strings.TrimSpace(row[closeIdx])
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return name, 0, true, nil
	}
	return name, f, true, nil
}

func fetchStooqDailyClosesTail(ctx context.Context, code string, maxKeep int) ([]float64, error) {
	if maxKeep <= 0 {
		maxKeep = 90
	}
	endpoint := fmt.Sprintf("https://stooq.com/q/d/l/?s=%s&i=d", url.QueryEscape(code))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Hearth/0.1")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("stooq daily: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	reader := csv.NewReader(resp.Body)
	reader.FieldsPerRecord = -1
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}
	closeIdx := -1
	for i, h := range header {
		if strings.EqualFold(strings.TrimSpace(h), "Close") {
			closeIdx = i
			break
		}
	}
	if closeIdx < 0 {
		return nil, errors.New("stooq: close column missing")
	}

	closes := make([]float64, 0, maxKeep)
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if closeIdx >= len(row) {
			continue
		}
		v := strings.TrimSpace(row[closeIdx])
		if v == "" || v == "-" {
			continue
		}
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			continue
		}
		closes = append(closes, f)
		if len(closes) > maxKeep {
			copy(closes, closes[len(closes)-maxKeep:])
			closes = closes[:maxKeep]
		}
	}
	return closes, nil
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
