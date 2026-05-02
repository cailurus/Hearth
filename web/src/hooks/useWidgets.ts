import { useEffect, useRef, useState } from 'react'
import { apiGet } from '../api'
import type { AppItem, Weather, MarketsResponse, HolidaysResponse, HostMetrics, RSSResponse, CurrencyResponse, DealsResponse } from '../types'
import type { DockerResponse } from '../types/models'
import { safeParseJSON, widgetKindFromUrl, normalizeCountryCodes } from '../utils'
import { getWidget } from '../widgets/registry'
import type { WidgetSlice } from '../widgets/types'

export interface UseWidgetsResult {
    /** Per-instance fetch state for widgets that have been migrated to the registry. */
    byId: Map<string, WidgetSlice>
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
    /** Currency data by widget ID */
    currencyById: Record<string, CurrencyResponse | null>
    currencyErrById: Record<string, string | null>
    /** Deals data by widget ID */
    dealsById: Record<string, DealsResponse | null>
    dealsErrById: Record<string, string | null>
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
    const [byId, setById] = useState<Map<string, WidgetSlice>>(() => new Map())

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

    const [currencyById, setCurrencyById] = useState<Record<string, CurrencyResponse | null>>({})
    const [currencyErrById, setCurrencyErrById] = useState<Record<string, string | null>>({})

    const [dealsById, setDealsById] = useState<Record<string, DealsResponse | null>>({})
    const [dealsErrById, setDealsErrById] = useState<Record<string, string | null>>({})

    const [rssById, setRssById] = useState<Record<string, RSSResponse | null>>({})
    const [rssErrById, setRssErrById] = useState<Record<string, string | null>>({})
    const [rssRefreshSeq, setRssRefreshSeq] = useState(0)
    const [rssRefreshing, setRssRefreshing] = useState(false)

    const [metrics, setMetrics] = useState<HostMetrics | null>(null)
    const [netRate, setNetRate] = useState<{ upBps: number; downBps: number } | null>(null)
    const lastMetricsRef = useRef<HostMetrics | null>(null)

    // Generic registry-driven fetch loop. Handles every widget that has been
    // migrated to defineWidget(). Old per-widget effects below skip kinds
    // already in the registry to avoid duplicate work.
    useEffect(() => {
        const controllers = new Map<string, AbortController>()
        const timers = new Map<string, number>()

        type Inst = { id: string; kind: string; spec: NonNullable<ReturnType<typeof getWidget>>; cfg: unknown }
        const instances: Inst[] = []
        for (const a of apps) {
            const kind = widgetKindFromUrl(a.url)
            if (!kind) continue
            const spec = getWidget(kind)
            if (!spec) continue
            const cfg = { ...(spec.defaultConfig as object), ...((safeParseJSON(a.description) as object | null) ?? {}) }
            instances.push({ id: a.id, kind, spec, cfg })
        }

        // Drop any byId entries for apps that no longer exist.
        setById((prev) => {
            const liveIds = new Set(instances.map((i) => i.id))
            let dirty = false
            const next = new Map(prev)
            for (const id of prev.keys()) {
                if (!liveIds.has(id)) {
                    next.delete(id)
                    dirty = true
                }
            }
            return dirty ? next : prev
        })

        for (const inst of instances) {
            const fetchOnce = async () => {
                if (!inst.spec.fetchData) return
                controllers.get(inst.id)?.abort()
                const ctrl = new AbortController()
                controllers.set(inst.id, ctrl)
                try {
                    const data = await inst.spec.fetchData(inst.cfg, ctrl.signal)
                    setById((prev) => {
                        const next = new Map(prev)
                        next.set(inst.id, {
                            kind: inst.kind,
                            data,
                            error: null,
                            refresh: fetchOnce,
                        })
                        return next
                    })
                } catch (e) {
                    if (ctrl.signal.aborted) return
                    setById((prev) => {
                        const next = new Map(prev)
                        next.set(inst.id, {
                            kind: inst.kind,
                            data: null,
                            error: e instanceof Error ? e.message : 'failed',
                            refresh: fetchOnce,
                        })
                        return next
                    })
                }
            }

            // Seed a placeholder slice so consumers see refresh() immediately.
            setById((prev) => {
                if (prev.has(inst.id)) return prev
                const next = new Map(prev)
                next.set(inst.id, {
                    kind: inst.kind,
                    data: null,
                    error: null,
                    refresh: fetchOnce,
                })
                return next
            })

            void fetchOnce()

            const intervalRaw = inst.spec.pollIntervalMs
            const intervalMs = typeof intervalRaw === 'function'
                ? intervalRaw(inst.cfg)
                : intervalRaw
            if (typeof intervalMs === 'number' && intervalMs > 0) {
                const t = window.setInterval(fetchOnce, intervalMs)
                timers.set(inst.id, t)
            }
        }

        return () => {
            controllers.forEach((c) => c.abort())
            timers.forEach((t) => window.clearInterval(t))
        }
    }, [apps])

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

