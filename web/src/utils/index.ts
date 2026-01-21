/**
 * 工具函数统一导出
 */

// 常量
export {
    DEFAULT_MARKET_SYMBOLS,
    DEFAULT_TIMEZONE,
    DEFAULT_HOLIDAY_COUNTRIES,
    BACKGROUND_INTERVALS,
    METRICS_REFRESH_OPTIONS,
    WIDGET_URL_PREFIX,
    WIDGET_KINDS,
} from './constants'

// 格式化函数
export {
    formatBytes,
    formatPercent,
    formatPrice,
    formatTime,
    formatDate,
    formatDateStr,
    formatDayName,
    getCountryFlag,
    ymdKey,
    formatBytesPerSec,
    formatGiB,
    weekdayLabel,
    shortenCpuModelName,
} from './formatting'

// 通用工具函数
export {
    cityShort,
    ianaCityLabel,
    normalizeIanaTimeZone,
    getSystemTimezone,
    normalizeCountryCodes,
    widgetKindFromUrl,
    widgetQueryFromUrl,
    safeParseJSON,
    fetchWithTimeout,
    ensureFourMarketSymbols,
    isWidgetItem,
    isSystemGroup,
    createTranslator,
    displayGroupName,
    timeZoneOffsetMinutes,
    tzDeltaMeta,
    highlightMatch,
    prettifyCompanyName,
    clocksFromCfg,
    DEFAULT_CLOCKS,
} from './helpers'

// 导出类型
export type { WorldClockCity } from './helpers'

// 天气相关
export {
    weatherKind,
    weatherCodeLabel,
} from './weather'

export type { WeatherKind } from './weather'

// 市场相关
export {
    normalizeMarketSymbol,
    iconForMarketSymbol,
} from './markets'

export type { KnownMarketSymbol } from './markets'
