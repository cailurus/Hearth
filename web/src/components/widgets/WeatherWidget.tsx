import { useTranslation } from 'react-i18next'
import type { Weather } from '../../types'
import { cityShort, weekdayLabel, weatherCodeLabel } from '../../utils'
import { WeatherGlyph } from './WeatherGlyph'
import { Spinner } from '../ui/Spinner'

interface WeatherWidgetProps {
    data: Weather | null
    error?: string | null
    cityName?: string // configured city — shown immediately before data loads
}

/**
 * 天气组件 - 显示当前天气和5日预报
 */
export function WeatherWidget({ data, error, cityName }: WeatherWidgetProps) {
    const { t, i18n } = useTranslation('widgets')
    const lang = i18n.language === 'en' ? 'en' : 'zh'

    if (!data) {
        const msg = String(error || '').trim()
        if (msg) return <div className="flex h-full items-center justify-center text-sm text-white/60">{msg}</div>

        // Show city name placeholder while loading
        if (cityName) {
            return (
                <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-5 gap-1.5 items-center">
                        <div className="flex items-center justify-center">
                            <div className="h-11 w-11 rounded-full bg-white/5 animate-pulse" />
                        </div>
                        <div className="col-span-4 min-w-0 flex flex-col justify-center">
                            <div className="truncate text-sm font-semibold text-white">{cityShort(cityName)}</div>
                            <div className="mt-1 h-5 w-24 rounded bg-white/5 animate-pulse" />
                        </div>
                    </div>
                    <div className="grid grid-cols-5 gap-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex flex-col items-center gap-0.5">
                                <div className="h-3 w-6 rounded bg-white/5 animate-pulse" />
                                <div className="h-8 w-8 rounded bg-white/5 animate-pulse" />
                                <div className="h-3 w-8 rounded bg-white/5 animate-pulse" />
                            </div>
                        ))}
                    </div>
                </div>
            )
        }

        return <div className="flex h-full items-center justify-center"><Spinner size="sm" className="border-white/40" /></div>
    }
    const cond = weatherCodeLabel(data.weatherCode, lang)

    const daily = (Array.isArray(data.daily) ? data.daily : []).slice(0, 5)

    return (
        <div className="flex flex-col gap-2">
            {/* Current weather - responsive layout */}
            <div className="grid grid-cols-5 gap-1.5 items-center">
                <div className="flex items-center justify-center">
                    <WeatherGlyph code={data.weatherCode} windKph={data.windSpeedKph} size={44} />
                </div>
                <div className="col-span-4 min-w-0 flex flex-col justify-center">
                    <div className="truncate text-sm font-semibold text-white">{cityShort(data.city) || t('configuredLocation')}</div>
                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-white/80">
                        <span className="text-lg sm:text-xl font-semibold text-white">{data.temperatureC.toFixed(1)}°C</span>
                        <span className="text-xs sm:text-sm text-white/70">{cond}</span>
                        <span className="text-xs sm:text-sm text-white/70 whitespace-nowrap">{t('wind')} {data.windSpeedKph.toFixed(1)} km/h</span>
                    </div>
                </div>
            </div>

            {/* 5-day forecast - responsive */}
            {daily.length ? (
                <div className="grid grid-cols-5 gap-1">
                    {daily.map((d) => (
                        <div key={d.date} className="flex flex-col items-center gap-0.5 text-center">
                            <div className="text-[10px] sm:text-[11px] leading-tight text-white/65">{weekdayLabel(d.date, lang)}</div>
                            <WeatherGlyph code={d.weatherCode ?? 0} windKph={0} size={32} />
                            <div className="tabular-nums text-[10px] sm:text-[11px] leading-tight text-white/80">
                                <span className="text-white/90">{Math.round(d.tempMaxC)}°</span>
                                <span className="text-white/50">/{Math.round(d.tempMinC)}°</span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

export default WeatherWidget
