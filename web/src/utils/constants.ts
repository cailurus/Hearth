/**
 * 常量定义
 */

import { WIDGET_REGISTRY } from '../widgets/registry'

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
 * Widget kinds NOT yet in the registry. Once stage 2 finishes migrating
 * each widget, remove its entry here. When this array is empty, also
 * delete it and the LEGACY label table below — at that point the
 * registry is the sole source of truth.
 *
 * `metrics` stays here permanently (carve-out: inline rendering +
 * shared-interval polling, doesn't fit the registry shape).
 */
const LEGACY_KINDS = [
    'metrics',
    'timezones',
    'notes',
    'rss',
] as const

const LEGACY_LABEL_KEYS: Record<string, string> = {
    metrics: 'widgets:systemStatus',
    timezones: 'widgets:worldClock',
    notes: 'widgets:notes',
    rss: 'widgets:rss',
}

/**
 * 支持的 Widget 类型 — registry 推导项与 LEGACY 项合并。
 */
export const WIDGET_KINDS = [
    ...WIDGET_REGISTRY.map((w) => w.kind),
    ...LEGACY_KINDS,
] as readonly string[]

/**
 * Widget i18n label keys — registry 推导项 + LEGACY 项合并。
 */
export const WIDGET_LABEL_KEYS: Record<string, string> = {
    ...Object.fromEntries(WIDGET_REGISTRY.map((w) => [w.kind, w.labelKey])),
    ...LEGACY_LABEL_KEYS,
}
