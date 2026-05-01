/**
 * 工具函数统一导出
 */

// 常量
export {
    DEFAULT_MARKET_SYMBOLS,
    DEFAULT_TIMEZONE,
    WIDGET_URL_PREFIX,
} from './constants'

// 格式化函数
export {
    formatBytes,
    formatPercent,
    formatTime,
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
    normalizeCountryCodes,
    widgetKindFromUrl,
    widgetQueryFromUrl,
    safeParseJSON,
    fetchWithTimeout,
    ensureFourMarketSymbols,
    isWidgetItem,
    isSystemGroup,
    displayGroupName,
    tzDeltaMeta,
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
} from './markets'

export type { KnownMarketSymbol } from './markets'

export { isPrivateHost } from './network'

export { browserProbe } from './browserProbe'
export type { BrowserProbeResult } from './browserProbe'
