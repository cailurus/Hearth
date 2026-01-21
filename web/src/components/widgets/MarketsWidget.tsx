import { useEffect, useMemo, useState } from 'react'
import { FaApple, FaMicrosoft, FaBitcoin, FaEthereum } from 'react-icons/fa'
import type { MarketsResponse } from '../../types'

interface MarketsWidgetProps {
    data: MarketsResponse | null
    error?: string | null
    lang: 'zh' | 'en'
}

/**
 * 行情组件 - 显示股票/加密货币行情
 */
export function MarketsWidget({ data, error, lang }: MarketsWidgetProps) {
    if (!data) {
        const msg = String(error || '').trim()
        if (msg) return <div className="flex h-full items-center justify-center text-sm text-white/60">{msg}</div>
        return <div className="flex h-full items-center justify-center text-sm text-white/60">{lang === 'en' ? 'Loading…' : '加载中…'}</div>
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

function normalizeMarketSymbol(symbol: string): 'AAPL' | 'MSFT' | 'BTC' | 'ETH' | '' {
    const raw = String(symbol || '').trim().toUpperCase()
    if (!raw) return ''
    const compact = raw.replace(/[^A-Z0-9]/g, '')
    if (compact.startsWith('AAPL')) return 'AAPL'
    if (compact.startsWith('MSFT')) return 'MSFT'
    if (compact.startsWith('BTC')) return 'BTC'
    if (compact.startsWith('ETH')) return 'ETH'
    return ''
}

function iconForMarketSymbol(symbol: string) {
    switch (normalizeMarketSymbol(symbol)) {
        case 'AAPL':
            return FaApple
        case 'MSFT':
            return FaMicrosoft
        case 'BTC':
            return FaBitcoin
        case 'ETH':
            return FaEthereum
        default:
            return null
    }
}

function MarketLogo({ symbol }: { symbol: string }) {
    const norm = useMemo(() => normalizeMarketSymbol(symbol), [symbol])
    const Icon = useMemo(() => iconForMarketSymbol(symbol), [symbol])
    const localUrl = useMemo(() => (norm ? `/market-icons/${norm}.png` : ''), [norm])
    const cachedUrl = useMemo(() => {
        if (!symbol) return ''
        const qs = new URLSearchParams({ symbol: String(symbol) })
        return `/api/widgets/markets/icon?${qs.toString()}`
    }, [symbol])

    const [maskUrl, setMaskUrl] = useState<string>('')
    useEffect(() => {
        let cancelled = false

        const tryLoad = (url: string) =>
            new Promise<boolean>((resolve) => {
                if (!url) return resolve(false)
                const img = new Image()
                img.onload = () => resolve(true)
                img.onerror = () => resolve(false)
                img.src = url
            })

            ; (async () => {
                if (localUrl && (await tryLoad(localUrl))) {
                    if (!cancelled) setMaskUrl(localUrl)
                    return
                }
                if (cachedUrl && (await tryLoad(cachedUrl))) {
                    if (!cancelled) setMaskUrl(cachedUrl)
                    return
                }
                if (!cancelled) setMaskUrl('')
            })()

        return () => {
            cancelled = true
        }
    }, [localUrl, cachedUrl])

    if (maskUrl) {
        return (
            <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 self-center text-white/70"
                style={{
                    display: 'inline-block',
                    backgroundColor: 'currentColor',
                    WebkitMaskImage: `url(${maskUrl})`,
                    WebkitMaskRepeat: 'no-repeat',
                    WebkitMaskSize: 'contain',
                    WebkitMaskPosition: 'center',
                    maskImage: `url(${maskUrl})`,
                    maskRepeat: 'no-repeat',
                    maskSize: 'contain',
                    maskPosition: 'center',
                }}
            />
        )
    }

    if (!Icon) return null
    return <Icon aria-hidden="true" className="h-3 w-3 shrink-0 self-center text-white/70" />
}

function prettifyCompanyName(name: string) {
    const s = String(name || '').trim()
    if (!s) return ''
    const hasLetters = /[A-Za-z]/.test(s)
    const isAllCaps = hasLetters && s === s.toUpperCase() && s !== s.toLowerCase()
    if (!isAllCaps) return s
    return s
        .toLowerCase()
        .split(/\s+/g)
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(' ')
}

function MiniSparkline({ series }: { series: number[] }) {
    const pts = Array.isArray(series) ? series.filter((n) => Number.isFinite(n)) : []
    if (pts.length < 2) {
        return <div className="h-6 w-full rounded bg-white/5" />
    }

    const width = 120
    const height = 24
    const min = Math.min(...pts)
    const max = Math.max(...pts)
    const span = max - min
    const yOf = (v: number) => {
        if (!Number.isFinite(v)) return height / 2
        if (span <= 0) return height / 2
        const t = (v - min) / span
        return (1 - t) * (height - 6) + 2
    }

    const step = width / (pts.length - 1)
    const d = pts.map((v, i) => `${(i * step).toFixed(2)},${yOf(v).toFixed(2)}`).join(' ')

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-6 w-full" aria-hidden="true">
            <g className="text-white/20">
                <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="currentColor" strokeWidth="1" />
                <line x1="0" y1={height - 4} x2="0" y2={height - 1} stroke="currentColor" strokeWidth="1" />
                <line x1={width / 2} y1={height - 4} x2={width / 2} y2={height - 1} stroke="currentColor" strokeWidth="1" />
                <line x1={width} y1={height - 4} x2={width} y2={height - 1} stroke="currentColor" strokeWidth="1" />
            </g>
            <g className="text-white/65">
                <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            </g>
        </svg>
    )
}

export default MarketsWidget
