import { useEffect, useRef, useState } from 'react'
import { apiGet } from '../api'
import type { AppItem, Weather, MarketsResponse, HolidaysResponse, HostMetrics } from '../types'
import { safeParseJSON, widgetKindFromUrl } from '../utils'

export interface UseWidgetsResult {
    /** Weather data for default widget */
    weather: Weather | null
    weatherErr: string | null
    /** Weather data by widget ID */
    weatherById: Record<string, Weather | null>
    weatherErrById: Record<string, string | null>
    /** Markets data by widget ID */
    marketsById: Record<string, MarketsResponse | null>
    marketsErrById: Record<string, string | null>
    /** Holidays data by widget ID */
    holidaysById: Record<string, HolidaysResponse | null>
    holidaysErrById: Record<string, string | null>
    /** Host metrics */
    metrics: HostMetrics | null
    /** Network rate */
    netRate: { upBps: number; downBps: number } | null
}

interface UseWidgetsOptions {
    apps: AppItem[]
    lang: 'zh' | 'en'
    defaultCity?: string
}

/**
 * Normalize country codes - dedupe and uppercase
 */
function normalizeCountryCodes(codes: string[]): string[] {
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
 * Hook for managing widget data fetching
 */
export function useWidgets({ apps, lang, defaultCity }: UseWidgetsOptions): UseWidgetsResult {
    const [weather, setWeather] = useState<Weather | null>(null)
    const [weatherErr, setWeatherErr] = useState<string | null>(null)
    const [weatherById, setWeatherById] = useState<Record<string, Weather | null>>({})
    const [weatherErrById, setWeatherErrById] = useState<Record<string, string | null>>({})

    const [marketsById, setMarketsById] = useState<Record<string, MarketsResponse | null>>({})
    const [marketsErrById, setMarketsErrById] = useState<Record<string, string | null>>({})

    const [holidaysById, setHolidaysById] = useState<Record<string, HolidaysResponse | null>>({})
    const [holidaysErrById, setHolidaysErrById] = useState<Record<string, string | null>>({})

    const [metrics, setMetrics] = useState<HostMetrics | null>(null)
    const [netRate, setNetRate] = useState<{ upBps: number; downBps: number } | null>(null)
    const lastMetricsRef = useRef<HostMetrics | null>(null)

    // Fetch default weather
    useEffect(() => {
        if (!defaultCity) return
        let cancelled = false

        void (async () => {
            try {
                const qs = new URLSearchParams({ city: defaultCity, lang })
                const wx = await apiGet<Weather>(`/api/widgets/weather?${qs.toString()}`)
                if (!cancelled) {
                    setWeather(wx)
                    setWeatherErr(null)
                }
            } catch (e) {
                if (!cancelled) {
                    setWeather(null)
                    setWeatherErr(e instanceof Error ? e.message : 'failed')
                }
            }
        })()

        return () => {
            cancelled = true
        }
    }, [defaultCity, lang])

    // Fetch weather for each weather widget
    useEffect(() => {
        let cancelled = false
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'weather')
        if (ws.length === 0) {
            setWeatherById({})
            setWeatherErrById({})
            return
        }

        void (async () => {
            const next: Record<string, Weather | null> = {}
            const nextErr: Record<string, string | null> = {}

            await Promise.all(
                ws.map(async (a) => {
                    const cfg = safeParseJSON(a.description)
                    const city = String(cfg?.city ?? '').trim()
                    if (!city) {
                        next[a.id] = null
                        nextErr[a.id] = null
                        return
                    }

                    // De-duplicate with default
                    if (city === defaultCity) {
                        return
                    }

                    try {
                        const qs = new URLSearchParams({ city, lang })
                        const wx = await apiGet<Weather>(`/api/widgets/weather?${qs.toString()}`)
                        next[a.id] = wx
                        nextErr[a.id] = null
                    } catch (e) {
                        next[a.id] = null
                        nextErr[a.id] = e instanceof Error ? e.message : 'failed'
                    }
                })
            )

            if (!cancelled) {
                setWeatherById(next)
                setWeatherErrById(nextErr)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [apps, lang, defaultCity])

    // Fetch markets data
    useEffect(() => {
        let cancelled = false
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'markets')
        if (ws.length === 0) {
            setMarketsById({})
            setMarketsErrById({})
            return
        }

        const run = async () => {
            const next: Record<string, MarketsResponse | null> = {}
            const nextErr: Record<string, string | null> = {}

            await Promise.all(
                ws.map(async (a) => {
                    const cfg = safeParseJSON(a.description)
                    const rawSymbols = Array.isArray(cfg?.symbols) ? (cfg?.symbols as unknown[]) : []
                    const symbols = rawSymbols.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 4)
                    if (symbols.length === 0) {
                        next[a.id] = null
                        nextErr[a.id] = null
                        return
                    }
                    try {
                        const qs = new URLSearchParams({ symbols: symbols.join(',') })
                        const res = await apiGet<MarketsResponse>(`/api/widgets/markets?${qs.toString()}`)
                        next[a.id] = res
                        nextErr[a.id] = null
                    } catch (e) {
                        next[a.id] = null
                        nextErr[a.id] = e instanceof Error ? e.message : 'failed'
                    }
                })
            )

            if (!cancelled) {
                setMarketsById(next)
                setMarketsErrById(nextErr)
            }
        }

        void run()
        const id = window.setInterval(run, 5 * 60 * 1000)
        return () => {
            cancelled = true
            window.clearInterval(id)
        }
    }, [apps])

    // Fetch holidays data
    useEffect(() => {
        let cancelled = false
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'holidays')
        if (ws.length === 0) {
            setHolidaysById({})
            setHolidaysErrById({})
            return
        }

        const run = async () => {
            const next: Record<string, HolidaysResponse | null> = {}
            const nextErr: Record<string, string | null> = {}

            await Promise.all(
                ws.map(async (a) => {
                    const cfg = safeParseJSON(a.description)
                    const rawCountries = Array.isArray(cfg?.countries) ? (cfg?.countries as unknown[]) : []
                    const countries = normalizeCountryCodes(rawCountries.map((x) => String(x ?? '')))
                    if (countries.length === 0) {
                        next[a.id] = null
                        nextErr[a.id] = null
                        return
                    }
                    try {
                        const qs = new URLSearchParams({ countries: countries.join(',') })
                        const res = await apiGet<HolidaysResponse>(`/api/widgets/holidays?${qs.toString()}`)
                        next[a.id] = res
                        nextErr[a.id] = null
                    } catch (e) {
                        next[a.id] = null
                        nextErr[a.id] = e instanceof Error ? e.message : 'failed'
                    }
                })
            )

            if (!cancelled) {
                setHolidaysById(next)
                setHolidaysErrById(nextErr)
            }
        }

        void run()
        const id = window.setInterval(run, 5 * 60 * 1000)
        return () => {
            cancelled = true
            window.clearInterval(id)
        }
    }, [apps])

    // Fetch host metrics
    useEffect(() => {
        let cancelled = false

        const metricsWidgets = apps.filter((a) => widgetKindFromUrl(a.url) === 'metrics')
        const intervalMs = (() => {
            if (metricsWidgets.length === 0) return 5000
            let best = 1000
            for (const a of metricsWidgets) {
                const cfg = safeParseJSON(a.description)
                const rs = Number(cfg?.refreshSec)
                const ms = (rs === 5 || rs === 10 ? rs : 1) * 1000
                best = Math.min(best, ms)
            }
            return best
        })()

        const run = async () => {
            try {
                const m = await apiGet<HostMetrics>('/api/metrics/host')
                if (cancelled) return
                const prev = lastMetricsRef.current
                if (
                    prev &&
                    typeof prev.collectedAt === 'number' &&
                    typeof m.collectedAt === 'number' &&
                    m.collectedAt > prev.collectedAt
                ) {
                    const dt = (m.collectedAt - prev.collectedAt) / 1000
                    if (dt > 0) {
                        const sentDiff = Math.max(0, m.netBytesSent - prev.netBytesSent)
                        const recvDiff = Math.max(0, m.netBytesRecv - prev.netBytesRecv)
                        setNetRate({ upBps: sentDiff / dt, downBps: recvDiff / dt })
                    }
                }
                lastMetricsRef.current = m
                setMetrics(m)
            } catch {
                if (!cancelled) {
                    setMetrics(null)
                    setNetRate(null)
                }
            }
        }

        void run()
        const id = window.setInterval(run, intervalMs)
        return () => {
            cancelled = true
            window.clearInterval(id)
        }
    }, [apps])

    return {
        weather,
        weatherErr,
        weatherById,
        weatherErrById,
        marketsById,
        marketsErrById,
        holidaysById,
        holidaysErrById,
        metrics,
        netRate,
    }
}

export default useWidgets
