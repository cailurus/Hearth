import type { MarketQuote, MarketsResponse } from '../../types'
import { prettifyCompanyName } from '../../utils'
import { MarketLogo } from './MarketLogo'
import { MiniSparkline } from './MiniSparkline'
import { Spinner } from '../ui/Spinner'
import { defineWidget } from '../../widgets/types'
import { apiGet } from '../../api'
import { useTranslation } from 'react-i18next'
import { financialRowState, formatMarketPrice } from '../../utils/financialDisplay'

interface MarketsWidgetProps {
    data: MarketsResponse | null
    error?: string | null
    symbols?: string[] // configured symbols — shown immediately before data loads
}

/**
 * Render a single market row (shared between loaded and placeholder states).
 */
function MarketRow({ sym, item, loading, error }: { sym: string; item?: MarketQuote; loading: boolean; error?: string | null }) {
    const { t, i18n } = useTranslation('widgets')
    const price = formatMarketPrice(item, sym, i18n.language)
    const hasData = price !== null
    const pending = financialRowState(hasData, item, loading, error) === 'pending'
    const name = prettifyCompanyName(String(item?.name || '').trim())
    const pct = hasData && typeof item?.changePct24h === 'number' && Number.isFinite(item.changePct24h) ? item.changePct24h : null
    const pctLabel = pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
    const pctColor = pct == null ? 'text-white/60' : pct >= 0 ? 'text-green-400/80' : 'text-red-400/80'
    const arrow = pct == null ? '' : pct >= 0 ? '▲' : '▼'
    const series = hasData && Array.isArray(item?.series)
        ? (item.series as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n))
        : []
    const totalSlots = hasData && typeof item?.totalSlots === 'number' && item.totalSlots > 0 ? item.totalSlots : undefined
    const observed = item?.observedAt && Number.isFinite(item.observedAt)
        ? new Date(item.observedAt * 1000).toLocaleString(i18n.language === 'en' ? 'en' : 'zh')
        : null
    const detail = [name, item?.source, observed ? t('observedAt', { time: observed }) : null].filter(Boolean).join(' · ')

    return (
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] sm:text-[11px]" title={detail || undefined} aria-busy={pending}>
            {/* Symbol and name */}
            <div className="w-[62px] sm:w-[72px] shrink-0">
                <div className="flex items-center gap-1">
                    <MarketLogo symbol={sym} />
                    <span className="truncate font-medium text-white/90">{sym}</span>
                    {arrow ? <span className={`text-[9px] sm:text-[10px] ${pctColor}`}>{arrow}</span> : null}
                </div>
                <div className={`truncate text-[8px] sm:text-[9px] ${name ? 'text-white/45' : 'text-white/20'}`}>
                    {hasData && (item?.stale || item?.error) ? (
                        <span className="text-amber-200/75" title={item.error}>{t('cachedData')}</span>
                    ) : name || '—'}
                </div>
            </div>

            {/* Sparkline */}
            <div className="min-w-0 flex-1">
                {hasData ? (
                    <MiniSparkline series={series} totalSlots={totalSlots} />
                ) : pending ? (
                    <div className="h-4 rounded bg-white/5 animate-pulse" />
                ) : null}
            </div>

            {/* Price and change */}
            <div className="max-w-[48%] shrink-0 text-right">
                <div className={`truncate tabular-nums ${hasData ? 'text-white/90' : 'text-white/50'}`} title={item?.error || price || undefined}>
                    {price ?? t(pending ? 'loading' : 'unavailable')}
                </div>
                <div className={`tabular-nums text-[9px] sm:text-[10px] ${pctColor}`}>{pctLabel}</div>
            </div>
        </div>
    )
}

export function MarketsWidget({ data, error, symbols }: MarketsWidgetProps) {
    const { t } = useTranslation('widgets')
    const configuredSymbols = (symbols || []).filter(Boolean).slice(0, 4).map((s) => s.toUpperCase())

    // Build a lookup from loaded data
    const dataBySymbol: Record<string, MarketQuote> = {}
    if (data?.items) {
        for (const it of data.items) {
            dataBySymbol[String(it.symbol || '').toUpperCase()] = it
        }
    }

    // If no data at all and no symbols configured, show spinner or error
    if (!data && configuredSymbols.length === 0) {
        const msg = String(error || '').trim()
        if (msg) return <div className="flex h-full items-center justify-center text-xs text-white/60">{t('unavailable')}</div>
        return <div className="flex h-full items-center justify-center"><Spinner size="sm" className="border-white/40" /></div>
    }

    // Use configured symbols as the source of truth (always show them)
    // Fall back to data items if no symbols configured
    const displaySymbols = configuredSymbols.length > 0
        ? configuredSymbols
        : (data?.items || []).slice(0, 4).map((it) => String(it.symbol || '').toUpperCase())

    if (displaySymbols.length === 0) {
        return <div className="flex h-full items-center justify-center text-sm text-white/60">—</div>
    }

    return (
        <div className="flex flex-col gap-1.5 sm:gap-2">
            {displaySymbols.map((sym) => (
                <MarketRow key={sym} sym={sym} item={dataBySymbol[sym]} loading={!data && !error} error={error} />
            ))}
        </div>
    )
}

export default MarketsWidget

export interface MarketsConfig {
    symbols: string[]
}

const MARKETS_DEFAULT_CONFIG: MarketsConfig = { symbols: [] }

function MarketsView({ data, error, cfg }: {
    data: MarketsResponse | null
    error: string | null
    cfg: MarketsConfig
    refresh: () => void
    isAdmin: boolean
}) {
    return <MarketsWidget data={data} error={error} symbols={cfg.symbols} />
}

export const marketsWidget = defineWidget<MarketsConfig, MarketsResponse>({
    kind: 'markets',
    labelKey: 'widgets:markets',
    defaultConfig: MARKETS_DEFAULT_CONFIG,
    pollIntervalMs: 5 * 60 * 1000,
    fetchData: async (cfg, signal, options) => {
        const raw = Array.isArray(cfg.symbols) ? cfg.symbols : []
        const symbols = raw.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 4)
        if (symbols.length === 0) {
            return { fetchedAt: 0, items: [] }
        }
        const qs = new URLSearchParams({ symbols: symbols.join(',') })
        if (options?.force) qs.set('refresh', '1')
        const response = await apiGet<MarketsResponse>(`/api/widgets/markets?${qs.toString()}`, { signal })
        const sources = [...new Set((response.items || []).map((item) => item.source).filter(Boolean))]
        return { ...response, source: response.source || sources.join(' / ') }
    },
    Component: MarketsView,
})
