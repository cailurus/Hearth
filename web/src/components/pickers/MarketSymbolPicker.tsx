import { useEffect, useState } from 'react'
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
    lang: 'zh' | 'en'
}

/**
 * Market symbol picker with search functionality
 */
export function MarketSymbolPicker({
    value,
    query,
    onQueryChange,
    onSelect,
    placeholder,
    lang,
}: MarketSymbolPickerProps) {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [results, setResults] = useState<MarketSymbolResult[]>([])

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

    return (
        <div className="relative">
            <input
                value={query}
                onChange={(e) => {
                    onQueryChange(e.target.value)
                    setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => {
                    window.setTimeout(() => {
                        setOpen(false)
                        onQueryChange(String(value || '').trim() || '')
                    }, 120)
                }}
                placeholder={placeholder}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
            />

            {open ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-white/10 bg-black/90">
                    <div className="max-h-56 overflow-auto">
                        {loading ? (
                            <div className="px-3 py-2 text-sm text-white/60">{lang === 'en' ? 'Loading...' : '加载中...'}</div>
                        ) : results.length ? (
                            results.map((r) => {
                                const sym = String(r.symbol || '').trim().toUpperCase()
                                const name = String(r.name || '').trim()
                                const kind = String(r.kind || '').trim()
                                return (
                                    <button
                                        key={`${sym}-${kind}-${name}`}
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => {
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
                        ) : (
                            <div className="px-3 py-2 text-sm text-white/60">{lang === 'en' ? 'No results' : '无结果'}</div>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    )
}

export default MarketSymbolPicker
