import { useTranslation } from 'react-i18next'
import type { HolidaysResponse } from '../../types'
import { Spinner } from '../ui/Spinner'

interface HolidaysWidgetProps {
    data: HolidaysResponse | null
    error?: string | null
}

/**
 * 假日组件 - 显示即将到来的假日
 */
export function HolidaysWidget({ data, error }: HolidaysWidgetProps) {
    const { t, i18n } = useTranslation('widgets')
    const lang = i18n.language === 'en' ? 'en' : 'zh'

    if (!data) {
        const msg = String(error || '').trim()
        if (msg) return <div className="flex h-full items-center justify-center text-sm text-white/60">{msg}</div>
        return <div className="flex h-full items-center justify-center"><Spinner size="sm" className="border-white/40" /></div>
    }

    const items = Array.isArray(data.items) ? data.items.slice(0, 5) : []
    if (items.length === 0) {
        return <div className="flex h-full items-center justify-center text-sm text-white/60">—</div>
    }

    return (
        <div className="flex h-full flex-col gap-0.5 py-0.5">
            {items.map((it, idx) => {
                const days = typeof it.daysUntil === 'number' && Number.isFinite(it.daysUntil) ? it.daysUntil : null
                const label = (lang === 'zh' ? String(it.localName || '').trim() : '') || String(it.name || '').trim() || '—'
                const country = String(it.country || '').trim().toUpperCase()
                const date = String(it.date || '').trim()
                const daysLabel =
                    days == null
                        ? '—'
                        : days <= 0
                            ? t('today')
                            : t('inDays', { days })

                return (
                    <div key={`${country}-${date}-${idx}`} className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[11px] sm:text-[12px] font-medium leading-tight text-white/90">
                                {label}
                                {country ? <span className="font-normal text-white/50"> · {country}</span> : null}
                            </div>
                        </div>
                        <div className="shrink-0 text-right tabular-nums">
                            <div className="text-[10px] sm:text-[11px] leading-tight text-white/70">{daysLabel}</div>
                            <div className="text-[9px] sm:text-[10px] leading-tight text-white/50">{date || '—'}</div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export default HolidaysWidget

import { defineWidget } from '../../widgets/types'
import { apiGet } from '../../api'
import { normalizeCountryCodes } from '../../utils'

export interface HolidaysConfig {
    countries: string[]
}

const HOLIDAYS_DEFAULT_CONFIG: HolidaysConfig = { countries: [] }

function HolidaysView({ data, error }: {
    data: HolidaysResponse | null
    error: string | null
    cfg: HolidaysConfig
    refresh: () => void
    isAdmin: boolean
}) {
    return <HolidaysWidget data={data} error={error} />
}

export const holidaysWidget = defineWidget<HolidaysConfig, HolidaysResponse>({
    kind: 'holidays',
    labelKey: 'widgets:upcomingHolidays',
    defaultConfig: HOLIDAYS_DEFAULT_CONFIG,
    pollIntervalMs: 5 * 60 * 1000,
    fetchData: async (cfg, signal) => {
        const raw = Array.isArray(cfg.countries) ? cfg.countries : []
        const countries = normalizeCountryCodes(raw.map((x) => String(x ?? '')))
        if (countries.length === 0) {
            return null as unknown as HolidaysResponse
        }
        const qs = new URLSearchParams({ countries: countries.join(',') })
        return apiGet<HolidaysResponse>(`/api/widgets/holidays?${qs.toString()}`, { signal })
    },
    Component: HolidaysView,
})
