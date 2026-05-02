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
 * Supported widget kinds — registry plus the metrics carve-out.
 *
 * `metrics` stays out of the registry: inline rendering + shared-interval
 * polling don't fit the WidgetSpec shape. See spec § 边界划分:
 * docs/superpowers/specs/2026-05-02-widget-registry-design.md
 */
export const WIDGET_KINDS = [
    ...WIDGET_REGISTRY.map((w) => w.kind),
    'metrics',
] as readonly string[]

export const WIDGET_LABEL_KEYS: Record<string, string> = {
    ...Object.fromEntries(WIDGET_REGISTRY.map((w) => [w.kind, w.labelKey])),
    metrics: 'widgets:systemStatus',
}
