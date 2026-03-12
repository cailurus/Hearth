package widgets

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type GameDeal struct {
	Title       string  `json:"title"`
	Thumbnail   string  `json:"thumbnail"`
	NormalPrice string  `json:"normalPrice"`
	SalePrice   string  `json:"salePrice"`
	DiscountPct int     `json:"discountPct"`
	Rating      float64 `json:"rating"`    // 0-100 scale
	RatingCount int     `json:"ratingCount"`
	Platform    string  `json:"platform"`  // "pc" | "ios"
	StoreURL    string  `json:"storeUrl"`
	StoreName   string  `json:"storeName"`
}

type DealsResponse struct {
	FetchedAt int64      `json:"fetchedAt"`
	Items     []GameDeal `json:"items"`
}

var dealsCache = struct {
	mu    sync.Mutex
	items map[string]DealsResponse
}{
	items: map[string]DealsResponse{},
}

// FetchGameDeals fetches PC deals from CheapShark and iOS deals from appstore-discounts.
func FetchGameDeals(ctx context.Context, region string) (DealsResponse, error) {
	if region == "" {
		region = "us"
	}
	region = strings.ToLower(strings.TrimSpace(region))

	const ttl = 30 * time.Minute
	dealsCache.mu.Lock()
	if cached, ok := dealsCache.items[region]; ok {
		age := time.Since(time.Unix(cached.FetchedAt, 0))
		if cached.FetchedAt > 0 && age >= 0 && age < ttl {
			dealsCache.mu.Unlock()
			return cached, nil
		}
	}
	dealsCache.mu.Unlock()

	// Fetch both sources concurrently.
	var pcDeals, iosDeals []GameDeal
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		pcDeals, _ = fetchCheapSharkDeals(ctx)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		iosDeals, _ = fetchIOSDeals(ctx, region)
	}()

	wg.Wait()

	// Interleave PC and iOS deals.
	var merged []GameDeal
	pi, ii := 0, 0
	for pi < len(pcDeals) || ii < len(iosDeals) {
		if pi < len(pcDeals) {
			merged = append(merged, pcDeals[pi])
			pi++
		}
		if ii < len(iosDeals) {
			merged = append(merged, iosDeals[ii])
			ii++
		}
	}
	if len(merged) > 12 {
		merged = merged[:12]
	}

	out := DealsResponse{FetchedAt: time.Now().Unix(), Items: merged}
	dealsCache.mu.Lock()
	dealsCache.items[region] = out
	dealsCache.mu.Unlock()

	return out, nil
}

// --- CheapShark ---

