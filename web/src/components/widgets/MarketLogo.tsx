/**
 * 市场图标组件
 */

import { useState, useEffect, useMemo } from 'react'
import { normalizeMarketSymbol, iconForMarketSymbol } from '../../utils/markets'

interface MarketLogoProps {
    symbol: string
}

export function MarketLogo({ symbol }: MarketLogoProps) {
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

        ;(async () => {
            // Keep previous maskUrl while loading to avoid flicker.
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
