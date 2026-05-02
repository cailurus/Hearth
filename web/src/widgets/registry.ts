/**
 * Widget Registry — single source of truth for built-in widgets.
 *
 * Each entry is a WidgetSpec produced by defineWidget(). The tuple is
 * `as const` so TypeScript can derive WidgetKind as a literal union from
 * its members. Add a new widget by:
 *   1. creating <Kind>Widget.tsx that exports `kindWidget = defineWidget(...)`
 *   2. adding the import and tuple entry below
 *
 * `metrics` is intentionally NOT in the registry — its inline rendering
 * + shared-interval polling lives directly in GroupBlock + useWidgets.
 *
 * During migration (stages 1-2) only widgets currently moved over appear
 * here; the LEGACY_KINDS in utils/constants.ts covers the rest.
 */

import type { WidgetSpec } from './types'
import { currencyWidget } from '../components/widgets/CurrencyWidget'
import { dealsWidget } from '../components/widgets/DealsWidget'
import { holidaysWidget } from '../components/widgets/HolidaysWidget'
import { marketsWidget } from '../components/widgets/MarketsWidget'
import { dockerWidget } from '../components/widgets/DockerWidget'
import { weatherWidget } from '../components/widgets/WeatherWidget'
import { rssWidget } from '../components/widgets/RSSWidget'
import { notesWidget } from '../components/widgets/NotesWidget'
import { timezonesWidget } from '../components/widgets/TimezonesWidget'

export const WIDGET_REGISTRY = [
    currencyWidget,
    dealsWidget,
    holidaysWidget,
    marketsWidget,
    dockerWidget,
    weatherWidget,
    rssWidget,
    notesWidget,
    timezonesWidget,
] as const

/** Literal union derived from the tuple — adding a widget extends this automatically. */
export type WidgetKind = (typeof WIDGET_REGISTRY)[number]['kind']

const REGISTRY_MAP = new Map<string, WidgetSpec>(
    WIDGET_REGISTRY.map((w) => [w.kind, w as WidgetSpec]),
)

export function getWidget(kind: string): WidgetSpec | undefined {
    return REGISTRY_MAP.get(kind)
}
