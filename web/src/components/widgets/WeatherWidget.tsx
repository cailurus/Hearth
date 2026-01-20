import { useMemo } from 'react'
import type { Weather } from '../../types'
import { cityShort } from '../../utils/helpers'

interface WeatherWidgetProps {
    data: Weather | null
    error?: string | null
    lang: 'zh' | 'en'
}

/**
 * 天气组件
 */
export function WeatherWidget({ data, error, lang }: WeatherWidgetProps) {
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    const weatherDescription = useMemo(() => {
        if (!data) return ''
        return getWeatherDescription(data.weatherCode, lang)
    }, [data, lang])

    if (error) {
        return (
            <div className="flex items-center justify-center h-full text-red-400 text-sm">
                {error}
            </div>
        )
    }

    if (!data) {
        return (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                {t('加载中...', 'Loading...')}
            </div>
        )
    }

    const weatherIcon = getWeatherIcon(data.weatherCode)

    return (
        <div className="flex flex-col h-full p-4">
            <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    {cityShort(data.city)}
                </span>
                <span className="text-3xl">{weatherIcon}</span>
            </div>

            <div className="flex items-baseline gap-1">
                <span className="text-4xl font-light text-gray-900 dark:text-white">
                    {Math.round(data.temperatureC)}
                </span>
                <span className="text-xl text-gray-400">°C</span>
            </div>

            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {weatherDescription}
            </div>

            {data.daily && data.daily.length > 0 && (
                <div className="mt-auto pt-3 flex gap-2 overflow-x-auto">
                    {data.daily.slice(0, 5).map((day, i) => (
                        <div
                            key={i}
                            className="flex flex-col items-center text-xs text-gray-500 dark:text-gray-400 min-w-[40px]"
                        >
                            <span>{formatDayName(day.date, lang)}</span>
                            <span className="text-lg my-1">{getWeatherIcon(day.weatherCode)}</span>
                            <span>
                                {Math.round(day.tempMaxC)}° / {Math.round(day.tempMinC)}°
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function formatDayName(dateStr: string, lang: 'zh' | 'en'): string {
    try {
        const date = new Date(dateStr)
        const today = new Date()
        const tomorrow = new Date(today)
        tomorrow.setDate(today.getDate() + 1)

        if (date.toDateString() === today.toDateString()) {
            return lang === 'en' ? 'Today' : '今天'
        }
        if (date.toDateString() === tomorrow.toDateString()) {
            return lang === 'en' ? 'Tmrw' : '明天'
        }

        return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'zh-CN', { weekday: 'short' })
    } catch {
        return dateStr
    }
}

function getWeatherIcon(code: number): string {
    // WMO Weather interpretation codes
    // https://open-meteo.com/en/docs
    if (code === 0) return '☀️' // Clear sky
    if (code === 1) return '🌤️' // Mainly clear
    if (code === 2) return '⛅' // Partly cloudy
    if (code === 3) return '☁️' // Overcast
    if (code >= 45 && code <= 48) return '🌫️' // Fog
    if (code >= 51 && code <= 55) return '🌧️' // Drizzle
    if (code >= 56 && code <= 57) return '🌧️' // Freezing drizzle
    if (code >= 61 && code <= 65) return '🌧️' // Rain
    if (code >= 66 && code <= 67) return '🌧️' // Freezing rain
    if (code >= 71 && code <= 77) return '❄️' // Snow
    if (code >= 80 && code <= 82) return '🌦️' // Rain showers
    if (code >= 85 && code <= 86) return '🌨️' // Snow showers
    if (code === 95) return '⛈️' // Thunderstorm
    if (code >= 96 && code <= 99) return '⛈️' // Thunderstorm with hail
    return '🌡️'
}

function getWeatherDescription(code: number, lang: 'zh' | 'en'): string {
    const descriptions: Record<number, [string, string]> = {
        0: ['晴', 'Clear sky'],
        1: ['晴间多云', 'Mainly clear'],
        2: ['多云', 'Partly cloudy'],
        3: ['阴', 'Overcast'],
        45: ['雾', 'Fog'],
        48: ['雾凇', 'Depositing rime fog'],
        51: ['小毛毛雨', 'Light drizzle'],
        53: ['毛毛雨', 'Moderate drizzle'],
        55: ['大毛毛雨', 'Dense drizzle'],
        61: ['小雨', 'Slight rain'],
        63: ['中雨', 'Moderate rain'],
        65: ['大雨', 'Heavy rain'],
        71: ['小雪', 'Slight snow'],
        73: ['中雪', 'Moderate snow'],
        75: ['大雪', 'Heavy snow'],
        77: ['雪粒', 'Snow grains'],
        80: ['小阵雨', 'Slight rain showers'],
        81: ['阵雨', 'Moderate rain showers'],
        82: ['大阵雨', 'Violent rain showers'],
        85: ['小阵雪', 'Slight snow showers'],
        86: ['大阵雪', 'Heavy snow showers'],
        95: ['雷暴', 'Thunderstorm'],
        96: ['雷暴伴有小冰雹', 'Thunderstorm with slight hail'],
        99: ['雷暴伴有大冰雹', 'Thunderstorm with heavy hail'],
    }

    const [zh, en] = descriptions[code] || ['未知', 'Unknown']
    return lang === 'en' ? en : zh
}

export default WeatherWidget
