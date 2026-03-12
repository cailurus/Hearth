package widgets

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"log"
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

	"github.com/morezhou/hearth/internal/cache"
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

var dealsTTLCache = cache.New[DealsResponse](30 * time.Minute)

// FetchGameDeals fetches PC deals from CheapShark and iOS deals from appstore-discounts.
func FetchGameDeals(ctx context.Context, region string) (DealsResponse, error) {
	if region == "" {
		region = "us"
	}
	region = strings.ToLower(strings.TrimSpace(region))

	if cached, ok := dealsTTLCache.Get(region); ok {
		return cached, nil
	}

	// Fetch both sources concurrently.
	var pcDeals, epicDeals, iosDeals []GameDeal
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		var err error
		pcDeals, err = fetchCheapSharkDeals(ctx)
		if err != nil {
			log.Printf("[deals] cheapshark: %v", err)
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		var err error
		epicDeals, err = fetchEpicFreeGames(ctx)
		if err != nil {
			log.Printf("[deals] epic: %v", err)
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		var err error
		iosDeals, err = fetchIOSDeals(ctx, region)
		if err != nil {
			log.Printf("[deals] ios: %v", err)
		}
	}()

	wg.Wait()

	// Epic free games first (most valuable — 100% off), then interleave PC and iOS.
	merged := append([]GameDeal{}, epicDeals...)
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
	dealsTTLCache.Set(region, out)
	return out, nil
}

// --- Epic Games Free Games ---

func fetchEpicFreeGames(ctx context.Context) ([]GameDeal, error) {
	reqURL := "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	resp, err := DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("epic: status " + resp.Status)
	}

	var payload struct {
		Data struct {
			Catalog struct {
				SearchStore struct {
					Elements []struct {
						Title      string `json:"title"`
						KeyImages  []struct {
							Type string `json:"type"`
							URL  string `json:"url"`
						} `json:"keyImages"`
						Price struct {
							TotalPrice struct {
								OriginalPrice int `json:"originalPrice"`
								DiscountPrice int `json:"discountPrice"`
							} `json:"totalPrice"`
						} `json:"price"`
						CatalogNs struct {
							Mappings []struct {
								PageSlug string `json:"pageSlug"`
							} `json:"mappings"`
						} `json:"catalogNs"`
						Promotions *struct {
							PromotionalOffers []struct {
								Offers []struct {
									StartDate       string `json:"startDate"`
									EndDate         string `json:"endDate"`
									DiscountSetting struct {
										DiscountPct int `json:"discountPercentage"`
									} `json:"discountSetting"`
								} `json:"promotionalOffers"`
							} `json:"promotionalOffers"`
							UpcomingOffers []struct {
								Offers []struct {
									StartDate       string `json:"startDate"`
									EndDate         string `json:"endDate"`
									DiscountSetting struct {
										DiscountPct int `json:"discountPercentage"`
									} `json:"discountSetting"`
								} `json:"promotionalOffers"`
							} `json:"upcomingPromotionalOffers"`
						} `json:"promotions"`
					} `json:"elements"`
				} `json:"searchStore"`
			} `json:"Catalog"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}

	now := time.Now()
	var deals []GameDeal

	for _, game := range payload.Data.Catalog.SearchStore.Elements {
		if game.Promotions == nil {
			continue
		}
		original := game.Price.TotalPrice.OriginalPrice
		discount := game.Price.TotalPrice.DiscountPrice

		// Check current free promotions (100% off, discount price = 0, original > 0).
		isFreeNow := false
		for _, group := range game.Promotions.PromotionalOffers {
			for _, offer := range group.Offers {
				if offer.DiscountSetting.DiscountPct == 0 && discount == 0 && original > 0 {
					endTime, _ := time.Parse(time.RFC3339, offer.EndDate)
					if endTime.After(now) {
						isFreeNow = true
					}
				}
			}
		}
		if !isFreeNow {
			continue
		}

		// Pick best thumbnail.
		thumb := ""
		for _, pref := range []string{"OfferImageWide", "DieselStoreFrontWide", "Thumbnail"} {
			for _, img := range game.KeyImages {
				if img.Type == pref {
					thumb = img.URL
					break
				}
			}
			if thumb != "" {
				break
			}
		}

		// Build store URL.
		slug := ""
		if len(game.CatalogNs.Mappings) > 0 {
			slug = game.CatalogNs.Mappings[0].PageSlug
		}
		storeURL := "https://store.epicgames.com/en-US/free-games"
		if slug != "" {
			storeURL = "https://store.epicgames.com/en-US/p/" + slug
		}

		deals = append(deals, GameDeal{
			Title:       game.Title,
			Thumbnail:   thumb,
			NormalPrice: fmt.Sprintf("$%.2f", float64(original)/100),
			SalePrice:   "FREE",
			DiscountPct: 100,
			Platform:    "pc",
			StoreURL:    storeURL,
			StoreName:   "Epic Games",
		})
	}
	return deals, nil
}

// --- CheapShark ---

func fetchCheapSharkDeals(ctx context.Context) ([]GameDeal, error) {
	reqURL := "https://www.cheapshark.com/api/1.0/deals?sortBy=Deal%20Rating&pageSize=6&upperPrice=50"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Hearth/1.0")

	resp, err := DefaultClient.Do(req)
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
		Title              string `json:"title"`
		DealID             string `json:"dealID"`
		StoreID            string `json:"storeID"`
		NormalPrice        string `json:"normalPrice"`
		SalePrice          string `json:"salePrice"`
		Savings            string `json:"savings"`
		SteamRatingPercent string `json:"steamRatingPercent"`
		SteamRatingCount   string `json:"steamRatingCount"`
		Thumb              string `json:"thumb"`
		SteamAppID         string `json:"steamAppID"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}

	// Deduplicate: keep only the cheapest deal per game title.
	bestByTitle := map[string]GameDeal{}
	for _, d := range raw {
		// Skip Epic deals from CheapShark — we fetch them directly via fetchEpicFreeGames.
		if d.StoreID == "25" {
			continue
		}

		savings, _ := strconv.ParseFloat(d.Savings, 64)
		rating, _ := strconv.ParseFloat(d.SteamRatingPercent, 64)
		ratingCount, _ := strconv.Atoi(d.SteamRatingCount)
		salePrice, _ := strconv.ParseFloat(d.SalePrice, 64)

		storeName, storeURL := cheapSharkStoreLink(d.StoreID, d.SteamAppID, d.DealID, d.Title)

		deal := GameDeal{
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
		}

		titleKey := strings.ToUpper(d.Title)
		if existing, ok := bestByTitle[titleKey]; ok {
			// Keep the cheaper one.
			existingPrice, _ := strconv.ParseFloat(strings.TrimPrefix(existing.SalePrice, "$"), 64)
			if salePrice < existingPrice {
				bestByTitle[titleKey] = deal
			}
		} else {
			bestByTitle[titleKey] = deal
		}
	}

	// Preserve deal rating order from the original API response.
	var deals []GameDeal
	seen := map[string]bool{}
	for _, d := range raw {
		titleKey := strings.ToUpper(d.Title)
		if seen[titleKey] {
			continue
		}
		if deal, ok := bestByTitle[titleKey]; ok {
			deals = append(deals, deal)
			seen[titleKey] = true
		}
	}
	return deals, nil
}

// cheapSharkStoreLink maps a CheapShark storeID to the correct store name and direct URL.
func cheapSharkStoreLink(storeID, steamAppID, dealID, title string) (storeName, storeURL string) {
	// Map CheapShark storeID → store name + direct URL.
	storeNames := map[string]string{
		"1": "Steam", "2": "GamersGate", "3": "GreenManGaming",
		"7": "GOG", "11": "Humble", "13": "Ubisoft", "15": "Fanatical",
		"21": "WinGameStore", "23": "GameBillet", "25": "Epic Games",
		"27": "Gamesplanet", "28": "Gamesload", "29": "2Game",
		"30": "IndieGala", "35": "DreamGame",
	}
	storeName = storeNames[storeID]
	if storeName == "" {
		storeName = "Store"
	}

	switch storeID {
	case "1": // Steam — direct app link
		if steamAppID != "" && steamAppID != "0" {
			storeURL = fmt.Sprintf("https://store.steampowered.com/app/%s/", steamAppID)
		} else {
			storeURL = fmt.Sprintf("https://store.steampowered.com/search/?term=%s", url.QueryEscape(title))
		}
	case "25": // Epic — search link
		storeURL = fmt.Sprintf("https://store.epicgames.com/en-US/browse?q=%s&sortBy=relevancy", url.QueryEscape(title))
	case "7": // GOG — search link
		storeURL = fmt.Sprintf("https://www.gog.com/games?query=%s", url.QueryEscape(title))
	case "11": // Humble — search link
		storeURL = fmt.Sprintf("https://www.humblebundle.com/store/search?search=%s", url.QueryEscape(title))
	default:
		// All other stores — CheapShark redirect goes to the correct store page.
		storeURL = fmt.Sprintf("https://www.cheapshark.com/redirect?dealID=%s", url.QueryEscape(dealID))
	}
	return
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

	resp, err := DefaultClient.Do(req)
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

	resp, err := DefaultClient.Do(req)
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

		// Filter: only include games.
		genre := strings.ToLower(meta.genre)
		if genre != "" && genre != "games" && !strings.Contains(genre, "game") {
			continue
		}

		// Verify the deal is still active by comparing RSS sale price with current iTunes price.
		// If current price is higher than the RSS sale price, the deal has ended.
		if e.salePrice != "" {
			rssSale, _ := strconv.ParseFloat(strings.TrimPrefix(e.salePrice, "$"), 64)
			if meta.price > rssSale+0.01 {
				continue // Deal ended, current price is back to normal.
			}
		}

		rating := meta.rating * 20 // convert 0-5 to 0-100 scale

		// Use current iTunes price as the actual sale price.
		salePrice := fmt.Sprintf("$%.2f", meta.price)
		if meta.price == 0 {
			salePrice = "FREE"
		}

		deals = append(deals, GameDeal{
			Title:       title,
			Thumbnail:   meta.artwork,
			NormalPrice: e.normalPrice,
			SalePrice:   salePrice,
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
	price       float64
	genre       string
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

	resp, err := DefaultClient.Do(req)
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
			Price             float64 `json:"price"`
			PrimaryGenreName  string  `json:"primaryGenreName"`
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
			price:       r.Price,
			genre:       r.PrimaryGenreName,
		}
	}
	return result
}
