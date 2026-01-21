/**
 * Widgets 数据相关 API
 */

import { apiGet } from './client'
import type {
    Weather,
    HostMetrics,
    MarketsResponse,
    HolidaysResponse,
    HolidayCountry,
    GeocodeResponse,
    TimezoneResolve,
    MarketSymbolSearchResponse,
    Language,
} from '../types'

export const widgetsApi = {
    /**
     * 获取天气数据
     */
    getWeather: (city: string, lang: Language) => {
        const params = new URLSearchParams({ city, lang })
        return apiGet<Weather>(`/api/widgets/weather?${params}`)
    },

    /**
     * 获取主机指标
     */
    getMetrics: () => apiGet<HostMetrics>('/api/metrics/host'),

    /**
     * 获取市场行情
     */
    getMarkets: (symbols: string[]) => {
        const params = new URLSearchParams({ symbols: symbols.join(',') })
        return apiGet<MarketsResponse>(`/api/widgets/markets?${params}`)
    },

    /**
     * 获取假日数据
     */
    getHolidays: (countries: string[]) => {
        const params = new URLSearchParams({ countries: countries.join(',') })
        return apiGet<HolidaysResponse>(`/api/widgets/holidays?${params}`)
    },

    /**
     * 获取支持的假日国家列表
     */
    getHolidayCountries: () => apiGet<HolidayCountry[]>('/api/widgets/holidays/countries'),

    /**
     * 地理编码（城市搜索）
     */
    geocode: (query: string, lang: Language) => {
        const params = new URLSearchParams({ query, lang })
        return apiGet<GeocodeResponse>(`/api/widgets/geocode?${params}`)
    },

    /**
     * 获取城市时区
     */
    getTimezone: (city: string, lang: Language) => {
        const params = new URLSearchParams({ city, lang })
        return apiGet<TimezoneResolve>(`/api/widgets/timezone?${params}`)
    },

    /**
     * 搜索市场符号
     */
    searchMarketSymbols: (query: string) => {
        const params = new URLSearchParams({ q: query })
        return apiGet<MarketSymbolSearchResponse>(`/api/widgets/markets/search?${params}`)
    },
}
