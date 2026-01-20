/**
 * 通用工具函数
 */

/**
 * 从城市标签中提取简短名称
 */
export function cityShort(label: string): string {
    const s = String(label ?? '').trim()
    if (!s) return ''
    const first = s.split(',')[0]?.split('，')[0]?.trim()
    return first || s
}

/**
 * 从 IANA 时区字符串中提取城市标签
 */
export function ianaCityLabel(timezone: string): string {
    const tz = String(timezone || '').trim()
    if (!tz) return ''
    const last = tz.split('/').pop() || tz
    return last.replace(/_/g, ' ').trim()
}

/**
 * 标准化 IANA 时区字符串
 */
export function normalizeIanaTimeZone(tz: string, fallback: string): string {
    const candidate = String(tz || '').trim()
    if (!candidate) return fallback
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0))
        return candidate
    } catch {
        return fallback
    }
}

/**
 * 标准化国家代码数组
 */
export function normalizeCountryCodes(codes: string[]): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    for (const raw of codes) {
        const c = String(raw || '').trim().toUpperCase()
        if (c.length !== 2) continue
        if (c < 'AA' || c > 'ZZ') continue
        if (seen.has(c)) continue
        seen.add(c)
        out.push(c)
    }
    return out
}

/**
 * 从 widget URL 中提取类型
 */
export type WidgetKind = 'weather' | 'metrics' | 'timezones' | 'markets' | 'holidays'

export function widgetKindFromUrl(url: string): WidgetKind | null {
    const s = String(url || '')
    if (!s.startsWith('widget:')) return null
    const rest = s.slice('widget:'.length)
    const kind = rest.split(/[?#]/)[0]
    if (
        kind === 'weather' ||
        kind === 'metrics' ||
        kind === 'timezones' ||
        kind === 'markets' ||
        kind === 'holidays'
    )
        return kind
    return null
}

/**
 * 从 widget URL 中提取查询参数
 */
export function widgetQueryFromUrl(url: string): URLSearchParams {
    const s = String(url || '')
    const i = s.indexOf('?')
    if (i < 0) return new URLSearchParams()
    return new URLSearchParams(s.slice(i + 1))
}

/**
 * 安全解析 JSON
 */
export function safeParseJSON(input: string | null): Record<string, unknown> | null {
    if (!input) return null
    try {
        const parsed = JSON.parse(input)
        if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>
        return null
    } catch {
        return null
    }
}

/**
 * 带超时的 fetch
 */
export async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
): Promise<Response> {
    if (typeof AbortController === 'undefined' || timeoutMs <= 0) {
        return await fetch(url, init)
    }
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, { ...init, signal: controller.signal })
    } finally {
        window.clearTimeout(timeoutId)
    }
}

/**
 * 格式化字节数
 */
export function formatBytes(bytes: number, decimals = 1): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i]
}

/**
 * 格式化百分比
 */
export function formatPercent(value: number, decimals = 1): string {
    return value.toFixed(decimals) + '%'
}
