/**
 * 市场/股票相关工具函数
 */

/**
 * 支持的市场符号类型
 */
export type KnownMarketSymbol = 'AAPL' | 'MSFT' | 'BTC' | 'ETH' | ''

/**
 * 标准化市场符号
 */
export function normalizeMarketSymbol(symbol: string): KnownMarketSymbol {
    const raw = String(symbol || '').trim().toUpperCase()
    if (!raw) return ''
    const compact = raw.replace(/[^A-Z0-9]/g, '')
    if (compact.startsWith('AAPL')) return 'AAPL'
    if (compact.startsWith('MSFT')) return 'MSFT'
    if (compact.startsWith('BTC')) return 'BTC'
    if (compact.startsWith('ETH')) return 'ETH'
    return ''
}
