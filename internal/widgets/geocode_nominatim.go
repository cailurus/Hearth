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
	"time"
	"unicode"
)

// nominatimResult represents a single result from Nominatim API
type nominatimResult struct {
	PlaceID     int           `json:"place_id"`
	Lat         string        `json:"lat"`
	Lon         string        `json:"lon"`
	Name        string        `json:"name"`
	DisplayName string        `json:"display_name"`
	Class       string        `json:"class"`
	Type        string        `json:"type"`
	Importance  float64       `json:"importance"`
	AddressType string        `json:"addresstype"`
	Address     nominatimAddr `json:"address"`
}

type nominatimAddr struct {
	City        string `json:"city"`
	Town        string `json:"town"`
	Village     string `json:"village"`
	County      string `json:"county"`
	State       string `json:"state"`
	Province    string `json:"province"`
	Country     string `json:"country"`
	CountryCode string `json:"country_code"`
}

// selectSimplifiedVariant selects the simplified Chinese variant from a string
// Nominatim returns formats like "大倫敦;大伦敦" or "英格兰;英格蘭" or "东京都/東京都"
// The order is inconsistent, so we detect which one is simplified
func selectSimplifiedVariant(s string) string {
	s = strings.TrimSpace(s)

	// Check for semicolon separator (Chinese variants)
	if i := strings.Index(s, ";"); i > 0 && i < len(s)-1 {
		first := strings.TrimSpace(s[:i])
		second := strings.TrimSpace(s[i+1:])
		// Pick the one that is simplified (fewer traditional characters)
		if isMoreSimplified(first, second) {
			return first
		}
		return second
	}

	// Check for slash separator (Japanese/other variants)
	// Pick the first one (usually the common form)
	if i := strings.Index(s, "/"); i > 0 {
		return strings.TrimSpace(s[:i])
	}

	return s
}

// isMoreSimplified returns true if 'a' is more simplified than 'b'
// by checking for common traditional characters
func isMoreSimplified(a, b string) bool {
	// Common traditional characters that differ from simplified
	// 倫->伦, 國->国, 蘭->兰, 東->东, 會->会, etc.
	traditionalChars := []rune{'倫', '國', '蘭', '東', '會', '爲', '齊', '實', '與', '歲',
		'學', '書', '電', '機', '業', '專', '門', '開', '關', '區', '圖', '體', '廣'}

	countTraditional := func(s string) int {
		count := 0
		for _, r := range s {
			for _, t := range traditionalChars {
				if r == t {
					count++
					break
				}
			}
		}
		return count
	}

	return countTraditional(a) < countTraditional(b)
}

// Common Chinese city names to English/pinyin mapping for Nominatim search
// Nominatim doesn't support searching in Chinese, so we need to translate first
var chineseToEnglish = map[string]string{
	// Direct-controlled municipalities
	"北京": "beijing", "上海": "shanghai", "天津": "tianjin", "重庆": "chongqing",
	// Provincial capitals and major cities - Northeast
	"长春": "changchun", "哈尔滨": "harbin", "沈阳": "shenyang", "大连": "dalian",
	// North
	"石家庄": "shijiazhuang", "太原": "taiyuan", "呼和浩特": "hohhot",
	// East
	"济南": "jinan", "青岛": "qingdao", "郑州": "zhengzhou", "武汉": "wuhan",
	"长沙": "changsha", "南京": "nanjing", "杭州": "hangzhou", "合肥": "hefei",
	"南昌": "nanchang", "福州": "fuzhou", "厦门": "xiamen",
	// South
	"广州": "guangzhou", "深圳": "shenzhen", "东莞": "dongguan", "珠海": "zhuhai", "佛山": "foshan",
	"南宁": "nanning", "海口": "haikou",
	// Southwest
	"成都": "chengdu", "贵阳": "guiyang", "昆明": "kunming", "拉萨": "lhasa",
	// Northwest
	"西安": "xian", "兰州": "lanzhou", "西宁": "xining", "银川": "yinchuan", "乌鲁木齐": "urumqi",
	// Other major cities
	"苏州": "suzhou", "无锡": "wuxi", "常州": "changzhou", "宁波": "ningbo",
	"温州": "wenzhou", "嘉兴": "jiaxing", "烟台": "yantai", "潍坊": "weifang",
	"淄博": "zibo", "威海": "weihai", "洛阳": "luoyang", "开封": "kaifeng",
	"唐山": "tangshan", "秦皇岛": "qinhuangdao", "包头": "baotou",
	"鞍山": "anshan", "抚顺": "fushun", "吉林": "jilin city", "齐齐哈尔": "qiqihar",
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
	"台中": "taichung", "台南": "tainan", "新北": "new taipei city",
	// International cities
	"纽约": "new york", "洛杉矶": "los angeles", "旧金山": "san francisco",
	"芝加哥": "chicago", "伦敦": "london", "巴黎": "paris", "东京": "tokyo",
	"首尔": "seoul", "新加坡": "singapore", "悉尼": "sydney", "墨尔本": "melbourne",
	"温哥华": "vancouver", "多伦多": "toronto", "柏林": "berlin", "莫斯科": "moscow",
	"迪拜": "dubai", "曼谷": "bangkok", "吉隆坡": "kuala lumpur",
}

