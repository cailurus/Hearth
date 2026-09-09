import type { DataSource, SourceError } from '../types'
import { getWidgetStatus } from './widgetStatus'

export function getWidgetSources(data: unknown): DataSource[] {
    if (!data || typeof data !== 'object') return []
    const entries = 'sources' in data && Array.isArray(data.sources) ? data.sources : []
    const result = new Map<string, DataSource>()
    for (const entry of [data, ...entries]) {
        const { source, sourceUrl } = getWidgetStatus(entry)
        if (source) result.set(source, { source, sourceUrl })
    }
    return [...result.values()]
}

export function getWidgetSourceErrors(data: unknown): SourceError[] {
    if (!data || typeof data !== 'object' || !('sourceErrors' in data) || !Array.isArray(data.sourceErrors)) return []
    return data.sourceErrors.filter((entry): entry is SourceError =>
        !!entry && typeof entry === 'object' && typeof entry.source === 'string' && typeof entry.error === 'string',
    )
}
