import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getWidgetStatus } from '../../utils/widgetStatus'
import { getWidgetSourceErrors, getWidgetSources } from '../../utils/widgetSources'

interface WidgetStatusFooterProps {
    data?: unknown
    error?: string | null
    loading?: boolean
    refreshing?: boolean
    refresh?: () => void
    className?: string
}

export function WidgetStatusFooter({ data, error, loading, refreshing, refresh, className = '' }: WidgetStatusFooterProps) {
    const { t, i18n } = useTranslation(['widgets', 'common'])
    const status = getWidgetStatus(data)
    const sources = getWidgetSources(data)
    const sourceErrors = getWidgetSourceErrors(data)
    const busy = !!(loading || refreshing || (!error && status.refreshing))
    const date = status.fetchedAt ? new Date(status.fetchedAt * 1000) : null
    const updated = date && Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat(i18n.language === 'en' ? 'en' : 'zh', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }).format(date) : null
    const labels = [
        status.stale || (updated && error) ? t('widgets:cachedData') : null,
        busy ? t('widgets:refreshingData') : null,
        error ? t(updated || status.stale ? 'widgets:refreshFailed' : 'widgets:requestFailed')
            : sourceErrors.length ? t('widgets:sourceFailures', { count: sourceErrors.length })
                : status.warning ? t('widgets:partialData') : null,
    ].filter(Boolean)
    const detail = [error || status.warning, ...sourceErrors.map(({ source, error: message }) => `${source}: ${message}`)].filter(Boolean).join(' · ') || undefined
    const retry = !!(error || status.warning || status.stale || sourceErrors.length)

    if (!updated && !sources.length && !labels.length && !refresh) return null

    return (
        <div className={`mt-1.5 flex min-w-0 shrink-0 items-center gap-2 text-[9px] leading-tight text-white/50 sm:text-[10px] ${className}`}>
            <div className="min-w-0 flex-1">
                {updated || sources.length ? (
                    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                        {updated ? (
                            <time className="truncate" dateTime={date!.toISOString()} title={date!.toLocaleString()}>
                                {t('widgets:lastUpdated', { time: updated })}
                            </time>
                        ) : null}
                        {updated && sources.length ? <span aria-hidden="true">·</span> : null}
                        {sources.map(({ source, sourceUrl }) => (
                            sourceUrl ? (
                                <a className="truncate underline decoration-white/30 underline-offset-2 hover:text-white/80 focus-visible:text-white"
                                    key={source} href={sourceUrl} target="_blank" rel="noopener noreferrer"
                                    title={t('widgets:dataSource', { source })}>
                                    {source}
                                </a>
                            ) : <span key={source} className="truncate" title={t('widgets:dataSource', { source })}>{source}</span>
                        ))}
                    </div>
                ) : null}
                <div role="status" aria-live="polite" aria-atomic="true" className={detail ? 'text-amber-200/75' : ''}>
                    {labels.length ? <span className="block truncate" title={detail} aria-label={detail ? `${labels.join(' · ')}: ${detail}` : undefined}>{labels.join(' · ')}</span> : null}
                </div>
            </div>
            {refresh ? (
                <button type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); refresh() }}
                    className="flex shrink-0 items-center gap-1 rounded p-1 text-white/65 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/70 disabled:opacity-40"
                    aria-label={t(retry ? 'common:retry' : 'widgets:refreshData')}
                    title={t(retry ? 'common:retry' : 'widgets:refreshData')}>
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    {retry ? <span>{t('common:retry')}</span> : null}
                </button>
            ) : null}
        </div>
    )
}
