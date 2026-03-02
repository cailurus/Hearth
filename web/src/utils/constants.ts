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
export const WIDGET_KINDS = ['weather', 'metrics', 'timezones', 'markets', 'holidays', 'docker'] as const
