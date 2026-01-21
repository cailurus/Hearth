/**
 * 业务模型类型定义
 */

/**
 * 系统设置
 */
export interface Settings {
    siteTitle: string
    language: Language
    background: BackgroundSettings
    time: TimeSettings
    timezones: string[]
    weather: WeatherSettings
    titleSortOrder?: number
}

export interface BackgroundSettings {
    provider: BackgroundProvider
    unsplashQuery: string
    interval: string
}

export interface TimeSettings {
    enabled: boolean
    timezone: string
    showSeconds: boolean
    mode: 'digital' | 'clock' | string
}

export interface WeatherSettings {
    city: string
}

/**
 * 分组
 */
export interface Group {
    id: string
    name: string
    kind: GroupKind
    sortOrder: number
    createdAt: number
}

/**
 * App 链接项
 */
export interface AppItem {
    id: string
    groupId: string | null
    name: string
    description: string | null
    url: string
    iconPath: string | null
    iconSource: string | null
    sortOrder: number
    createdAt: number
}

/**
 * 背景信息
 */
export interface BackgroundInfo {
    provider: string
    imageUrl: string
}

/**
 * 天气数据
 */
export interface Weather {
    city: string
    temperatureC: number
    weatherCode: number
    windSpeedKph: number
    fetchedAt: number
    daily: WeatherDaily[]
}

export interface WeatherDaily {
    date: string
    weatherCode: number
    tempMaxC: number
    tempMinC: number
}

/**
 * 主机指标
 */
export interface HostMetrics {
    collectedAt: number
    cpuPercent: number
    cpuCores: number
    cpuModel: string
    memUsed: number
    memTotal: number
    memPercent: number
    diskUsed: number
    diskTotal: number
    diskPercent: number
    netBytesSent: number
    netBytesRecv: number
}

/**
 * 市场行情
 */
export interface MarketQuote {
    symbol: string
    kind: MarketKind
    name?: string
    priceUsd: number
    changePct24h: number
    series: number[]
}

export interface MarketsResponse {
    fetchedAt: number
    items: MarketQuote[]
}

/**
 * 假日
 */
export interface HolidayItem {
    country: string
    date: string
    name: string
    localName: string
    daysUntil: number
}

export interface HolidaysResponse {
    fetchedAt: number
    items: HolidayItem[]
}

export interface HolidayCountry {
    code: string
    name: string
}

// ============ 枚举类型 ============

export type Language = 'zh' | 'en' | string

export type GroupKind = 'system' | 'app' | string

export type BackgroundProvider = 'bing' | 'bing_daily' | 'bing_random' | 'picsum' | 'default' | string

export type MarketKind = 'stock' | 'crypto' | string
