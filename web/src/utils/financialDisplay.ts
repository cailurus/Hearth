import type { MarketQuote } from '../types'

export function marketPrice(item: MarketQuote | undefined, symbol: string): { price: number; currency: string } | null {
    if (!item) return null
    const value = item.price ?? (!item.currency || item.currency === 'USD' ? item.priceUsd : undefined)
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
    const currency = typeof item.currency === 'string' && /^[A-Z]{3}$/.test(item.currency)
        ? item.currency : symbol.toUpperCase().endsWith('.HK') ? 'HKD' : 'USD'
    return { price: value, currency }
}

export function financialRowState(
    hasValue: boolean,
    row: { pending?: boolean; error?: string } | undefined,
    loading = false,
    error?: string | null,
): 'ready' | 'pending' | 'unavailable' {
    if (hasValue) return 'ready'
    if (error || row?.error) return 'unavailable'
    return loading || row?.pending ? 'pending' : 'unavailable'
}

export function formatMarketPrice(item: MarketQuote | undefined, symbol: string, lang: string): string | null {
    const value = marketPrice(item, symbol)
    if (!value) return null
    return new Intl.NumberFormat(lang === 'en' ? 'en' : 'zh', {
        style: 'currency', currency: value.currency, currencyDisplay: 'code',
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(value.price)
}
