/**
 * 市场/股票相关工具函数
 */

import { FaApple, FaMicrosoft, FaBitcoin, FaEthereum } from 'react-icons/fa'
import type { IconType } from 'react-icons'

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

/**
 * 获取市场符号对应的图标组件
 */
export function iconForMarketSymbol(symbol: string): IconType | null {
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
