export interface WidgetStatus {
    fetchedAt?: number
    stale: boolean
    refreshing: boolean
    warning?: string
    source?: string
    sourceUrl?: string
}

export function getWidgetStatus(data: unknown): WidgetStatus {
    if (!data || typeof data !== 'object') return { stale: false, refreshing: false }
    const fetchedAt = 'fetchedAt' in data && typeof data.fetchedAt === 'number' && data.fetchedAt > 0
        ? data.fetchedAt : undefined
    return {
        fetchedAt,
        stale: 'stale' in data && data.stale === true,
        refreshing: 'refreshing' in data && data.refreshing === true,
        warning: 'warning' in data && typeof data.warning === 'string' ? data.warning : undefined,
        source: 'source' in data && typeof data.source === 'string' ? data.source : undefined,
        sourceUrl: 'sourceUrl' in data && typeof data.sourceUrl === 'string' && /^https?:\/\//.test(data.sourceUrl)
            ? data.sourceUrl : undefined,
    }
}
