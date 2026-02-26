import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { apiGet } from '../../api'

export type MarketSymbolResult = {
    symbol: string
    kind?: string
    name?: string
}

export interface MarketSymbolPickerProps {
    value: string
    query: string
    onQueryChange: (v: string) => void
    onSelect: (symbol: string) => void
    placeholder?: string
}

/**
 * Market symbol picker with search functionality.
 * Dropdown and backdrop render via portal to avoid interfering with parent scroll containers.
 */
export function MarketSymbolPicker({
    value,
    query,
    onQueryChange,
    onSelect,
    placeholder,
}: MarketSymbolPickerProps) {
    const { t } = useTranslation('widgets')
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [results, setResults] = useState<MarketSymbolResult[]>([])
    const inputRef = useRef<HTMLInputElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null)

    const recalcPosition = useCallback(() => {
        if (!inputRef.current) return
        const rect = inputRef.current.getBoundingClientRect()
        const spaceBelow = window.innerHeight - rect.bottom
        const spaceAbove = rect.top
        const dropdownHeight = 224
        const openUp = spaceBelow < dropdownHeight && spaceAbove > spaceBelow
        const top = openUp ? rect.top : rect.bottom + 4
        const left = rect.left
        const width = rect.width
        setDropdownPos((prev) => {
            if (prev && prev.top === top && prev.left === left && prev.width === width && prev.openUp === openUp) {
                return prev
            }
            return { top, left, width, openUp }
        })
    }, [])

    // Calculate position once when opening
    useLayoutEffect(() => {
        if (!open || !inputRef.current) {
            setDropdownPos(null)
            return
        }
        recalcPosition()
    }, [open, recalcPosition])

    // Only reposition on window resize (not scroll — the input is inside a
    // fixed-position modal and a full-screen backdrop prevents page interaction,
    // so the input position cannot change from scroll).
    useEffect(() => {
        if (!open) return
        const handler = () => recalcPosition()
        window.addEventListener('resize', handler)
        return () => window.removeEventListener('resize', handler)
    }, [open, recalcPosition])

    // Prevent wheel-scroll from leaking past the dropdown boundaries.
    // This is more reliable than CSS overscroll-behavior across browsers.
    useEffect(() => {
        const el = scrollRef.current
        if (!el || !open) return
        const handler = (e: WheelEvent) => {
            const { scrollTop, scrollHeight, clientHeight } = el
            const atTop = scrollTop <= 0 && e.deltaY < 0
            const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0
            if (atTop || atBottom) {
                e.preventDefault()
            }
            // Always stop propagation so the wheel event never reaches other elements
            e.stopPropagation()
        }
        el.addEventListener('wheel', handler, { passive: false })
        return () => el.removeEventListener('wheel', handler)
    }, [open])

    useEffect(() => {
        if (!open) return
        let cancelled = false
        const q = String(query ?? '').trim()

        const timer = window.setTimeout(() => {
            void (async () => {
                setLoading(true)
                try {
                    const res = await apiGet<{ results: MarketSymbolResult[] }>(
                        `/api/widgets/markets/search?${new URLSearchParams({ query: q, limit: '8' }).toString()}`,
                    )
                    if (cancelled) return
                    const items = Array.isArray(res?.results) ? res.results : []
                    setResults(items)
                } catch {
                    if (cancelled) return
                    setResults([])
                } finally {
                    if (!cancelled) setLoading(false)
                }
            })()
        }, 180)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [open, query])

    const hasContent = loading || results.length > 0

    const overlay = open ? createPortal(
        <>
            <div
                className="fixed inset-0 z-[9998]"
                onMouseDown={() => {
                    setOpen(false)
                    onQueryChange(String(value || '').trim() || '')
                }}
                aria-hidden="true"
            />
            {hasContent && dropdownPos ? (
                <div
                    className="fixed z-[9999] overflow-hidden rounded-lg border border-white/10 bg-neutral-950 text-white"
                    style={{
                        top: dropdownPos.openUp ? 'auto' : dropdownPos.top,
                        bottom: dropdownPos.openUp ? `${window.innerHeight - dropdownPos.top + 4}px` : 'auto',
                        left: dropdownPos.left,
                        width: dropdownPos.width,
                        contain: 'content',
                    }}
                >
                    <div
                        ref={scrollRef}
                        className="max-h-56 overflow-auto overscroll-contain py-1"
                    >
                        {loading ? (
                            <div className="px-3 py-2 text-sm text-white/60">{t('marketsLoading', 'Loading...')}</div>
                        ) : (
                            results.map((r) => {
                                const sym = String(r.symbol || '').trim().toUpperCase()
                                const name = String(r.name || '').trim()
                                const kind = String(r.kind || '').trim()
                                return (
                                    <button
                                        key={`${sym}-${kind}-${name}`}
                                        type="button"
                                        onMouseDown={(e) => {
                                            e.preventDefault()
                                            if (!sym) return
                                            onSelect(sym)
                                            onQueryChange(sym)
                                            setOpen(false)
                                        }}
                                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10"
                                    >
                                        <div className="min-w-0">
                                            <div className="truncate font-semibold text-white/90">{sym}</div>
                                            <div className="truncate text-xs text-white/60">{name || '—'}</div>
                                        </div>
                                        <div className="shrink-0 text-xs text-white/50">{kind ? kind.toUpperCase() : ''}</div>
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>
            ) : null}
        </>,
        document.body,
    ) : null

    return (
        <div className="relative">
            <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                    onQueryChange(e.target.value)
                    setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false)
                }}
                placeholder={placeholder}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                autoComplete="off"
            />
            {overlay}
        </div>
    )
}

export default MarketSymbolPicker
