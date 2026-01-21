import { useEffect, useState } from 'react'
import { apiGet } from '../../api'
import type { HolidayCountry } from '../../types'

/**
 * Normalize country codes - dedupe and uppercase
 */
function normalizeCountryCodes(codes: string[]): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    for (const raw of codes) {
        const c = String(raw || '').trim().toUpperCase()
        if (c.length !== 2) continue
        if (c < 'AA' || c > 'ZZ') continue
        if (seen.has(c)) continue
        seen.add(c)
        out.push(c)
    }
    return out
}

export interface HolidayCountryTagsProps {
    lang: 'zh' | 'en'
    selected: string[]
    query: string
    onQueryChange: (v: string) => void
    onChange: (next: string[]) => void
}

/**
 * Holiday country tags picker with search and tag management
 */
export function HolidayCountryTags({
    lang,
    selected,
    query,
    onQueryChange,
    onChange,
}: HolidayCountryTagsProps) {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [results, setResults] = useState<HolidayCountry[]>([])

    const normSelected = normalizeCountryCodes(selected)

    useEffect(() => {
        if (!open) return
        let cancelled = false
        const q = String(query ?? '').trim()

        const timer = window.setTimeout(() => {
            void (async () => {
                setLoading(true)
                try {
                    const res = await apiGet<{ results: HolidayCountry[] }>(
                        `/api/widgets/holidays/countries?${new URLSearchParams({ query: q, limit: '30' }).toString()}`,
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

    const remove = (code: string) => {
        const up = String(code || '').trim().toUpperCase()
        onChange(normSelected.filter((c) => c !== up))
    }

    const add = (code: string) => {
        const up = String(code || '').trim().toUpperCase()
        const next = normalizeCountryCodes([...normSelected, up])
        if (next.length === normSelected.length) return
        onChange(next)
        onQueryChange('')
        setOpen(false)
    }

    return (
        <div className="space-y-2">
            <div className="text-sm text-white/70">{lang === 'en' ? 'Countries/regions' : '国家/地区'}</div>

            <div className="flex flex-wrap gap-2">
                {normSelected.map((c) => (
                    <button
                        key={c}
                        type="button"
                        onClick={() => remove(c)}
                        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
                        title={lang === 'en' ? 'Remove' : '移除'}
                    >
                        {c} x
                    </button>
                ))}
            </div>

            <div className="relative">
                <input
                    value={query}
                    onChange={(e) => {
                        onQueryChange(e.target.value)
                        setOpen(true)
                    }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => {
                        window.setTimeout(() => setOpen(false), 120)
                    }}
                    placeholder={lang === 'en' ? 'Search countries (e.g. CN, United States)...' : '搜索国家/地区（例如 CN / United States）...'}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                />

                {open ? (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-white/10 bg-black/90">
                        <div className="max-h-56 overflow-auto">
                            {loading ? (
                                <div className="px-3 py-2 text-sm text-white/60">{lang === 'en' ? 'Loading...' : '加载中...'}</div>
                            ) : results.length ? (
                                results.map((r) => {
                                    const code = String(r.code || '').trim().toUpperCase()
                                    const name = String(r.name || '').trim()
                                    const disabled = normSelected.includes(code)
                                    return (
                                        <button
                                            key={`${code}-${name}`}
                                            type="button"
                                            disabled={disabled}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => {
                                                if (!code) return
                                                add(code)
                                            }}
                                            className={
                                                'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ' +
                                                (disabled ? 'text-white/40' : 'text-white/85 hover:bg-white/10')
                                            }
                                        >
                                            <div className="min-w-0">
                                                <div className="truncate font-semibold text-white/90">{code}</div>
                                                <div className="truncate text-xs text-white/60">{name || '—'}</div>
                                            </div>
                                            <div className="shrink-0 text-xs text-white/50">{disabled ? (lang === 'en' ? 'Added' : '已添加') : ''}</div>
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

            <div className="text-xs text-white/50">{lang === 'en' ? 'Click a tag to remove.' : '点击标签可移除。'}</div>
        </div>
    )
}

export default HolidayCountryTags
