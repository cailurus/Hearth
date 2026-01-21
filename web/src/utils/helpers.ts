/**
 * 通用工具函数
 */

import type { WidgetKind } from '../types'
import { WIDGET_URL_PREFIX, WIDGET_KINDS, DEFAULT_TIMEZONE } from './constants'

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
export function normalizeIanaTimeZone(tz: string, fallback: string = DEFAULT_TIMEZONE): string {
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
 * 获取系统时区
 */
export function getSystemTimezone(): string {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
        return normalizeIanaTimeZone(tz, DEFAULT_TIMEZONE)
    } catch {
        return DEFAULT_TIMEZONE
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
export function widgetKindFromUrl(url: string): WidgetKind | null {
    const s = String(url || '')
    if (!s.startsWith(WIDGET_URL_PREFIX)) return null
    const rest = s.slice(WIDGET_URL_PREFIX.length)
    const kind = rest.split(/[?#]/)[0] as WidgetKind
    if (WIDGET_KINDS.includes(kind)) return kind
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
export function safeParseJSON<T = Record<string, unknown>>(input: string | null): T | null {
    if (!input) return null
    try {
        const parsed = JSON.parse(input)
        if (typeof parsed === 'object' && parsed !== null) return parsed as T
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
 * 确保有 4 个市场符号
 */
export function ensureFourMarketSymbols(
    raw: unknown,
    defaults: readonly string[] = ['BTC', 'ETH', 'AAPL', 'MSFT']
): string[] {
    const cleaned = (Array.isArray(raw) ? raw : [])
        .map((s) => String(s ?? '').trim().toUpperCase())
        .filter(Boolean)
    const unique: string[] = []
    for (const s of cleaned) {
        if (unique.length >= 4) break
        if (!unique.includes(s)) unique.push(s)
    }
    while (unique.length < 4) unique.push(defaults[unique.length] || 'BTC')
    return unique.slice(0, 4)
}

/**
 * 判断是否为 widget 类型的 item
 */
export function isWidgetItem(url: string): boolean {
    return url?.startsWith(WIDGET_URL_PREFIX) ?? false
}

/**
 * 判断是否为系统组
 */
export function isSystemGroup(kind: string, name: string): boolean {
    return (
        kind === 'system' ||
        name === '系统组件' ||
        name === 'System Tools' ||
        name === 'System Widgets'
    )
}

/**
 * 创建翻译函数
 */
export function createTranslator(lang: 'zh' | 'en') {
    return (zh: string, en: string) => (lang === 'en' ? en : zh)
}

/**
 * 显示分组名称（支持中英文切换）
 */
export function displayGroupName(raw: string, lang: 'zh' | 'en'): string {
    const s = String(raw ?? '').trim()
    if (!s) return ''

    // 特殊处理默认系统组名称
    if (s === '系统组件') return lang === 'en' ? 'System Widgets' : '系统组件'
    if (s === 'System Widgets') return lang === 'en' ? 'System Widgets' : '系统组件'
    if (s === 'System Tools') return lang === 'en' ? 'System Widgets' : '系统组件'
    if (s.toLowerCase().includes('system tools') && s.includes('系统组件'))
        return lang === 'en' ? 'System Widgets' : '系统组件'
    if (s.toLowerCase().includes('system widgets') && s.includes('系统组件'))
        return lang === 'en' ? 'System Widgets' : '系统组件'

    return s
}

/**
 * 计算时区偏移分钟数
 */
export function timeZoneOffsetMinutes(tz: string, d: Date): number {
    const safeTz = normalizeIanaTimeZone(tz, 'UTC')
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: safeTz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(d)
    const y = Number(parts.find((p) => p.type === 'year')?.value || '0')
    const m = Number(parts.find((p) => p.type === 'month')?.value || '1')
    const da = Number(parts.find((p) => p.type === 'day')?.value || '1')
    const hh = Number(parts.find((p) => p.type === 'hour')?.value || '0')
    const mm = Number(parts.find((p) => p.type === 'minute')?.value || '0')
    const ss = Number(parts.find((p) => p.type === 'second')?.value || '0')
    const asUTC = Date.UTC(y, m - 1, da, hh, mm, ss)
    return Math.round((asUTC - d.getTime()) / 60000)
}

/**
 * 计算时区差异元数据
 */
export function tzDeltaMeta(
    now: number,
    localTz: string,
    otherTz: string,
): { dayLabel: string; offsetLabel: string; isDay: boolean } {
    const d = new Date(now)
    const safeLocal = normalizeIanaTimeZone(localTz, 'Asia/Shanghai')
    const safeOther = normalizeIanaTimeZone(otherTz, 'UTC')

    // 计算日期差异
    const localParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: safeLocal,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(d)
    const otherParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: safeOther,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(d)

    const localKey = `${localParts.find((p) => p.type === 'year')?.value}-${localParts.find((p) => p.type === 'month')?.value}-${localParts.find((p) => p.type === 'day')?.value}`
    const otherKey = `${otherParts.find((p) => p.type === 'year')?.value}-${otherParts.find((p) => p.type === 'month')?.value}-${otherParts.find((p) => p.type === 'day')?.value}`

    const dayLabel = otherKey > localKey ? 'Tomorrow' : otherKey < localKey ? 'Yesterday' : 'Today'

    const diffMin = timeZoneOffsetMinutes(safeOther, d) - timeZoneOffsetMinutes(safeLocal, d)
    const diffHours = Math.round(diffMin / 60)
    const abs = Math.abs(diffHours)
    const suffix = abs === 1 ? 'HR' : 'HRS'
    const offsetLabel = diffHours === 0 ? '0HRS' : `${diffHours > 0 ? '+' : '-'}${abs}${suffix}`

    const otherHour = Number(
        new Intl.DateTimeFormat('en-US', { timeZone: safeOther, hour: '2-digit', hourCycle: 'h23' })
            .formatToParts(d)
            .find((p) => p.type === 'hour')?.value || '0',
    )
    const isDay = otherHour >= 7 && otherHour <= 18

    return { dayLabel, offsetLabel, isDay }
}

/**
 * 高亮匹配文本
 */
export function highlightMatch(text: string, query: string): { before: string; match: string; after: string } | null {
    if (!query) return null
    const lower = text.toLowerCase()
    const qLower = query.toLowerCase()
    const idx = lower.indexOf(qLower)
    if (idx < 0) return null
    return {
        before: text.slice(0, idx),
        match: text.slice(idx, idx + query.length),
        after: text.slice(idx + query.length),
    }
}

/**
 * 美化公司名称（转换全大写为首字母大写）
 */
export function prettifyCompanyName(name: string): string {
    const s = String(name || '').trim()
    if (!s) return ''
    const hasLetters = /[A-Za-z]/.test(s)
    const isAllCaps = hasLetters && s === s.toUpperCase() && s !== s.toLowerCase()
    if (!isAllCaps) return s
    return s
        .toLowerCase()
        .split(/\s+/g)
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(' ')
}

/**
 * 世界时钟城市类型
 */
export type WorldClockCity = { city: string; timezone: string }

/**
 * 默认世界时钟城市列表
 */
export const DEFAULT_CLOCKS: WorldClockCity[] = [
    { city: 'Tokyo, Tokyo, Japan', timezone: 'Asia/Tokyo' },
    { city: 'Paris, Île-de-France, France', timezone: 'Europe/Paris' },
    { city: 'New York, NY, United States', timezone: 'America/New_York' },
    { city: 'London, England, United Kingdom', timezone: 'Europe/London' },
]

/**
 * 从配置中解析世界时钟城市列表
 */
export function clocksFromCfg(cfg: unknown): WorldClockCity[] {
    const cfgObj = typeof cfg === 'object' && cfg !== null ? (cfg as Record<string, unknown>) : null
    const clocks = cfgObj && Array.isArray(cfgObj.clocks) ? (cfgObj.clocks as unknown[]) : null
    if (!clocks) return DEFAULT_CLOCKS
    const normalized = clocks
        .slice(0, 4)
        .map((c, i) => {
            const obj = typeof c === 'object' && c !== null ? (c as Record<string, unknown>) : null
            return {
                city: String(obj?.city ?? '').trim() || DEFAULT_CLOCKS[i]?.city || `City ${i + 1}`,
                timezone: String(obj?.timezone ?? '').trim() || DEFAULT_CLOCKS[i]?.timezone || 'UTC',
            }
        })
    while (normalized.length < 4) normalized.push(DEFAULT_CLOCKS[normalized.length] || { city: `City ${normalized.length + 1}`, timezone: 'UTC' })
    return normalized
}
