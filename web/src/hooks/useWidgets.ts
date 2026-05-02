import { useEffect, useRef, useState } from 'react'
import { apiGet } from '../api'
import type { AppItem, Weather, HostMetrics } from '../types'
import { safeParseJSON, widgetKindFromUrl } from '../utils'
import { getWidget } from '../widgets/registry'
import type { WidgetSlice } from '../widgets/types'

export interface UseWidgetsResult {
    /** Per-instance fetch state for all registry widgets. */
    byId: Map<string, WidgetSlice>
    /** Default-city weather (when user configured defaultCity but added no weather widget). */
    weather: Weather | null
    weatherErr: string | null
    /** Host metrics — shared across all metrics widget instances. */
    metrics: HostMetrics | null
    /** Network rate derived from metrics samples. */
    netRate: { upBps: number; downBps: number } | null
}

interface UseWidgetsOptions {
    apps: AppItem[]
    lang: 'zh' | 'en'
    defaultCity?: string
}

/**
 * Hook for managing widget data fetching.
 *
 * The 8 LEGACY per-widget useEffects (weather/markets/holidays/docker/
 * currency/deals/rss) are gone — the generic registry loop replaces them
 * for any kind in WIDGET_REGISTRY. Two carve-outs remain:
 *  - defaultWeather: pulls weather for `defaultCity` even when the user
 *    has no weather widget instance.
 *  - metrics: shared-interval polling + cpu%/network-rate derivation.
 *    Stays inline because metrics is rendered as inline JSX in
 *    GroupBlock, not as a registry component.
 */
export function useWidgets({ apps, lang, defaultCity }: UseWidgetsOptions): UseWidgetsResult {
    const [byId, setById] = useState<Map<string, WidgetSlice>>(() => new Map())

    const [weather, setWeather] = useState<Weather | null>(null)
    const [weatherErr, setWeatherErr] = useState<string | null>(null)

    const [metrics, setMetrics] = useState<HostMetrics | null>(null)
    const [netRate, setNetRate] = useState<{ upBps: number; downBps: number } | null>(null)
    const lastMetricsRef = useRef<HostMetrics | null>(null)

    // Generic registry-driven fetch loop. Handles every widget kind in
    // WIDGET_REGISTRY (currently 9 of the 10 kinds — metrics is the
    // carve-out further down).
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

    // Carve-out 1: default weather (no widget instance, just defaultCity).
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

    // Carve-out 2: host metrics. Shared interval across all metrics widget
    // instances (interval is the min refreshSec across all instances, or
    // 5s when there are no metrics widgets at all). Network rate is
    // derived from successive samples.
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
        byId,
        weather,
        weatherErr,
        metrics,
        netRate,
    }
}