// containsCJKNominatim checks if a string contains CJK characters
func containsCJKNominatim(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

// translateChineseQuery translates a Chinese city name to English/pinyin for search
func translateChineseQuery(query string) string {
	if eng, ok := chineseToEnglish[query]; ok {
		return eng
	}
	return query
}

// fetchNominatim queries the Nominatim API with retry for rate limiting
func fetchNominatim(ctx context.Context, query string, limit int, language string) ([]nominatimResult, error) {
	params := url.Values{}
	params.Set("q", query)
	params.Set("format", "json")
	params.Set("addressdetails", "1")
	params.Set("limit", fmt.Sprintf("%d", limit))

	// Set language preference for output
	if language != "" {
		params.Set("accept-language", language)
	}

	endpoint := "https://nominatim.openstreetmap.org/search?" + params.Encode()

	// Retry up to 3 times with exponential backoff for rate limiting
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			// Wait before retry (1s, 2s)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(attempt) * time.Second):
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		// Nominatim requires a valid User-Agent
		req.Header.Set("User-Agent", "Hearth/1.0 (https://github.com/morezhou/hearth)")

		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}

		// Check for rate limiting (429) or server errors (5xx)
		if resp.StatusCode == 429 || resp.StatusCode >= 500 {
			resp.Body.Close()
			lastErr = fmt.Errorf("nominatim: status=%d", resp.StatusCode)
			continue
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
			resp.Body.Close()
			return nil, fmt.Errorf("nominatim: status=%d body=%s", resp.StatusCode, string(body))
		}

		var results []nominatimResult
		err = json.NewDecoder(resp.Body).Decode(&results)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		return results, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("nominatim: max retries exceeded")
}

// SearchCitiesNominatim searches for cities using Nominatim (OpenStreetMap) API
// This provides better results than Open-Meteo, especially for Chinese cities
func SearchCitiesNominatim(ctx context.Context, query string, count int, language string) ([]GeoPoint, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, errors.New("city required")
	}

	// Extract just the city name if user types "City, State, Country"
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

	// Determine the output language
	langNorm := normalizeGeoLanguage(language)
	acceptLang := "en"
	if langNorm == "zh" {
		acceptLang = "zh-CN,zh"
	}

	// If query is in Chinese, translate to English for search
	// Nominatim doesn't support Chinese input well, but returns Chinese output fine
	searchQuery := q
	if containsCJKNominatim(q) {
		if translated := translateChineseQuery(q); translated != q {
			searchQuery = translated
		} else {
			// If we don't have a translation, try the original query anyway
			// It might be an international city name in Chinese characters
		}
	}

	// Fetch from Nominatim
	results, err := fetchNominatim(ctx, searchQuery, count*2, acceptLang)
	if err != nil {
		return nil, err
	}

	// If Chinese query and no results with translation, try original query as fallback
	if len(results) == 0 && searchQuery != q {
		results, err = fetchNominatim(ctx, q, count*2, acceptLang)
		if err != nil {
			return nil, err
		}
	}

	if len(results) == 0 {
		return nil, errors.New("city not found")
	}

	// Filter and format results
	seen := make(map[int]bool)
	out := make([]GeoPoint, 0, count)

	for _, r := range results {
		if len(out) >= count {
			break
		}

		// Skip duplicates
		if seen[r.PlaceID] {
			continue
		}
		seen[r.PlaceID] = true

		// Parse coordinates
		lat, _ := strconv.ParseFloat(r.Lat, 64)
		lon, _ := strconv.ParseFloat(r.Lon, 64)

		// Build display name from structured address
		displayName := buildDisplayName(r, langNorm)

		out = append(out, GeoPoint{
			Lat:         lat,
			Lon:         lon,
			DisplayName: displayName,
			Timezone:    "", // Will be resolved separately if needed
		})
	}

	if len(out) == 0 {
		return nil, errors.New("city not found")
	}

	return out, nil
}

// buildDisplayName creates a clean display name from Nominatim result
func buildDisplayName(r nominatimResult, lang string) string {
	addr := r.Address

	// Get the city/place name
	var cityName string
	if r.Name != "" {
		cityName = selectSimplifiedVariant(r.Name)
	} else if addr.City != "" {
		cityName = selectSimplifiedVariant(addr.City)
	} else if addr.Town != "" {
		cityName = selectSimplifiedVariant(addr.Town)
	} else if addr.Village != "" {
		cityName = selectSimplifiedVariant(addr.Village)
	} else if addr.County != "" {
		cityName = selectSimplifiedVariant(addr.County)
	}

	// Get state/province (Nominatim uses different fields for different countries)
	state := addr.State
	if state == "" {
		state = addr.Province
	}
	state = selectSimplifiedVariant(state)

	// Get country
	country := selectSimplifiedVariant(addr.Country)

	// Build the display string
	parts := make([]string, 0, 3)
	if cityName != "" {
		parts = append(parts, cityName)
	}
	if state != "" && state != cityName {
		parts = append(parts, state)
	}
	if country != "" {
		parts = append(parts, country)
	}

	if len(parts) == 0 {
		// Fallback to raw display name
		return r.DisplayName
	}

	return strings.Join(parts, ", ")
}

// GeocodeCityNominatim resolves a city name to coordinates using Nominatim
func GeocodeCityNominatim(ctx context.Context, city string, language string) (GeoPoint, error) {
	list, err := SearchCitiesNominatim(ctx, city, 1, language)
	if err != nil {
		return GeoPoint{}, err
	}
	if len(list) == 0 {
		return GeoPoint{}, errors.New("city not found")
	}

	pt := list[0]

	// Resolve timezone if not set
	if pt.Timezone == "" {
		if tz, err := ResolveTimezone(ctx, fmt.Sprintf("%f", pt.Lat), fmt.Sprintf("%f", pt.Lon)); err == nil {
			pt.Timezone = tz
		}
	}

	return pt, nil
}
