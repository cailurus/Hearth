/**
 * WidgetDataContext — fan-out for the per-widget fetch state produced by
 * `useWidgets`. Previously HomePage drilled ~20 individual widget-data
 * props through GroupBlock (and BookmarkGroup-adjacent paths), which
 * meant every keystroke in an unrelated dialog could re-render the
 * entire dashboard tree.
 *
 * Pattern:
 *   <WidgetDataProvider value={useWidgets(...)}>...</WidgetDataProvider>
 *   const data = useWidgetData()  // inside any widget
 *
 * The provider value should be a stable reference between renders to
 * keep React.memo'd consumers from invalidating; that's currently
 * driven by useWidgets' state shape (each Record<string, ...> is
 * re-created only when its underlying state changes).
 */

import { createContext, useContext, type ReactNode } from 'react'
import type { UseWidgetsResult } from '../hooks'
import type { WidgetSlice } from '../widgets/types'

const WidgetDataContext = createContext<UseWidgetsResult | null>(null)

interface WidgetDataProviderProps {
    value: UseWidgetsResult
    children: ReactNode
}

export function WidgetDataProvider({ value, children }: WidgetDataProviderProps) {
    return <WidgetDataContext.Provider value={value}>{children}</WidgetDataContext.Provider>
}

/**
 * useWidgetData — read the current widget-fetch state. Throws when called
 * outside a `<WidgetDataProvider>` so missing-provider bugs surface
 * loudly instead of silently rendering empty widgets.
 */
export function useWidgetData(): UseWidgetsResult {
    const ctx = useContext(WidgetDataContext)
    if (ctx === null) {
        throw new Error('useWidgetData must be used inside <WidgetDataProvider>')
    }
    return ctx
}

/**
 * useWidgetSlice — read this widget instance's fetch state from the registry.
 *
 * Returns undefined if the kind isn't in the registry (LEGACY path) or the
 * generic loop hasn't seeded a placeholder yet. Component code should treat
 * undefined the same as a slice with null data + null error.
 */
export function useWidgetSlice(widgetId: string): WidgetSlice | undefined {
    const { byId } = useWidgetData()
    return byId.get(widgetId)
}
