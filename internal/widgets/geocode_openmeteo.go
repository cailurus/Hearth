package widgets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode"
)

type GeoPoint struct {
	Lat         float64
	Lon         float64
	DisplayName string
	Timezone    string
}

type geoResult struct {
	ID         int     `json:"id"`
	Name       string  `json:"name"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
	Timezone   string  `json:"timezone"`
	Country    string  `json:"country"`
	Admin1     string  `json:"admin1"`
	Population int     `json:"population"`
}

type geoPayload struct {
	Results []geoResult `json:"results"`
}

func normalizeGeoLanguage(language string) string {
	lang := strings.ToLower(strings.TrimSpace(language))
	if strings.HasPrefix(lang, "zh") {
		return "zh"
	}
	return "en"
}

func containsCJK(s string) bool {
	for _, r := range s {
		// Han covers most Chinese characters.
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

// Common Chinese city names to pinyin mapping for better search results
// Open-Meteo's geocoding API works much better with pinyin for major cities
var chineseToPinyin = map[string]string{
	// Direct-controlled municipalities
	"北京": "beijing", "上海": "shanghai", "天津": "tianjin", "重庆": "chongqing",
	// Provincial capitals and major cities
	"长春": "changchun", "哈尔滨": "harbin", "沈阳": "shenyang", "大连": "dalian",
	"石家庄": "shijiazhuang", "太原": "taiyuan", "呼和浩特": "hohhot",
	"济南": "jinan", "青岛": "qingdao", "郑州": "zhengzhou", "武汉": "wuhan",
	"长沙": "changsha", "南京": "nanjing", "杭州": "hangzhou", "合肥": "hefei",
	"南昌": "nanchang", "福州": "fuzhou", "厦门": "xiamen", "广州": "guangzhou",
	"深圳": "shenzhen", "东莞": "dongguan", "珠海": "zhuhai", "佛山": "foshan",
	"南宁": "nanning", "海口": "haikou", "成都": "chengdu", "贵阳": "guiyang",
	"昆明": "kunming", "拉萨": "lhasa", "西安": "xian", "兰州": "lanzhou",
	"西宁": "xining", "银川": "yinchuan", "乌鲁木齐": "urumqi",
	// Other major cities
	"苏州": "suzhou", "无锡": "wuxi", "常州": "changzhou", "宁波": "ningbo",
	"温州": "wenzhou", "嘉兴": "jiaxing", "烟台": "yantai", "潍坊": "weifang",
	"淄博": "zibo", "威海": "weihai", "洛阳": "luoyang", "开封": "kaifeng",
	"唐山": "tangshan", "秦皇岛": "qinhuangdao", "包头": "baotou",
	"鞍山": "anshan", "抚顺": "fushun", "吉林": "jilin", "齐齐哈尔": "qiqihar",
	"大庆": "daqing", "牡丹江": "mudanjiang", "佳木斯": "jiamusi",
	"徐州": "xuzhou", "连云港": "lianyungang", "扬州": "yangzhou", "镇江": "zhenjiang",
	"绍兴": "shaoxing", "台州": "taizhou", "金华": "jinhua", "衢州": "quzhou",
	"芜湖": "wuhu", "蚌埠": "bengbu", "马鞍山": "maanshan", "安庆": "anqing",
	"泉州": "quanzhou", "漳州": "zhangzhou", "莆田": "putian", "三明": "sanming",
	"九江": "jiujiang", "景德镇": "jingdezhen", "赣州": "ganzhou",
	"汕头": "shantou", "惠州": "huizhou", "中山": "zhongshan", "江门": "jiangmen",
	"桂林": "guilin", "柳州": "liuzhou", "北海": "beihai",
	"三亚": "sanya", "绵阳": "mianyang", "宜宾": "yibin", "泸州": "luzhou",
	"遵义": "zunyi", "曲靖": "qujing", "玉溪": "yuxi", "咸阳": "xianyang",
	"宝鸡": "baoji", "延安": "yanan", "天水": "tianshui", "白银": "baiyin",
	// Hong Kong, Macau, Taiwan
	"香港": "hong kong", "澳门": "macau", "台北": "taipei", "高雄": "kaohsiung",
	"台中": "taichung", "台南": "tainan", "新北": "new taipei",
}

// getPinyinVariant returns the pinyin version of a Chinese city name if available
func getPinyinVariant(chinese string) string {
	if pinyin, ok := chineseToPinyin[chinese]; ok {
		return pinyin
	}
	return ""
}

func fetchGeo(ctx context.Context, q string, count int, language string) (geoPayload, error) {
	params := url.Values{}
	params.Set("name", q)
	params.Set("count", fmt.Sprintf("%d", count))
	params.Set("language", language)
	params.Set("format", "json")

	endpoint := "https://geocoding-api.open-meteo.com/v1/search?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return geoPayload{}, err
	}
	req.Header.Set("User-Agent", "Hearth/0.1")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return geoPayload{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		var payloadErr struct {
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(body, &payloadErr)
		reason := strings.TrimSpace(payloadErr.Reason)
		if reason == "" {
			reason = strings.TrimSpace(string(body))
		}
		if reason == "" {
			reason = resp.Status
		}
		return geoPayload{}, fmt.Errorf("open-meteo geocoding: status=%d reason=%s", resp.StatusCode, reason)
	}

	var payload geoPayload
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return geoPayload{}, err
	}
	return payload, nil
}

// SearchCities searches for cities using Nominatim (OpenStreetMap) API as the primary backend.
// Falls back to Open-Meteo if Nominatim fails, since Open-Meteo includes timezone info.
func SearchCities(ctx context.Context, query string, count int, language string) ([]GeoPoint, error) {
	// Try Nominatim first - much better for Chinese/international city names
	results, err := SearchCitiesNominatim(ctx, query, count, language)
	if err == nil && len(results) > 0 {
		// Nominatim doesn't return timezone, so resolve it from Open-Meteo's timezone API
		for i := range results {
			if results[i].Timezone == "" {
				if tz, err := ResolveTimezone(ctx, fmt.Sprintf("%f", results[i].Lat), fmt.Sprintf("%f", results[i].Lon)); err == nil {
					results[i].Timezone = tz
				}
			}
		}
		return results, nil
	}

	// Fallback to Open-Meteo if Nominatim fails
	return SearchCitiesOpenMeteo(ctx, query, count, language)
}

// SearchCitiesOpenMeteo is the legacy implementation using Open-Meteo's geocoding API.
// Kept as fallback since it includes timezone info directly.
func SearchCitiesOpenMeteo(ctx context.Context, query string, count int, language string) ([]GeoPoint, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, errors.New("city required")
	}
	// Users may store/display values like "City, Admin, Country".
	// Open-Meteo's geocoding "name" parameter is more reliable with just the city token.
	if i := strings.IndexAny(q, ",，"); i >= 0 {
		q = strings.TrimSpace(q[:i])
		if q == "" {
			return nil, errors.New("city required")
		}
	}
	if count <= 0 {
		count = 8
	}
	if count > 20 {
		count = 20
	}

	langNorm := normalizeGeoLanguage(language)
	isCJKQuery := containsCJK(q)

	// Collect results from multiple searches to handle Open-Meteo's inconsistent data
	// Chinese search often misses major cities that English search finds correctly
	type enrichedResult struct {
		geoResult
		NameZh   string // Simplified Chinese name
		NameEn   string // English name
		Admin1Zh string
		Admin1En string
	}

	resultByID := make(map[int]*enrichedResult)

	// Helper to merge results
	mergeResults := func(payload geoPayload, isZh bool) {
		for _, r := range payload.Results {
			if r.ID == 0 {
				continue
			}
			if existing, ok := resultByID[r.ID]; ok {
				// Merge data
				if isZh {
					if existing.NameZh == "" {
						existing.NameZh = strings.TrimSpace(r.Name)
					}
					if existing.Admin1Zh == "" {
						existing.Admin1Zh = strings.TrimSpace(r.Admin1)
					}
				} else {
					if existing.NameEn == "" {
						existing.NameEn = strings.TrimSpace(r.Name)
					}
					if existing.Admin1En == "" {
						existing.Admin1En = strings.TrimSpace(r.Admin1)
					}
				}
				// Keep higher population
				if r.Population > existing.Population {
					existing.Population = r.Population
				}
			} else {
				er := &enrichedResult{geoResult: r}
				if isZh {
					er.NameZh = strings.TrimSpace(r.Name)
					er.Admin1Zh = strings.TrimSpace(r.Admin1)
				} else {
					er.NameEn = strings.TrimSpace(r.Name)
					er.Admin1En = strings.TrimSpace(r.Admin1)
				}
				resultByID[r.ID] = er
			}
		}
	}

	// If the query is Chinese, also try searching with pinyin
	// Open-Meteo's search works much better with pinyin for major Chinese cities
	pinyinQuery := ""
	if isCJKQuery {
		pinyinQuery = getPinyinVariant(q)
	}

	// Always search in English first (better coverage for major cities)
	if payloadEn, err := fetchGeo(ctx, q, count*2, "en"); err == nil {
		mergeResults(payloadEn, false)
	}

	// If we have a pinyin variant, search with that too (much better results for major cities)
	if pinyinQuery != "" {
		if payloadPinyin, err := fetchGeo(ctx, pinyinQuery, count*2, "en"); err == nil {
			mergeResults(payloadPinyin, false)
		}
	}

	// Also search in Chinese (for local names)
	if payloadZh, err := fetchGeo(ctx, q, count*2, "zh"); err == nil {
		mergeResults(payloadZh, true)
	}

	// For Chinese display, also fetch zh-CN for simplified names
	if langNorm == "zh" {
		if payloadCN, err := fetchGeo(ctx, q, count*2, "zh-CN"); err == nil {
			for _, r := range payloadCN.Results {
				if r.ID == 0 {
					continue
				}
				if existing, ok := resultByID[r.ID]; ok {
					name := strings.TrimSpace(r.Name)
					if name != "" {
						existing.NameZh = name
					}
				}
			}
		}
		// Also get Chinese names for pinyin search results
		if pinyinQuery != "" {
			// First get zh-CN for simplified city names
			if payloadCN, err := fetchGeo(ctx, pinyinQuery, count*2, "zh-CN"); err == nil {
				for _, r := range payloadCN.Results {
					if r.ID == 0 {
						continue
					}
					if existing, ok := resultByID[r.ID]; ok {
						name := strings.TrimSpace(r.Name)
						if name != "" && existing.NameZh == "" {
							existing.NameZh = name
						}
					}
				}
			}
			// Then get zh for proper admin1/country Chinese names
			if payloadZhPinyin, err := fetchGeo(ctx, pinyinQuery, count*2, "zh"); err == nil {
				for _, r := range payloadZhPinyin.Results {
					if r.ID == 0 {
						continue
					}
					if existing, ok := resultByID[r.ID]; ok {
						admin1 := strings.TrimSpace(r.Admin1)
						if admin1 != "" && existing.Admin1Zh == "" {
							existing.Admin1Zh = admin1
						}
						// Also update country if not set
						country := strings.TrimSpace(r.Country)
						if country != "" && containsCJK(country) {
							existing.Country = country
						}
					}
				}
			}
		}
	}

	// If query is CJK but we got no results, the English search might have worked
	// with pinyin, so we're good. If nothing found, return error.
	if len(resultByID) == 0 {
		return nil, errors.New("city not found")
	}

	// Convert to slice and sort by population (descending)
	results := make([]*enrichedResult, 0, len(resultByID))
	for _, r := range resultByID {
		results = append(results, r)
	}
	sort.Slice(results, func(i, j int) bool {
		// Higher population first
		return results[i].Population > results[j].Population
	})

	// Deduplicate by approximate location (to 0.01 degree ≈ 1km)
	type locKey struct{ lat, lon int }
	seen := make(map[locKey]bool)

	out := make([]GeoPoint, 0, count)
	for _, r := range results {
		if len(out) >= count {
			break
		}

		// Round to 2 decimal places for dedup
		key := locKey{
			lat: int(math.Round(r.Latitude * 100)),
			lon: int(math.Round(r.Longitude * 100)),
		}
		if seen[key] {
			continue
		}
		seen[key] = true

		// Build display name based on language preference
		var name, admin1, country string
		if langNorm == "zh" {
			name = r.NameZh
			if name == "" {
				name = r.NameEn
			}
			admin1 = r.Admin1Zh
			if admin1 == "" {
				admin1 = r.Admin1En
			}
			// Country in Chinese
			country = strings.TrimSpace(r.Country)
			if country == "China" || country == "" {
				country = "中国"
			}
		} else {
			name = r.NameEn
			if name == "" {
				name = r.NameZh
			}
			admin1 = r.Admin1En
			if admin1 == "" {
				admin1 = r.Admin1Zh
			}
			country = strings.TrimSpace(r.Country)
		}

		if name == "" {
			name = strings.TrimSpace(r.Name)
		}

		dn := name
		if admin1 != "" && country != "" {
			dn = dn + ", " + admin1 + ", " + country
		} else if country != "" {
			dn = dn + ", " + country
		}

		out = append(out, GeoPoint{
			Lat:         r.Latitude,
			Lon:         r.Longitude,
			DisplayName: dn,
			Timezone:    strings.TrimSpace(r.Timezone),
		})
	}

	if len(out) == 0 {
		return nil, errors.New("city not found")
	}

	return out, nil
}

// GeocodeCity resolves a free-form city name to a single lat/lon via Open-Meteo's geocoding API.
// This lets the frontend stay city-only (no manual lat/lon).
func GeocodeCity(ctx context.Context, city string) (GeoPoint, error) {
	list, err := SearchCities(ctx, city, 1, "en")
	if err != nil {
		return GeoPoint{}, err
	}
	if len(list) == 0 {
		return GeoPoint{}, errors.New("city not found")
	}
	return list[0], nil
}

// GeocodeCityLocalized resolves a free-form city name to a single lat/lon via Open-Meteo's geocoding API,
// returning a display name localized to the requested language.
func GeocodeCityLocalized(ctx context.Context, city string, language string) (GeoPoint, error) {
	list, err := SearchCities(ctx, city, 1, language)
	if err != nil {
		return GeoPoint{}, err
	}
	if len(list) == 0 {
		return GeoPoint{}, errors.New("city not found")
	}
	return list[0], nil
}
