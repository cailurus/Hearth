/**
 * Widget Registry types — shared across the registry, useWidgets generic
 * loop, and individual widget definitions.
 *
 * The two carve-outs (defaultWeather + metricsShared) deliberately do NOT
 * fit into this shape; they live as top-level fields on UseWidgetsResult.
 * See docs/superpowers/specs/2026-05-02-widget-registry-design.md.
 */

import type { ComponentType } from 'react'

export interface WidgetSpec<TConfig = unknown, TData = unknown> {
    /** Type literal matching the widget URL `widget:<kind>`. */
    readonly kind: string

    /** i18n key — replaces the WIDGET_LABEL_KEYS table. */
    readonly labelKey: string

    /** Default config; merged under any user cfg in safeParseJSON(a.description). */
    readonly defaultConfig: TConfig

    /**
     * Optional one-shot data fetch.
     *  - signal: AbortController signal — replaces the closure cancelled-boolean pattern
     *  - returns TData or throws (throw lands in slice.error)
     *  - undefined means the widget renders local data only (timezones / notes)
     */
    readonly fetchData?: (cfg: TConfig, signal: AbortSignal) => Promise<TData>

    /**
     * Polling interval (ms) for fetchData:
     *  - number: fixed
     *  - function: derived from cfg (docker uses cfg.refreshSec; markets fixed 5min)
     *  - undefined: fetch once on mount / cfg change, no polling
     *
     * Only meaningful when fetchData is set.
     */
    readonly pollIntervalMs?: number | ((cfg: TConfig) => number)

    /**
     * Renderer. The 5 standard props:
     *  - data / error / cfg: from the byId slice + parsed cfg
     *  - refresh: per-instance manual refresh (RSS etc)
     *  - isAdmin: ambient admin flag (Notes / Docker etc)
     *
     * Other ambient state (lang, localTimezone, ...) widgets read via hooks
     * (useTranslation) or browser APIs (Intl.DateTimeFormat) internally.
     */
    readonly Component: ComponentType<{
        data: TData | null
        error: string | null
        cfg: TConfig
        refresh: () => void
        isAdmin: boolean
    }>
}

/**
 * Slice shape stored in the byId Map.  Type-erased on purpose: the cast
 * happens once inside defineWidget() so consumers see precise types and
 * the generic useWidgets loop can iterate without knowing TConfig/TData.
 */
export interface WidgetSlice {
    kind: string
    data: unknown
    error: string | null
    refresh: () => void
}

/**
 * Factory — identity at runtime, used purely for type-inference closure.
 * Each widget file does:
 *   export const fooWidget = defineWidget<FooConfig, FooData>({...})
 * and the rest of the codebase consumes the type-erased WidgetSpec.
 */
export function defineWidget<TConfig, TData>(
    spec: WidgetSpec<TConfig, TData>,
): WidgetSpec {
    return spec as unknown as WidgetSpec
}
