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
	Kind   string `json:"kind"` // "stock" | "crypto"
	Name   string `json:"name"`
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
		ID       string
		Name     string
		Fetched  int64
		SymbolUp string
	}
}{
	items: map[string]struct {
		ID       string
		Name     string
		Fetched  int64
		SymbolUp string
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

func isCryptoSymbol(symUpper string) bool {
	s := strings.TrimSpace(strings.ToUpper(symUpper))
	if s == "" {
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
	for _, s := range stockSyms {
		it, err := fetchStooqStock(ctx, s)
		if err != nil {
			// Keep widget resilient: represent missing items as 0/empty.
			itemsBySymbol[strings.ToUpper(s)] = MarketQuote{Symbol: strings.ToUpper(s), Kind: "stock"}
			continue
		}
		itemsBySymbol[strings.ToUpper(it.Symbol)] = it
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
		push(MarketSymbol{Symbol: "AAPL", Kind: "stock", Name: "APPLE INC"})
		push(MarketSymbol{Symbol: "MSFT", Kind: "stock", Name: "MICROSOFT CORP"})
		for _, sym := range []string{"SOL", "BNB", "XRP", "DOGE"} {
			push(MarketSymbol{Symbol: sym, Kind: "crypto", Name: ""})
		}
		if len(results) > limit {
			results = results[:limit]
		}
		return results, nil
	}

	// Stocks: treat the query as a ticker candidate and validate it via Stooq quote.
	if sym, code := normalizeStockSearchQuery(q); sym != "" {
		name, _, ok, _ := fetchStooqQuote(ctx, code)
		if ok {
			push(MarketSymbol{Symbol: sym, Kind: "stock", Name: name})
		}
	}

	// Crypto: CoinGecko search.
	coins, err := coinGeckoSearch(ctx, q, limit)
	if err == nil {
		for _, c := range coins {
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

func normalizeStockSearchQuery(q string) (symbolUpper string, stooqCode string) {
	s := strings.TrimSpace(q)
	if s == "" {
		return "", ""
	}
	s = strings.ToUpper(s)
	s = strings.TrimPrefix(s, "STOCK:")
	s = strings.TrimSpace(s)
	for _, r := range s {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' {
			continue
		}
		return "", ""
	}
	if s == "" {
		return "", ""
	}
	code := strings.ToLower(s)
	if !strings.Contains(code, ".") {
		code = code + ".us"
	}
	parts := strings.Split(strings.ToUpper(code), ".")
	if len(parts) == 0 || parts[0] == "" {
		return "", ""
	}
	return parts[0], code
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

	client := &http.Client{Timeout: 10 * time.Second}
	anyOK := false
	var anyErr error

	for _, symRaw := range symbolsUpper {
		origKey := strings.ToUpper(strings.TrimSpace(symRaw))
		base := strings.ToUpper(strings.TrimSpace(stripCryptoPrefix(symRaw)))
		if base == "" || origKey == "" {
			continue
		}
		pair := base + "USDT"

		// 24h ticker
		{
			endpoint := "https://api.binance.com/api/v3/ticker/24hr?" + url.Values{"symbol": []string{pair}}.Encode()
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
			if err != nil {
				anyErr = err
				continue
			}
			req.Header.Set("User-Agent", "Hearth/0.1")
			resp, err := client.Do(req)
			if err != nil {
				anyErr = err
				continue
			}
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
			_ = resp.Body.Close()
			if resp.StatusCode < 200 || resp.StatusCode >= 300 {
				anyErr = fmt.Errorf("binance ticker: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
				continue
			}

			var ticker struct {
				LastPrice         string `json:"lastPrice"`
				PriceChangePct24h string `json:"priceChangePercent"`
			}
			if err := json.Unmarshal(body, &ticker); err != nil {
				anyErr = err
				continue
			}

			price, err := strconv.ParseFloat(strings.TrimSpace(ticker.LastPrice), 64)
			if err != nil {
				anyErr = err
				continue
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
			out[origKey] = MarketQuote{
				Symbol:       base,
				Kind:         "crypto",
				Name:         name,
				PriceUSD:     price,
				ChangePct24h: pct,
				Series:       series,
			}
			anyOK = true
		}
	}

	if !anyOK {
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
		ID       string
		Name     string
		Fetched  int64
		SymbolUp string
	}{
		ID:       pickedID,
		Name:     pickedName,
		Fetched:  time.Now().Unix(),
		SymbolUp: sym,
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
	if strings.HasPrefix(code, "STOCK:") {
		code = strings.TrimSpace(strings.TrimPrefix(code, "stock:"))
	}
	if !strings.Contains(code, ".") {
		// Default to US market.
		code = code + ".us"
	}

	name, lastClose, ok, err := fetchStooqQuote(ctx, code)
	if err != nil {
		return MarketQuote{}, err
	}
	if !ok {
		return MarketQuote{}, errors.New("stooq: no quote")
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
