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
 * Widget URL 前缀
 */
export const WIDGET_URL_PREFIX = 'widget:'

/**
 * 支持的 Widget 类型
 */
export const WIDGET_KINDS = ['weather', 'metrics', 'timezones', 'markets', 'holidays', 'docker', 'notes', 'rss', 'currency', 'deals'] as const

/**
 * Widget i18n label keys — single source of truth for all widget display names.
 */
export const WIDGET_LABEL_KEYS: Record<string, string> = {
    weather: 'widgets:weather',
    metrics: 'widgets:systemStatus',
    timezones: 'widgets:worldClock',
    markets: 'widgets:markets',
    holidays: 'widgets:upcomingHolidays',
    docker: 'widgets:docker',
    notes: 'widgets:notes',
    rss: 'widgets:rss',
    currency: 'widgets:currency',
    deals: 'widgets:deals',
}
