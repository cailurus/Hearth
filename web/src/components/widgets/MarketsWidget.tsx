import type { MarketQuote, MarketsResponse } from '../../types'
import { prettifyCompanyName } from '../../utils'
import { MarketLogo } from './MarketLogo'
import { MiniSparkline } from './MiniSparkline'
import { Spinner } from '../ui/Spinner'

interface MarketsWidgetProps {
    data: MarketsResponse | null
    error?: string | null
    symbols?: string[] // configured symbols — shown immediately before data loads
}

/**
 * Render a single market row (shared between loaded and placeholder states).
 */
function MarketRow({ sym, item }: { sym: string; item?: MarketQuote }) {
    const hasData = item && typeof item.priceUsd === 'number' && item.priceUsd > 0
    const name = hasData ? prettifyCompanyName(String(item.name || '').trim()) : ''
    const price = hasData ? `$${item.priceUsd.toFixed(2)}` : '—'
    const pct = hasData && typeof item.changePct24h === 'number' && Number.isFinite(item.changePct24h) ? item.changePct24h : null
    const pctLabel = pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
    const pctColor = pct == null ? 'text-white/60' : pct >= 0 ? 'text-green-400/80' : 'text-red-400/80'
    const arrow = pct == null ? '' : pct >= 0 ? '▲' : '▼'
    const series = hasData && Array.isArray(item.series)
        ? (item.series as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n))
        : []

    return (
        <div className="flex items-center gap-2 text-[10px] sm:text-[11px]">
            {/* Symbol and name */}
            <div className="w-[72px] sm:w-20 shrink-0">
                <div className="flex items-center gap-1">
                    <MarketLogo symbol={sym} />
                    <span className="truncate font-medium text-white/90">{sym}</span>
                    {arrow ? <span className={`text-[9px] sm:text-[10px] ${pctColor}`}>{arrow}</span> : null}
                </div>
                <div className={`truncate text-[8px] sm:text-[9px] ${name ? 'text-white/45' : 'text-white/20'}`}>
                    {name || '—'}
                </div>
            </div>

            {/* Sparkline */}
            <div className="min-w-[40px] flex-1">
                {hasData ? (
                    <MiniSparkline series={series} />
                ) : (
                    <div className="h-4 rounded bg-white/5 animate-pulse" />
                )}
            </div>

            {/* Price and change */}
            <div className="w-[60px] sm:w-[68px] shrink-0 text-right">
                <div className={`tabular-nums ${hasData ? 'text-white/90' : 'text-white/20'}`}>{price}</div>
                <div className={`tabular-nums text-[9px] sm:text-[10px] ${pctColor}`}>{pctLabel}</div>
            </div>
        </div>
    )
}

export function MarketsWidget({ data, error, symbols }: MarketsWidgetProps) {
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
        if (msg) return <div className="flex h-full items-center justify-center text-sm text-white/60">{msg}</div>
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
                <MarketRow key={sym} sym={sym} item={dataBySymbol[sym]} />
            ))}
        </div>
    )
}

export default MarketsWidget