func fetchCheapSharkDeals(ctx context.Context) ([]GameDeal, error) {
	reqURL := "https://www.cheapshark.com/api/1.0/deals?sortBy=Deal%20Rating&pageSize=6&upperPrice=50"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("cheapshark: status " + resp.Status)
	}

	var raw []struct {
		Title             string `json:"title"`
		DealID            string `json:"dealID"`
		NormalPrice       string `json:"normalPrice"`
		SalePrice         string `json:"salePrice"`
		Savings           string `json:"savings"`
		SteamRatingPercent string `json:"steamRatingPercent"`
		SteamRatingCount  string `json:"steamRatingCount"`
		Thumb             string `json:"thumb"`
		SteamAppID        string `json:"steamAppID"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}

	var deals []GameDeal
	for _, d := range raw {
		savings, _ := strconv.ParseFloat(d.Savings, 64)
		rating, _ := strconv.ParseFloat(d.SteamRatingPercent, 64)
		ratingCount, _ := strconv.Atoi(d.SteamRatingCount)

		// Always use direct Steam store link.
		steamID := d.SteamAppID
		if steamID == "" || steamID == "0" {
			// Search Steam for the game to get the app ID.
			steamID = searchSteamAppID(ctx, d.Title)
		}
		storeURL := ""
		storeName := "Steam"
		if steamID != "" {
			storeURL = fmt.Sprintf("https://store.steampowered.com/app/%s/", steamID)
		} else {
			// Last resort: search URL on Steam.
			storeURL = fmt.Sprintf("https://store.steampowered.com/search/?term=%s", url.QueryEscape(d.Title))
		}

		deals = append(deals, GameDeal{
			Title:       d.Title,
			Thumbnail:   d.Thumb,
			NormalPrice: "$" + d.NormalPrice,
			SalePrice:   "$" + d.SalePrice,
			DiscountPct: int(math.Round(savings)),
			Rating:      rating,
			RatingCount: ratingCount,
			Platform:    "pc",
			StoreURL:    storeURL,
			StoreName:   storeName,
		})
	}
	return deals, nil
}

// searchSteamAppID searches the Steam store for a game by title and returns its app ID.
func searchSteamAppID(ctx context.Context, title string) string {
	if title == "" {
		return ""
	}
	searchURL := fmt.Sprintf("https://store.steampowered.com/api/storesearch/?term=%s&l=english&cc=US",
		url.QueryEscape(title))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, searchURL, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
	if err != nil || resp.StatusCode != http.StatusOK {
		return ""
	}

	var result struct {
		Items []struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &result); err != nil || len(result.Items) == 0 {
		return ""
	}

	// Return the first result's ID — Steam search is usually accurate.
	return strconv.Itoa(result.Items[0].ID)
}

// --- iOS App Store Deals ---

var iosAppIDRegex = regexp.MustCompile(`/id(\d+)`)
var iosPriceRegex = regexp.MustCompile(`Price:\s*\$?([\d.]+)\s*→\s*\$?([\d.]+)`)

func fetchIOSDeals(ctx context.Context, region string) ([]GameDeal, error) {
	rssURL := fmt.Sprintf("https://raw.githubusercontent.com/appstore-discounts/appstore-discounts/main/rss/%s.xml", region)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rssURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("appstore-discounts: status " + resp.Status)
	}

	// Parse Atom feed.
	type atomEntry struct {
		Title   string `xml:"title"`
		Link    struct {
			Href string `xml:"href,attr"`
		} `xml:"link"`
		Summary string `xml:"summary"`
	}
	type atomFeedXML struct {
		Entries []atomEntry `xml:"entry"`
	}
	var feed atomFeedXML
	if err := xml.Unmarshal(body, &feed); err != nil {
		return nil, err
	}

	// Extract app IDs and price info from entries.
	type iosEntry struct {
		appID       string
		link        string
		normalPrice string
		salePrice   string
		discountPct int
	}

	var entries []iosEntry
	for _, e := range feed.Entries {
		m := iosAppIDRegex.FindStringSubmatch(e.Link.Href)
		if len(m) < 2 {
			continue
		}
		appID := m[1]

		var normal, sale string
		var discount int
		pm := iosPriceRegex.FindStringSubmatch(e.Summary)
		if len(pm) >= 3 {
			normal = "$" + pm[1]
			sale = "$" + pm[2]
			np, _ := strconv.ParseFloat(pm[1], 64)
			sp, _ := strconv.ParseFloat(pm[2], 64)
			if np > 0 {
				discount = int(math.Round((1 - sp/np) * 100))
			}
		}

		entries = append(entries, iosEntry{
			appID: appID, link: e.Link.Href,
			normalPrice: normal, salePrice: sale, discountPct: discount,
		})
		if len(entries) >= 6 {
			break
		}
	}

	if len(entries) == 0 {
		return nil, nil
	}

	// Batch iTunes lookup for metadata.
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = e.appID
	}
	metadata := fetchITunesMetadata(ctx, ids, region)

	var deals []GameDeal
	for _, e := range entries {
		meta := metadata[e.appID]
		title := meta.trackName
		if title == "" {
			continue
		}
		rating := meta.rating * 20 // convert 0-5 to 0-100 scale

		deals = append(deals, GameDeal{
			Title:       title,
			Thumbnail:   meta.artwork,
			NormalPrice: e.normalPrice,
			SalePrice:   e.salePrice,
			DiscountPct: e.discountPct,
			Rating:      rating,
			RatingCount: meta.ratingCount,
			Platform:    "ios",
			StoreURL:    e.link,
			StoreName:   "App Store",
		})
	}
	return deals, nil
}

type itunesMeta struct {
	trackName   string
	artwork     string
	rating      float64
	ratingCount int
}

func fetchITunesMetadata(ctx context.Context, appIDs []string, country string) map[string]itunesMeta {
	result := make(map[string]itunesMeta)
	if len(appIDs) == 0 {
		return result
	}

	lookupURL := fmt.Sprintf("https://itunes.apple.com/lookup?id=%s&country=%s",
		strings.Join(appIDs, ","), country)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, lookupURL, nil)
	if err != nil {
		return result
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return result
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return result
	}

	var payload struct {
		Results []struct {
			TrackID           int     `json:"trackId"`
			TrackName         string  `json:"trackName"`
			ArtworkURL100     string  `json:"artworkUrl100"`
			AverageUserRating float64 `json:"averageUserRating"`
			UserRatingCount   int     `json:"userRatingCount"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return result
	}

	for _, r := range payload.Results {
		id := strconv.Itoa(r.TrackID)
		result[id] = itunesMeta{
			trackName:   r.TrackName,
			artwork:     r.ArtworkURL100,
			rating:      r.AverageUserRating,
			ratingCount: r.UserRatingCount,
		}
	}
	return result
}
