import { useMemo } from 'react'
import { useNow } from '../../hooks/useNow'
import { cityShort, normalizeIanaTimeZone } from '../../utils/helpers'

interface Clock {
    city: string
    timezone: string
}

interface TimezonesWidgetProps {
    clocks: Clock[]
    lang: 'zh' | 'en'
}

/**
 * 世界时钟组件
 */
export function TimezonesWidget({ clocks, lang }: TimezonesWidgetProps) {
    const now = useNow(1000)

    const displayClocks = useMemo(() => {
        return clocks.slice(0, 4).map((clock) => {
            const tz = normalizeIanaTimeZone(clock.timezone, 'UTC')
            return {
                city: cityShort(clock.city),
                timezone: tz,
                time: formatTime(now, tz),
                date: formatDate(now, tz, lang),
            }
        })
    }, [clocks, now, lang])

    return (
        <div className="grid grid-cols-2 gap-3 p-4 h-full">
            {displayClocks.map((clock, i) => (
                <div
                    key={i}
                    className="flex flex-col items-center justify-center bg-white/50 dark:bg-gray-800/50 rounded-lg p-2"
                >
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-full">
                        {clock.city}
                    </span>
                    <span className="text-xl font-mono text-gray-900 dark:text-white">
                        {clock.time}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                        {clock.date}
                    </span>
                </div>
            ))}
        </div>
    )
}

function formatTime(timestamp: number, timezone: string): string {
    try {
        return new Date(timestamp).toLocaleTimeString('en-US', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        })
    } catch {
        return '--:--'
    }
}

function formatDate(timestamp: number, timezone: string, lang: 'zh' | 'en'): string {
    try {
        return new Date(timestamp).toLocaleDateString(lang === 'en' ? 'en-US' : 'zh-CN', {
            timeZone: timezone,
            month: 'short',
            day: 'numeric',
        })
    } catch {
        return ''
    }
}

export default TimezonesWidget
