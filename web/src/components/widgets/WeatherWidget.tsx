import type { Weather } from '../../types'
import { cityShort } from '../../utils/helpers'

interface WeatherWidgetProps {
    data: Weather | null
    error?: string | null
    lang: 'zh' | 'en'
}

/**
 * 天气组件 - 显示当前天气和5日预报
 */
export function WeatherWidget({ data, error, lang }: WeatherWidgetProps) {
    if (!data) {
        const msg = String(error || '').trim()
        if (msg) return <div className="flex h-full items-center justify-center text-sm text-white/60">{msg}</div>
        return <div className="flex h-full items-center justify-center text-sm text-white/60">{lang === 'en' ? 'Loading…' : '加载中…'}</div>
    }
    const cond = weatherCodeLabel(data.weatherCode, lang)

    const daily = (Array.isArray(data.daily) ? data.daily : []).slice(0, 5)

    return (
        <div className="flex flex-col gap-2">
            {/* Current weather - responsive layout */}
            <div className="grid grid-cols-5 gap-1.5 items-center">
                <div className="flex items-center justify-center">
                    <WeatherGlyph code={data.weatherCode} windKph={data.windSpeedKph} className="w-10 h-10 sm:w-11 sm:h-11" />
                </div>
                <div className="col-span-4 min-w-0 flex flex-col justify-center">
                    <div className="truncate text-sm font-semibold text-white">{cityShort(data.city) || (lang === 'en' ? 'Configured location' : '已配置位置')}</div>
                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-white/80">
                        <span className="text-lg sm:text-xl font-semibold text-white">{data.temperatureC.toFixed(1)}°C</span>
                        <span className="text-xs sm:text-sm text-white/70">{cond}</span>
                        <span className="text-xs sm:text-sm text-white/70 whitespace-nowrap">{lang === 'en' ? 'Wind' : '风'} {data.windSpeedKph.toFixed(1)} km/h</span>
                    </div>
                </div>
            </div>

            {/* 5-day forecast - responsive */}
            {daily.length ? (
                <div className="grid grid-cols-5 gap-1">
                    {daily.map((d) => (
                        <div key={d.date} className="flex flex-col items-center gap-0.5 text-center">
                            <div className="text-[10px] sm:text-[11px] leading-tight text-white/65">{weekdayLabel(d.date, lang)}</div>
                            <WeatherGlyph code={d.weatherCode ?? 0} windKph={0} className="w-7 h-7 sm:w-8 sm:h-8" />
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

function WeatherGlyph({ code, windKph, className = 'w-10 h-10' }: { code: number; windKph: number; className?: string }) {
    const kind = weatherKind(code)
    if (kind === 'sun') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" className="text-white" />
                <g className="animate-pulse text-white/90">
                    <path d="M12 2v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M12 19v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M2 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M4.2 4.2l2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M17.7 17.7l2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M19.8 4.2l-2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M6.3 17.7l-2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </g>
            </svg>
        )
    }
    if (kind === 'rain') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.8 1.3A3.5 3.5 0 0 1 17.5 16H7Z" stroke="currentColor" strokeWidth="2" className="text-white" />
                <g className="text-white/90">
                    <path d="M9 18l-1 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-bounce" />
                    <path d="M13 18l-1 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-bounce" style={{ animationDelay: '120ms' }} />
                    <path d="M17 18l-1 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-bounce" style={{ animationDelay: '240ms' }} />
                </g>
            </svg>
        )
    }
    if (kind === 'snow') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.8 1.3A3.5 3.5 0 0 1 17.5 16H7Z" stroke="currentColor" strokeWidth="2" className="text-white" />
                <g className="text-white/90 animate-pulse">
                    <circle cx="9" cy="19" r="1" fill="currentColor" />
                    <circle cx="13" cy="19" r="1" fill="currentColor" />
                    <circle cx="17" cy="19" r="1" fill="currentColor" />
                </g>
            </svg>
        )
    }
    if (kind === 'storm') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.8 1.3A3.5 3.5 0 0 1 17.5 16H7Z" stroke="currentColor" strokeWidth="2" className="text-white" />
                <path d="M13 16l-2 4h2l-1 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white animate-pulse" />
            </svg>
        )
    }
    if (kind === 'fog') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/90" />
                <path d="M6 16h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/70" />
                <path d="M8 20h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/60" />
            </svg>
        )
    }
    // clouds / default
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.8 1.3A3.5 3.5 0 0 1 17.5 16H7Z" stroke="currentColor" strokeWidth="2" className="text-white" />
            {windKph >= 18 ? (
                <path d="M5 19h9c2 0 2-2 0-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/80 animate-pulse" />
            ) : null}
        </svg>
    )
}

function weatherKind(code: number): 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog' {
    if (code === 0) return 'sun'
    if (code === 1 || code === 2 || code === 3) return 'cloud'
    if (code === 45 || code === 48) return 'fog'
    if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow'
    if (code >= 95) return 'storm'
    return 'cloud'
}

function weatherCodeLabel(code: number, lang: 'zh' | 'en'): string {
    const zh = {
        clear: '晴',
        partly: '多云',
        overcast: '阴',
        fog: '雾',
        rain: '雨',
        snow: '雪',
        storm: '雷暴',
        code: (c: number) => `天气码 ${c}`,
    }
    const en = {
        clear: 'Clear',
        partly: 'Partly cloudy',
        overcast: 'Overcast',
        fog: 'Fog',
        rain: 'Rain',
        snow: 'Snow',
        storm: 'Thunderstorm',
        code: (c: number) => `Code ${c}`,
    }
    const dict = lang === 'en' ? en : zh
    if (code === 0) return dict.clear
    if (code === 1 || code === 2) return dict.partly
    if (code === 3) return dict.overcast
    if (code === 45 || code === 48) return dict.fog
    if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return dict.rain
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return dict.snow
    if (code >= 95) return dict.storm
    return dict.code(code)
}

function weekdayLabel(dateStr: string, lang: 'zh' | 'en'): string {
    const d = new Date(`${dateStr}T00:00:00`)
    if (Number.isNaN(d.getTime())) return dateStr
    return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'zh-CN', { weekday: 'short' }).format(d)
}

export default WeatherWidget
