/**
 * 时间显示组件
 */

import { useMemo } from 'react'
import { normalizeIanaTimeZone, ymdKey, formatTime } from '../../utils'
import { getNearestSolarTerm } from '../../utils/solarTerms'

interface TimeDisplayProps {
    now: number
    timezone: string
    showSeconds: boolean
    mode: string
    lang?: 'zh' | 'en'
    showSolarTerm?: boolean
}

function getWeekday(date: Date, timezone: string, lang: 'zh' | 'en'): string {
    try {
        return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
            timeZone: timezone,
            weekday: 'short',
        }).format(date)
    } catch {
        return ''
    }
}

function formatSolarTerm(term: { name: string; daysFromNow: number }, lang: 'zh' | 'en'): string {
    if (term.daysFromNow === 0) return term.name
    if (term.daysFromNow > 0) {
        return lang === 'zh' ? `${term.name}(${term.daysFromNow}天后)` : `${term.name} in ${term.daysFromNow}d`
    }
    return lang === 'zh' ? `${term.name}(${Math.abs(term.daysFromNow)}天前)` : `${term.name} ${Math.abs(term.daysFromNow)}d ago`
}

export function TimeDisplay({ now, timezone, showSeconds, mode, lang = 'zh', showSolarTerm = false }: TimeDisplayProps) {
    const safeTz = normalizeIanaTimeZone(timezone, 'Asia/Shanghai')
    const d = new Date(now)
    const dateStr = ymdKey(d, safeTz)
    const weekday = getWeekday(d, safeTz, lang)

    const solarTerm = useMemo(() => {
        if (!showSolarTerm) return null
        return getNearestSolarTerm(d, lang)
        // Re-compute only when date changes (not every second)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showSolarTerm, dateStr, lang])

    const solarTermStr = solarTerm ? formatSolarTerm(solarTerm, lang) : null

    // Extra info line: weekday + optional solar term
    const extraInfo = [weekday, solarTermStr].filter(Boolean).join(' · ')

    if (mode === 'clock') {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: safeTz,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(d)
        const hh = Number(parts.find((p) => p.type === 'hour')?.value || '0')
        const mm = Number(parts.find((p) => p.type === 'minute')?.value || '0')
        const ss = Number(parts.find((p) => p.type === 'second')?.value || '0')

        const hourAngle = ((hh % 12) + mm / 60) * 30
        const minuteAngle = (mm + ss / 60) * 6
        const secondAngle = ss * 6

        return (
            <div className="flex items-center gap-3 rounded-full bg-white/5 px-3 py-1.5 text-white/85 shadow-sm shadow-black/20">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.9" />
                    <g transform={`rotate(${hourAngle} 12 12)`}>
                        <path d="M12 12V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </g>
                    <g transform={`rotate(${minuteAngle} 12 12)`}>
                        <path d="M12 12V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
                    </g>
                    {showSeconds ? (
                        <g transform={`rotate(${secondAngle} 12 12)`}>
                            <path d="M12 12V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.75" />
                        </g>
                    ) : null}
                    <circle cx="12" cy="12" r="1" fill="currentColor" />
                </svg>
                <div className="text-base font-medium tabular-nums">
                    <span className="inline-block w-[10ch]">{dateStr}</span>
                    <span className={`ml-1.5 inline-block ${showSeconds ? 'w-[8ch]' : 'w-[5ch]'}`}>
                        {formatTime(now, safeTz, showSeconds)}
                    </span>
                </div>
                {extraInfo && <span className="hidden text-sm font-normal text-white/60 sm:inline">{extraInfo}</span>}
            </div>
        )
    }

    return (
        <div className="rounded-full bg-white/5 px-3 py-1.5 text-base font-medium text-white/85 shadow-sm shadow-black/20 tabular-nums">
            <span className="inline-block w-[10ch]">{dateStr}</span>
            <span className={`ml-1.5 inline-block ${showSeconds ? 'w-[8ch]' : 'w-[5ch]'}`}>
                {formatTime(now, safeTz, showSeconds)}
            </span>
            {extraInfo && <span className="ml-2 hidden text-sm font-normal text-white/60 sm:inline">{extraInfo}</span>}
        </div>
    )
}
