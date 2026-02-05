/**
 * Widget 配置序列化和解析工具
 */

import { DEFAULT_CLOCKS, normalizeCountryCodes, safeParseJSON } from './helpers'

export type WidgetKind = 'weather' | 'timezones' | 'metrics' | 'markets' | 'holidays'

export interface WorldClockCity {
    city: string
    timezone: string
}

export interface WeatherConfig {
    city: string
}

export interface MetricsConfig {
    showCpu: boolean
    showMem: boolean
    showDisk: boolean
    showNet: boolean
    refreshSec: 1 | 5 | 10
}

export interface MarketsConfig {
    symbols: string[]
}

export interface HolidaysConfig {
    countries: string[]
}

export interface TimezonesConfig {
    clocks: WorldClockCity[]
}

export interface WidgetConfigState {
    weatherCity: string
    tzClocks: WorldClockCity[]
    mkSymbols: string[]
    mkQueries: string[]
    hCountryCodes: string[]
    hCountryQuery: string
    mShowCpu: boolean
    mShowMem: boolean
    mShowDisk: boolean
    mShowNet: boolean
    mRefreshSec: 1 | 5 | 10
}

const DEFAULT_MARKET_SYMBOLS = ['BTC', 'ETH', 'AAPL', 'MSFT']

/**
 * 确保市场符号数组包含 4 个有效符号
 */
export function ensureFourMarketSymbols(raw: unknown): string[] {
    const cleaned = (Array.isArray(raw) ? raw : [])
        .map((s) => String(s ?? '').trim().toUpperCase())
        .filter(Boolean)

    const unique: string[] = []
    for (const s of cleaned) {
        if (unique.length >= 4) break
        if (!unique.includes(s)) unique.push(s)
    }

    while (unique.length < 4) {
        unique.push(DEFAULT_MARKET_SYMBOLS[unique.length] || 'BTC')
    }

    return unique.slice(0, 4)
}

/**
 * 规范化时钟条目
 */
export function normalizeClockEntry(
    clock: unknown,
    fallbackCity: string,
    fallbackTz: string
): WorldClockCity {
    const c = typeof clock === 'object' && clock !== null ? (clock as Record<string, unknown>) : {}
    return {
        city: String(c.city ?? '').trim() || fallbackCity,
        timezone: String(c.timezone ?? '').trim() || fallbackTz,
    }
}

/**
 * 序列化 Widget 配置为 JSON 字符串
 */
export function serializeWidgetConfig(
    kind: WidgetKind,
    config: Partial<WidgetConfigState>
): string {
    switch (kind) {
        case 'weather':
            return JSON.stringify({ city: (config.weatherCity || '').trim() })

        case 'metrics':
            return JSON.stringify({
                showCpu: !!config.mShowCpu,
                showMem: !!config.mShowMem,
                showDisk: !!config.mShowDisk,
                showNet: !!config.mShowNet,
                refreshSec: config.mRefreshSec || 1,
            })

        case 'markets': {
            const symbols = ensureFourMarketSymbols(config.mkSymbols || [])
            return JSON.stringify({ symbols })
        }

        case 'holidays': {
            const countries = normalizeCountryCodes(config.hCountryCodes || [])
            return JSON.stringify({ countries })
        }

        case 'timezones': {
            const clocks = (config.tzClocks || []).slice(0, 4)
            while (clocks.length < 4) {
                const idx = clocks.length
                clocks.push({
                    city: DEFAULT_CLOCKS[idx]?.city || `City ${idx + 1}`,
                    timezone: DEFAULT_CLOCKS[idx]?.timezone || 'UTC',
                })
            }
            return JSON.stringify({
                clocks: clocks.map((c, idx) => ({
                    city: String(c.city ?? '').trim() || DEFAULT_CLOCKS[idx]?.city || `City ${idx + 1}`,
                    timezone: String(c.timezone ?? '').trim() || DEFAULT_CLOCKS[idx]?.timezone || 'UTC',
                })),
            })
        }
    }
}

/**
 * 解析 Widget 配置
 */
export function parseWidgetConfig(
    kind: WidgetKind,
    description: string | null
): Partial<WidgetConfigState> {
    const cfg = safeParseJSON(description)

    switch (kind) {
        case 'weather': {
            const city = String(cfg?.city ?? '').trim()
            return { weatherCity: city || 'Shanghai, Shanghai, China' }
        }

        case 'metrics': {
            return {
                mShowCpu: cfg?.showCpu !== false,
                mShowMem: cfg?.showMem !== false,
                mShowDisk: cfg?.showDisk !== false,
                mShowNet: cfg?.showNet !== false,
                mRefreshSec:
                    Number(cfg?.refreshSec) === 5 ? 5 : Number(cfg?.refreshSec) === 10 ? 10 : 1,
            }
        }

        case 'markets': {
            const symbols = Array.isArray(cfg?.symbols) ? (cfg?.symbols as unknown[]) : null
            const next = ensureFourMarketSymbols(symbols || [])
            return { mkSymbols: next, mkQueries: next }
        }

        case 'holidays': {
            const countries = Array.isArray(cfg?.countries) ? (cfg?.countries as unknown[]) : null
            const norm = normalizeCountryCodes(
                countries ? countries.map((x) => String(x ?? '')) : []
            )
            return { hCountryCodes: norm.length ? norm : ['CN', 'US'], hCountryQuery: '' }
        }

        case 'timezones': {
            const clocks = Array.isArray(cfg?.clocks) ? (cfg.clocks as unknown[]) : null
            if (clocks && clocks.length === 4) {
                return {
                    tzClocks: clocks.map((c, i) =>
                        normalizeClockEntry(
                            c,
                            DEFAULT_CLOCKS[i]?.city || `City ${i + 1}`,
                            DEFAULT_CLOCKS[i]?.timezone || 'UTC'
                        )
                    ),
                }
            }
            return { tzClocks: [...DEFAULT_CLOCKS] }
        }
    }
}

/**
 * 获取默认的 Widget 配置状态
 */
export function getDefaultWidgetConfigState(): WidgetConfigState {
    return {
        weatherCity: 'Shanghai, Shanghai, China',
        tzClocks: [...DEFAULT_CLOCKS],
        mkSymbols: [...DEFAULT_MARKET_SYMBOLS],
        mkQueries: [...DEFAULT_MARKET_SYMBOLS],
        hCountryCodes: ['CN', 'US'],
        hCountryQuery: '',
        mShowCpu: true,
        mShowMem: true,
        mShowDisk: true,
        mShowNet: true,
        mRefreshSec: 1,
    }
}
