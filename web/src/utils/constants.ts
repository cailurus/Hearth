/**
 * 常量定义
 */

/**
 * 默认市场符号
 */
export const DEFAULT_MARKET_SYMBOLS = ['BTC', 'ETH', 'AAPL', 'MSFT'] as const

/**
 * 默认时区
 */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai'

/**
 * 默认假日国家
 */
export const DEFAULT_HOLIDAY_COUNTRIES = ['CN', 'US'] as const

/**
 * 背景刷新间隔选项
 */
export const BACKGROUND_INTERVALS = ['0', '1h', '3h', '6h', '12h', '24h'] as const

/**
 * Metrics 刷新间隔选项
 */
export const METRICS_REFRESH_OPTIONS = [1, 5, 10] as const

/**
 * Widget URL 前缀
 */
export const WIDGET_URL_PREFIX = 'widget:'

/**
 * 支持的 Widget 类型
 */
export const WIDGET_KINDS = ['weather', 'metrics', 'timezones', 'markets', 'holidays'] as const
