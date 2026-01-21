import type { HolidaysResponse } from '../../types'

interface HolidaysWidgetProps {
    data: HolidaysResponse | null
    error?: string | null
    lang: 'zh' | 'en'
}

/**
 * 假日组件 - 显示即将到来的假日
 */
export function HolidaysWidget({ data, error, lang }: HolidaysWidgetProps) {
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
        <div className="flex h-full flex-col gap-1 py-1">
            {items.map((it, idx) => {
                const days = typeof it.daysUntil === 'number' && Number.isFinite(it.daysUntil) ? it.daysUntil : null
                const label = (lang === 'zh' ? String(it.localName || '').trim() : '') || String(it.name || '').trim() || '—'
                const country = String(it.country || '').trim().toUpperCase()
                const date = String(it.date || '').trim()
                const daysLabel =
                    days == null
                        ? '—'
                        : days <= 0
                            ? lang === 'en'
                                ? 'Today'
                                : '今天'
                            : lang === 'en'
                                ? `In ${days} days`
                                : `还有 ${days} 天`

                return (
                    <div key={`${country}-${date}-${idx}`} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="truncate text-[15px] font-semibold leading-tight text-white/95">
                                {label}
                                {country ? <span className="font-normal text-white/60"> · {country}</span> : null}
                            </div>
                        </div>
                        <div className="shrink-0 text-right tabular-nums">
                            <div className="text-[11px] leading-tight text-white/70">{daysLabel}</div>
                            <div className="text-[11px] leading-tight text-white/55">{date || '—'}</div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export default HolidaysWidget
