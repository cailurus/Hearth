import type { CurrencyResponse, CurrencyPair } from '../../types'
import { MiniSparkline } from './MiniSparkline'
import { Spinner } from '../ui/Spinner'

const CURRENCY_FLAGS: Record<string, string> = {
    USD: '\u{1F1FA}\u{1F1F8}', CNY: '\u{1F1E8}\u{1F1F3}', EUR: '\u{1F1EA}\u{1F1FA}',
    GBP: '\u{1F1EC}\u{1F1E7}', JPY: '\u{1F1EF}\u{1F1F5}', HKD: '\u{1F1ED}\u{1F1F0}',
    AUD: '\u{1F1E6}\u{1F1FA}', CAD: '\u{1F1E8}\u{1F1E6}', CHF: '\u{1F1E8}\u{1F1ED}',
    KRW: '\u{1F1F0}\u{1F1F7}', SGD: '\u{1F1F8}\u{1F1EC}', TWD: '\u{1F1F9}\u{1F1FC}',
    NZD: '\u{1F1F3}\u{1F1FF}', INR: '\u{1F1EE}\u{1F1F3}', BRL: '\u{1F1E7}\u{1F1F7}',
    RUB: '\u{1F1F7}\u{1F1FA}', MXN: '\u{1F1F2}\u{1F1FD}', ZAR: '\u{1F1FF}\u{1F1E6}',
    SEK: '\u{1F1F8}\u{1F1EA}', NOK: '\u{1F1F3}\u{1F1F4}', DKK: '\u{1F1E9}\u{1F1F0}',
    PLN: '\u{1F1F5}\u{1F1F1}', THB: '\u{1F1F9}\u{1F1ED}', IDR: '\u{1F1EE}\u{1F1E9}',
    MYR: '\u{1F1F2}\u{1F1FE}', PHP: '\u{1F1F5}\u{1F1ED}', TRY: '\u{1F1F9}\u{1F1F7}',
    CZK: '\u{1F1E8}\u{1F1FF}', HUF: '\u{1F1ED}\u{1F1FA}', ILS: '\u{1F1EE}\u{1F1F1}',
    ISK: '\u{1F1EE}\u{1F1F8}', BGN: '\u{1F1E7}\u{1F1EC}', RON: '\u{1F1F7}\u{1F1F4}',
}

function CurrencyRow({ pair }: { pair?: CurrencyPair }) {
    const hasData = pair && typeof pair.rate === 'number' && pair.rate > 0
    const from = pair?.from ?? '???'
    const to = pair?.to ?? '???'
    const rate = hasData
        ? (pair.rate > 100 ? pair.rate.toFixed(2) : pair.rate > 1 ? pair.rate.toFixed(4) : pair.rate.toFixed(6))
        : '—'
    const pct = hasData && typeof pair.change === 'number' && Number.isFinite(pair.change) ? pair.change : null
    const pctLabel = pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
    const pctColor = pct == null ? 'text-white/60' : pct >= 0 ? 'text-green-400/80' : 'text-red-400/80'
    const arrow = pct == null ? '' : pct >= 0 ? '▲' : '▼'
    const series = hasData && Array.isArray(pair.series)
        ? pair.series.filter((n) => Number.isFinite(n))
        : []
    const fromFlag = CURRENCY_FLAGS[from] ?? ''
    const toFlag = CURRENCY_FLAGS[to] ?? ''

    return (
        <div className="flex items-center gap-2 text-[10px] sm:text-[11px]">
            {/* Pair label */}
            <div className="w-[86px] sm:w-24 shrink-0">
                <div className="flex items-center gap-0.5 font-medium text-white/90">
                    {fromFlag && <span className="text-[10px]">{fromFlag}</span>}
                    <span>{from}</span>
                    <span className="text-white/30">/</span>
                    {toFlag && <span className="text-[10px]">{toFlag}</span>}
                    <span>{to}</span>
                    {arrow ? <span className={`ml-0.5 text-[9px] sm:text-[10px] ${pctColor}`}>{arrow}</span> : null}
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

            {/* Rate and change */}
            <div className="w-[60px] sm:w-[68px] shrink-0 text-right">
                <div className={`tabular-nums ${hasData ? 'text-white/90' : 'text-white/20'}`}>{rate}</div>
                <div className={`tabular-nums text-[9px] sm:text-[10px] ${pctColor}`}>{pctLabel}</div>
            </div>
        </div>
    )
}

interface CurrencyWidgetProps {
    data: CurrencyResponse | null
    error?: string | null
}

export function CurrencyWidget({ data, error }: CurrencyWidgetProps) {
    if (!data && !error) {
        return (
            <div className="flex h-full items-center justify-center">
                <Spinner size="sm" className="border-white/40" />
            </div>
        )
    }

    if (error && !data) {
        return (
            <div className="flex h-full items-center justify-center text-xs text-white/40">
                {error}
            </div>
        )
    }

    const items = data?.items ?? []

    if (items.length === 0) {
        return (
            <div className="flex h-full items-center justify-center text-xs text-white/40">—</div>
        )
    }

    return (
        <div className="flex flex-col gap-1.5 sm:gap-2">
            {items.map((pair, i) => (
                <CurrencyRow key={`${pair.from}-${pair.to}-${i}`} pair={pair} />
            ))}
        </div>
    )
}
