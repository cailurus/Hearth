import { useMemo } from 'react'
import { useNow } from '../hooks/useNow'
import { normalizeIanaTimeZone } from '../utils/helpers'

interface TimeDisplayProps {
    enabled: boolean
    showSeconds: boolean
    lang: 'zh' | 'en'
}

/**
 * 时间显示组件
 */
export function TimeDisplay({ enabled, showSeconds, lang }: TimeDisplayProps) {
    const now = useNow(1000)

    const systemTimezone = useMemo(() => {
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
            return normalizeIanaTimeZone(tz, 'Asia/Shanghai')
        } catch {
            return 'Asia/Shanghai'
        }
    }, [])

    const { time, date, weekday } = useMemo(() => {
        const d = new Date(now)
        const locale = lang === 'en' ? 'en-US' : 'zh-CN'

        const timeStr = d.toLocaleTimeString(locale, {
            timeZone: systemTimezone,
            hour: '2-digit',
            minute: '2-digit',
            second: showSeconds ? '2-digit' : undefined,
            hour12: false,
        })

        const dateStr = d.toLocaleDateString(locale, {
            timeZone: systemTimezone,
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        })

        const weekdayStr = d.toLocaleDateString(locale, {
            timeZone: systemTimezone,
            weekday: 'long',
        })

        return { time: timeStr, date: dateStr, weekday: weekdayStr }
    }, [now, lang, showSeconds, systemTimezone])

    if (!enabled) return null

    return (
        <div className="flex flex-col items-center select-none">
            <div className="text-6xl sm:text-7xl md:text-8xl font-extralight tracking-tight text-white drop-shadow-lg tabular-nums">
                {time}
            </div>
            <div className="mt-2 text-lg sm:text-xl text-white/80 drop-shadow">
                {date} · {weekday}
            </div>
        </div>
    )
}

export default TimeDisplay
