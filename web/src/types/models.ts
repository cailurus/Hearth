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
    greeting?: GreetingSettings
}

export interface GreetingSettings {
    enabled: boolean
}

export interface BackgroundSettings {
    provider: BackgroundProvider
    unsplashQuery: string
    interval: string
    blur?: number
}

export interface TimeSettings {
    enabled: boolean
    timezone: string
    showSeconds: boolean
    showSolarTerm?: boolean
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
    totalSlots?: number
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

/**
 * Docker 容器
 */
export interface DockerContainer {
    id: string
    name: string
    image: string
    status: 'running' | 'exited' | 'paused'
    state: string
    upSince: string
    cpuPercent: number
    memUsed: number
    memLimit: number
    memPercent: number
    netRx: number
    netTx: number
}

export interface DockerResponse {
    available: boolean
    containers: DockerContainer[]
    totalCpu: number
    totalMemUsed: number
    totalMemLimit: number
    collectedAt: number
    error?: string
}

// ============ 指标历史 ============

export interface MetricsHistoryPoint {
    ts: number
    cpuPercent: number
    memPercent: number
    diskPercent: number
    netSendRate: number
    netRecvRate: number
}

export interface MetricsHistoryResponse {
    period: string
    points: MetricsHistoryPoint[]
}

// ============ RSS 订阅 ============

export interface RSSItem {
    title: string
    link: string
    source: string
    publishedAt: number
}

export interface RSSResponse {
    fetchedAt: number
    items: RSSItem[]
}

// ============ 每日一言 ============

export interface QuoteResponse {
    text: string
    author: string
    fetchedAt: number
}

// ============ 汇率 ============

export interface CurrencyPair {
    from: string
    to: string
    rate: number
    change: number
    series: number[]
}

export interface CurrencyResponse {
    fetchedAt: number
    items: CurrencyPair[]
}

// ============ 游戏折扣 ============

export interface GameDeal {
    title: string
    thumbnail: string
    normalPrice: string
    salePrice: string
    discountPct: number
    rating: number
    ratingCount: number
    platform: 'pc' | 'ios'
    storeUrl: string
    storeName: string
}

export interface DealsResponse {
    fetchedAt: number
    items: GameDeal[]
}

// ============ 枚举类型 ============

export type Language = 'zh' | 'en' | string

export type GroupKind = 'system' | 'app' | string

export type BackgroundProvider = 'bing' | 'bing_daily' | 'bing_random' | 'picsum' | 'default' | 'default_video' | string

export type MarketKind = 'stock' | 'crypto' | string
