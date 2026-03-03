/**
 * 市场图标组件
 */

import { useState, useEffect, useMemo } from 'react'
import { normalizeMarketSymbol, iconForMarketSymbol } from '../../utils'

interface MarketLogoProps {
    symbol: string
}

export function MarketLogo({ symbol }: MarketLogoProps) {
    const norm = useMemo(() => normalizeMarketSymbol(symbol), [symbol])
    const Icon = useMemo(() => iconForMarketSymbol(symbol), [symbol])
    const cachedUrl = useMemo(() => {
        if (!symbol) return ''
        const qs = new URLSearchParams({ symbol: String(symbol) })
        return `/api/widgets/markets/icon?${qs.toString()}`
    }, [symbol])

    const [imgUrl, setImgUrl] = useState<string>('')

    useEffect(() => {
        let cancelled = false
        if (!cachedUrl) { setImgUrl(''); return }

        const img = new Image()
        img.onload = () => { if (!cancelled) setImgUrl(cachedUrl) }
        img.onerror = () => { if (!cancelled) setImgUrl('') }
        img.src = cachedUrl

        return () => { cancelled = true }
    }, [cachedUrl])

    if (imgUrl) {
        return (
            <img
                aria-hidden="true"
                src={imgUrl}
                alt=""
                className="h-3.5 w-3.5 shrink-0 self-center rounded-sm object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
        )
    }

    if (Icon) {
        return <Icon aria-hidden="true" className="h-3 w-3 shrink-0 self-center text-white/70" />
    }

    // Letter fallback
    const letter = (norm || symbol || '?').charAt(0).toUpperCase()
    return (
        <span
            aria-hidden="true"
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center self-center rounded-full bg-white/10 text-[7px] font-bold leading-none text-white/60"
        >
            {letter}
        </span>
    )
}
