import { FaApple, FaMicrosoft, FaBitcoin, FaEthereum } from 'react-icons/fa'
import type { MarketsResponse, MarketQuote } from '../../types'

interface MarketsWidgetProps {
    data: MarketsResponse | null
    error?: string | null
    lang: 'zh' | 'en'
}

/**
 * 行情组件
 */
export function MarketsWidget({ data, error, lang }: MarketsWidgetProps) {
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    if (error) {
        return (
            <div className="flex items-center justify-center h-full text-red-400 text-sm">
                {error}
            </div>
        )
    }

    if (!data || !data.items || data.items.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                {t('加载中...', 'Loading...')}
            </div>
        )
    }

    return (
        <div className="grid grid-cols-2 gap-2 p-4 h-full">
            {data.items.slice(0, 4).map((quote, i) => (
                <MarketCard key={i} quote={quote} />
            ))}
        </div>
    )
}

function MarketCard({ quote }: { quote: MarketQuote }) {
    const isPositive = quote.changePct24h >= 0
    const changeColor = isPositive ? 'text-green-500' : 'text-red-500'
    const changePrefix = isPositive ? '+' : ''

    return (
        <div className="flex flex-col bg-white/50 dark:bg-gray-800/50 rounded-lg p-2">
            <div className="flex items-center gap-1.5 mb-1">
                <MarketIcon symbol={quote.symbol} />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                    {quote.symbol}
                </span>
            </div>

            <div className="text-sm font-mono text-gray-900 dark:text-white">
                ${formatPrice(quote.priceUsd)}
            </div>

            <div className={`text-xs font-mono ${changeColor}`}>
                {changePrefix}
                {quote.changePct24h.toFixed(2)}%
            </div>

            {quote.series && quote.series.length > 1 && (
                <MiniChart series={quote.series} positive={isPositive} />
            )}
        </div>
    )
}

function MarketIcon({ symbol }: { symbol: string }) {
    const normalized = symbol.toUpperCase()
    const iconClass = 'w-4 h-4'

    switch (normalized) {
        case 'AAPL':
            return <FaApple className={iconClass} />
        case 'MSFT':
            return <FaMicrosoft className={iconClass} />
        case 'BTC':
            return <FaBitcoin className={`${iconClass} text-orange-500`} />
        case 'ETH':
            return <FaEthereum className={`${iconClass} text-indigo-500`} />
        default:
            return (
                <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-gray-200 dark:bg-gray-700 rounded">
                    {normalized.charAt(0)}
                </span>
            )
    }
}

function MiniChart({ series, positive }: { series: number[]; positive: boolean }) {
    if (series.length < 2) return null

    const min = Math.min(...series)
    const max = Math.max(...series)
    const range = max - min || 1

    const height = 20
    const width = 60
    const points = series
        .map((v, i) => {
            const x = (i / (series.length - 1)) * width
            const y = height - ((v - min) / range) * height
            return `${x},${y}`
        })
        .join(' ')

    const color = positive ? '#22c55e' : '#ef4444'

    return (
        <svg className="mt-1" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            <polyline
                points={points}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

function formatPrice(price: number): string {
    if (price >= 1000) {
        return price.toLocaleString('en-US', { maximumFractionDigits: 0 })
    }
    if (price >= 1) {
        return price.toFixed(2)
    }
    return price.toFixed(4)
}

export default MarketsWidget
