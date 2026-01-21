/**
 * 天气相关工具函数
 */

import type { Language } from '../types'

/**
 * 天气类型
 */
export type WeatherKind = 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog'

/**
 * 根据 WMO 天气代码获取天气类型
 */
export function weatherKind(code: number): WeatherKind {
    if (code === 0) return 'sun'
    if (code === 1 || code === 2 || code === 3) return 'cloud'
    if (code === 45 || code === 48) return 'fog'
    if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow'
    if (code >= 95) return 'storm'
    return 'cloud'
}

/**
 * 根据 WMO 天气代码获取天气标签
 */
export function weatherCodeLabel(code: number, lang: Language): string {
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
