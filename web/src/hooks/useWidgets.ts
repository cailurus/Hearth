import { useEffect, useRef, useState } from 'react'
import { apiGet } from '../api'
import type { AppItem, Weather, MarketsResponse, HolidaysResponse, HostMetrics, RSSResponse } from '../types'
import type { DockerResponse } from '../types/models'
import { safeParseJSON, widgetKindFromUrl, normalizeCountryCodes } from '../utils'

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
    /** Docker data by widget ID */
    dockerById: Record<string, DockerResponse | null>
    dockerErrById: Record<string, string | null>
    /** RSS data by widget ID */
    rssById: Record<string, RSSResponse | null>
    rssErrById: Record<string, string | null>
    /** Trigger RSS refresh (bypass cache) */
    refreshRss: () => void
    /** Whether RSS is currently refreshing */
    rssRefreshing: boolean
}

interface UseWidgetsOptions {
    apps: AppItem[]
    lang: 'zh' | 'en'
    defaultCity?: string
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

    const [dockerById, setDockerById] = useState<Record<string, DockerResponse | null>>({})
    const [dockerErrById, setDockerErrById] = useState<Record<string, string | null>>({})

    const [rssById, setRssById] = useState<Record<string, RSSResponse | null>>({})
    const [rssErrById, setRssErrById] = useState<Record<string, string | null>>({})
    const [rssRefreshSeq, setRssRefreshSeq] = useState(0)
    const [rssRefreshing, setRssRefreshing] = useState(false)

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

        // Clear old data immediately so the loading skeleton shows the new
        // city name from config while fresh weather data is being fetched.
        setWeatherById({})
        setWeatherErrById({})

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
    }, [apps, lang])

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

    // Fetch docker data
    useEffect(() => {
        let cancelled = false
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'docker')
        if (ws.length === 0) {
            setDockerById({})
            setDockerErrById({})
            return
        }

        let intervalMs = 5000
        for (const a of ws) {
            const cfg = safeParseJSON(a.description)
            const rs = Number(cfg?.refreshSec)
            const ms = (rs === 10 || rs === 30 ? rs : 5) * 1000
            intervalMs = Math.min(intervalMs, ms)
        }

        const run = async () => {
            try {
                const data = await apiGet<DockerResponse>('/api/widgets/docker')
                if (cancelled) return
                const next: Record<string, DockerResponse | null> = {}
                const nextErr: Record<string, string | null> = {}
                for (const a of ws) {
                    next[a.id] = data
                    nextErr[a.id] = null
                }
                setDockerById(next)
                setDockerErrById(nextErr)
            } catch (e) {
                if (cancelled) return
                const next: Record<string, DockerResponse | null> = {}
                const nextErr: Record<string, string | null> = {}
                for (const a of ws) {
                    next[a.id] = null
                    nextErr[a.id] = e instanceof Error ? e.message : 'failed'
                }
                setDockerById(next)
                setDockerErrById(nextErr)
            }
        }

        void run()
        const id = window.setInterval(run, intervalMs)
        return () => {
            cancelled = true
            window.clearInterval(id)
        }
    }, [apps])

    // Fetch RSS data
    useEffect(() => {
        let cancelled = false
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'rss')
        if (ws.length === 0) {
            setRssById({})
            setRssErrById({})
            return
        }

        const isManualRefresh = rssRefreshSeq > 0

        const run = async (useNoCache: boolean) => {
            if (useNoCache) setRssRefreshing(true)

            const next: Record<string, RSSResponse | null> = {}
            const nextErr: Record<string, string | null> = {}

            await Promise.all(
                ws.map(async (a) => {
                    const cfg = safeParseJSON(a.description)
                    const rawFeeds = Array.isArray(cfg?.feeds) ? (cfg?.feeds as unknown[]) : []
                    const feeds = rawFeeds.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 10)
                    if (feeds.length === 0) {
                        next[a.id] = { fetchedAt: 0, items: [] }
                        nextErr[a.id] = null
                        return
                    }
                    try {
                        const qs = new URLSearchParams()
                        for (const f of feeds) qs.append('feed', f)
                        if (useNoCache) qs.set('nocache', '1')
                        const res = await apiGet<RSSResponse>(`/api/widgets/rss?${qs.toString()}`)
                        next[a.id] = res
                        nextErr[a.id] = null
                    } catch (e) {
                        next[a.id] = null
                        nextErr[a.id] = e instanceof Error ? e.message : 'failed'
                    }
                })
            )

            if (!cancelled) {
                setRssById(next)
                setRssErrById(nextErr)
                setRssRefreshing(false)
            }
        }

        void run(isManualRefresh)
        const id = window.setInterval(() => run(false), 15 * 60 * 1000)
        return () => {
            cancelled = true
            window.clearInterval(id)
        }
    }, [apps, rssRefreshSeq])

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
        dockerById,
        dockerErrById,
        rssById,
        rssErrById,
        refreshRss: () => setRssRefreshSeq((n) => n + 1),
        rssRefreshing,
    }
}

export default useWidgets
