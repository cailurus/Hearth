import { useEffect, useRef, useState } from 'react'
import { apiGet } from '../api'
import i18n from '../i18n'
import type { AppItem, Weather, HostMetrics } from '../types'
import { safeParseJSON, widgetKindFromUrl } from '../utils'
import { getWidget } from '../widgets/registry'
import type { WidgetSlice } from '../widgets/types'
import { getWidgetStatus } from '../utils/widgetStatus'

export interface UseWidgetsResult {
    byId: Map<string, WidgetSlice>
    weather: Weather | null
    weatherErr: string | null
    metrics: HostMetrics | null
    metricsErr: string | null
    netRate: { upBps: number; downBps: number } | null
}

interface UseWidgetsOptions {
    apps: AppItem[]
    lang: 'zh' | 'en'
    defaultCity?: string
    defaultLat?: number
    defaultLon?: number
}

interface ActiveWidget {
    key: string
    configKey: string
    dispose: () => void
}

function configObject(value: unknown): object {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function useWidgets({ apps, lang, defaultCity, defaultLat, defaultLon }: UseWidgetsOptions): UseWidgetsResult {
    const [byId, setById] = useState<Map<string, WidgetSlice>>(() => new Map())
    const activeRef = useRef(new Map<string, ActiveWidget>())
    const [weather, setWeather] = useState<Weather | null>(null)
    const [weatherErr, setWeatherErr] = useState<string | null>(null)
    const [metrics, setMetrics] = useState<HostMetrics | null>(null)
    const [metricsErr, setMetricsErr] = useState<string | null>(null)
    const [netRate, setNetRate] = useState<{ upBps: number; downBps: number } | null>(null)
    const lastMetricsRef = useRef<HostMetrics | null>(null)

    useEffect(() => {
        const active = activeRef.current
        const liveIDs = new Set<string>()

        for (const app of apps) {
            const kind = widgetKindFromUrl(app.url)
            const spec = kind ? getWidget(kind) : undefined
            if (!kind || !spec?.fetchData) continue
            const fetchData = spec.fetchData
            liveIDs.add(app.id)
            const cfg = { ...configObject(spec.defaultConfig), ...configObject(safeParseJSON(app.description)) }
            const configKey = JSON.stringify([kind, cfg])
            const key = `${lang}:${configKey}`
            const previous = active.get(app.id)
            if (previous?.key === key) continue
            previous?.dispose()

            let disposed = false
            let controller: AbortController | null = null
            let timer: number | undefined
            const rawInterval = spec.pollIntervalMs
            const interval = typeof rawInterval === 'function' ? rawInterval(cfg) : rawInterval
            const baseInterval = typeof interval === 'number' && interval > 0 ? interval : undefined

            const load = async (force = false) => {
                if (disposed || (controller && !force)) return
                if (timer !== undefined) window.clearTimeout(timer)
                controller?.abort()
                const current = new AbortController()
                controller = current
                let timedOut = false
                let nextInterval = baseInterval
                const timeout = window.setTimeout(() => {
                    timedOut = true
                    current.abort()
                }, 25000)

                setById((prev) => {
                    const slice = prev.get(app.id)
                    if (!slice) return prev
                    const next = new Map(prev)
                    next.set(app.id, { ...slice, loading: slice.data == null, refreshing: slice.data != null })
                    return next
                })

                try {
                    const data = await fetchData(cfg, current.signal, { force, lang })
                    if (disposed || current.signal.aborted || controller !== current) return
                    const status = getWidgetStatus(data)
                    if (status.refreshing) nextInterval = 2000
                    else if (status.warning) nextInterval = Math.min(baseInterval ?? 60000, 15000)
                    setById((prev) => {
                        const next = new Map(prev)
                        next.set(app.id, {
                            kind, data, error: null, refresh: () => { void load(true) },
                            loading: false, refreshing: status.refreshing,
                        })
                        return next
                    })
                } catch (error) {
                    if (disposed || controller !== current || (current.signal.aborted && !timedOut)) return
                    nextInterval = Math.min(baseInterval ?? 60000, 15000)
                    setById((prev) => {
                        const slice = prev.get(app.id)
                        if (!slice) return prev
                        const next = new Map(prev)
                        next.set(app.id, {
                            ...slice,
                            error: timedOut ? i18n.t('widgets:requestTimeout')
                                : error instanceof Error ? error.message : i18n.t('common:widgetError'),
                            loading: false, refreshing: false,
                        })
                        return next
                    })
                } finally {
                    window.clearTimeout(timeout)
                    if (!disposed && controller === current) {
                        controller = null
                        if (nextInterval !== undefined) timer = window.setTimeout(() => { void load() }, nextInterval)
                    }
                }
            }

            active.set(app.id, {
                key, configKey,
                dispose: () => {
                    disposed = true
                    controller?.abort()
                    if (timer !== undefined) window.clearTimeout(timer)
                },
            })
            setById((prev) => {
                const old = previous?.configKey === configKey ? prev.get(app.id) : undefined
                const next = new Map(prev)
                next.set(app.id, {
                    kind, data: old?.data ?? null, error: null,
                    refresh: () => { void load(true) }, loading: old?.data == null, refreshing: old?.data != null,
                })
                return next
            })
            void load()
        }

        for (const [id, widget] of active) {
            if (!liveIDs.has(id)) {
                widget.dispose()
                active.delete(id)
            }
        }
        setById((prev) => {
            if ([...prev.keys()].every((id) => liveIDs.has(id))) return prev
            return new Map([...prev].filter(([id]) => liveIDs.has(id)))
        })
    }, [apps, lang])

    useEffect(() => {
        const active = activeRef.current
        return () => {
            active.forEach((widget) => widget.dispose())
            active.clear()
        }
    }, [])

    const hasWeatherWidget = apps.some((app) => widgetKindFromUrl(app.url) === 'weather')
    useEffect(() => {
        setWeather(null)
        setWeatherErr(null)
        if (!defaultCity || hasWeatherWidget) return
        const controller = new AbortController()
        const query = new URLSearchParams({ city: defaultCity, lang })
        if (defaultLat !== undefined && defaultLon !== undefined) {
            query.set('lat', String(defaultLat))
            query.set('lon', String(defaultLon))
        }
        void apiGet<Weather>(`/api/widgets/weather?${query}`, { signal: controller.signal })
            .then((value) => { if (!controller.signal.aborted) setWeather(value) })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) {
                    setWeatherErr(error instanceof Error ? error.message : i18n.t('common:widgetError'))
                }
            })
        return () => controller.abort()
    }, [defaultCity, defaultLat, defaultLon, hasWeatherWidget, lang])

    const metricIntervals = apps.filter((app) => widgetKindFromUrl(app.url) === 'metrics').map((app) => {
        const seconds = Number(safeParseJSON(app.description)?.refreshSec)
        return (seconds === 5 || seconds === 10 ? seconds : 1) * 1000
    })
    const metricsInterval = metricIntervals.length > 0 ? Math.min(...metricIntervals) : null
    useEffect(() => {
        if (metricsInterval === null) {
            setMetrics(null)
            setMetricsErr(null)
            setNetRate(null)
            lastMetricsRef.current = null
            return
        }
        let disposed = false
        let timer: number | undefined
        let controller: AbortController | null = null
        const load = async () => {
            controller = new AbortController()
            try {
                const value = await apiGet<HostMetrics>('/api/metrics/host', { signal: controller.signal })
                if (disposed) return
                const previous = lastMetricsRef.current
                if (previous && value.collectedAt > previous.collectedAt) {
                    const seconds = (value.collectedAt - previous.collectedAt) / 1000
                    setNetRate({
                        upBps: Math.max(0, value.netBytesSent - previous.netBytesSent) / seconds,
                        downBps: Math.max(0, value.netBytesRecv - previous.netBytesRecv) / seconds,
                    })
                }
                lastMetricsRef.current = value
                setMetrics(value)
                setMetricsErr(null)
            } catch (error) {
                if (!disposed) setMetricsErr(error instanceof Error ? error.message : i18n.t('common:widgetError'))
            } finally {
                if (!disposed) timer = window.setTimeout(load, metricsInterval)
            }
        }
        void load()
        return () => {
            disposed = true
            controller?.abort()
            if (timer !== undefined) window.clearTimeout(timer)
        }
    }, [metricsInterval])

    return { byId, weather, weatherErr, metrics, metricsErr, netRate }
}