    // Fetch weather for each weather widget — skipped during migration if registry handles it.
    useEffect(() => {
        let cancelled = false
        if (getWidget('weather')) {
            setWeatherById({})
            setWeatherErrById({})
            return
        }
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
        if (getWidget('markets')) {
            setMarketsById({})
            setMarketsErrById({})
            return
        }
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

    // Fetch holidays data — skipped during migration if registry handles it.
    useEffect(() => {
        let cancelled = false
        if (getWidget('holidays')) {
            // Registry handles this kind; clear LEGACY state and bail.
            setHolidaysById({})
            setHolidaysErrById({})
            return
        }
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
        if (getWidget('docker')) {
            setDockerById({})
            setDockerErrById({})
            return
        }
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

    // Fetch currency data — skipped during migration if registry handles it.
    useEffect(() => {
        let cancelled = false
        if (getWidget('currency')) {
            // Registry handles this kind; clear LEGACY state and bail.
            setCurrencyById({})
            setCurrencyErrById({})
            return
        }
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'currency')
        if (ws.length === 0) {
            setCurrencyById({})
            setCurrencyErrById({})
            return
        }

        const run = async () => {
            const next: Record<string, CurrencyResponse | null> = {}
            const nextErr: Record<string, string | null> = {}

            await Promise.all(
                ws.map(async (a) => {
                    const cfg = safeParseJSON(a.description)
                    const rawPairs = Array.isArray(cfg?.pairs) ? (cfg?.pairs as unknown[]) : []
                    const pairs = rawPairs.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 4)
                    if (pairs.length === 0) {
                        next[a.id] = { fetchedAt: 0, items: [] }
                        nextErr[a.id] = null
                        return
                    }
                    try {
                        const qs = new URLSearchParams({ pairs: pairs.join(',') })
                        const res = await apiGet<CurrencyResponse>(`/api/widgets/currency?${qs.toString()}`)
                        next[a.id] = res
                        nextErr[a.id] = null
                    } catch (e) {
                        next[a.id] = null
                        nextErr[a.id] = e instanceof Error ? e.message : 'failed'
                    }
                })
            )

            if (!cancelled) {
                setCurrencyById(next)
                setCurrencyErrById(nextErr)
            }
        }

        void run()
        const id = window.setInterval(run, 5 * 60 * 1000)
        return () => { cancelled = true; window.clearInterval(id) }
    }, [apps])

    // Fetch deals data — skipped during migration if registry handles it.
    useEffect(() => {
        let cancelled = false
        if (getWidget('deals')) {
            setDealsById({})
            setDealsErrById({})
            return
        }
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'deals')
        if (ws.length === 0) {
            setDealsById({})
            setDealsErrById({})
            return
        }

        const run = async () => {
            // Use region from the first deals widget config.
            const cfg = safeParseJSON(ws[0].description)
            const region = String(cfg?.region ?? 'us').trim()

            try {
                const qs = new URLSearchParams({ region })
                const data = await apiGet<DealsResponse>(`/api/widgets/deals?${qs.toString()}`)
                if (cancelled) return
                const next: Record<string, DealsResponse | null> = {}
                const nextErr: Record<string, string | null> = {}
                for (const a of ws) {
                    next[a.id] = data
                    nextErr[a.id] = null
                }
                setDealsById(next)
                setDealsErrById(nextErr)
            } catch (e) {
                if (cancelled) return
                const next: Record<string, DealsResponse | null> = {}
                const nextErr: Record<string, string | null> = {}
                for (const a of ws) {
                    next[a.id] = null
                    nextErr[a.id] = e instanceof Error ? e.message : 'failed'
                }
                setDealsById(next)
                setDealsErrById(nextErr)
            }
        }

        void run()
        const id = window.setInterval(run, 15 * 60 * 1000)
        return () => { cancelled = true; window.clearInterval(id) }
    }, [apps])

    // Fetch RSS data
    useEffect(() => {
        let cancelled = false
        if (getWidget('rss')) {
            setRssById({})
            setRssErrById({})
            return
        }
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
        byId,
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
        currencyById,
        currencyErrById,
        dealsById,
        dealsErrById,
    }
}

export default useWidgets
