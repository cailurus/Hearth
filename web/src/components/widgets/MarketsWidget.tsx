import type { MarketsResponse } from '../../types'
import { prettifyCompanyName } from '../../utils'
import { MarketLogo } from './MarketLogo'
import { MiniSparkline } from './MiniSparkline'
import { Spinner } from '../ui/Spinner'

interface MarketsWidgetProps {
    data: MarketsResponse | null
    error?: string | null
}

/**
 * 行情组件 - 显示股票/加密货币行情
 */
export function MarketsWidget({ data, error }: MarketsWidgetProps) {
    if (!data) {
        const msg = String(error || '').trim()
        if (msg) return <div className="flex h-full items-center justify-center text-sm text-white/60">{msg}</div>
        return <div className="flex h-full items-center justify-center"><Spinner size="sm" className="border-white/40" /></div>
    }

    const items = Array.isArray(data.items) ? data.items.slice(0, 4) : []
    if (items.length === 0) {
        return <div className="flex h-full items-center justify-center text-sm text-white/60">—</div>
    }

    return (
        <div className="flex flex-col gap-1.5 sm:gap-2">
            {items.map((it) => {
                const sym = String(it.symbol || '').toUpperCase() || '—'
                const name = prettifyCompanyName(String(it.name || '').trim())
                const price = typeof it.priceUsd === 'number' && Number.isFinite(it.priceUsd) ? `$${it.priceUsd.toFixed(2)}` : '—'
                const pct = typeof it.changePct24h === 'number' && Number.isFinite(it.changePct24h) ? it.changePct24h : null
                const pctLabel = pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
                const pctColor = pct == null ? 'text-white/60' : pct >= 0 ? 'text-green-400/80' : 'text-red-400/80'
                const arrow = pct == null ? '' : pct >= 0 ? '▲' : '▼'
                const series = Array.isArray(it.series) ? (it.series as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n)) : []

                return (
                    <div key={sym} className="flex items-center gap-2 text-[10px] sm:text-[11px]">
                        {/* Symbol and name - fixed width */}
                        <div className="w-[72px] sm:w-20 shrink-0">
                            <div className="flex items-center gap-1">
                                <MarketLogo symbol={sym} />
                                <span className="truncate font-medium text-white/90">{sym}</span>
                                {arrow ? <span className={`text-[9px] sm:text-[10px] ${pctColor}`}>{arrow}</span> : null}
                            </div>
                            <div className="truncate text-[8px] sm:text-[9px] text-white/45">{name || '—'}</div>
                        </div>

                        {/* Sparkline - always visible, fills remaining space */}
                        <div className="min-w-[40px] flex-1">
                            <MiniSparkline series={series} />
                        </div>

                        {/* Price and change - fixed width */}
                        <div className="w-[60px] sm:w-[68px] shrink-0 text-right">
                            <div className="tabular-nums text-white/90">{price}</div>
                            <div className={`tabular-nums text-[9px] sm:text-[10px] ${pctColor}`}>{pctLabel}</div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export default MarketsWidget
