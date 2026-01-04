export type Settings = {
    siteTitle: string
    language: 'zh' | 'en' | string
    background: {
        provider: 'bing' | 'picsum' | string
        unsplashQuery: string
        interval: string
    }

    time: {
        enabled: boolean
        timezone: string
        showSeconds: boolean
        mode: 'digital' | 'clock' | string
    }

    timezones: string[]
    weather: {
        city: string
    }
}

export type Group = {
    id: string
    name: string
    kind: 'system' | 'app' | string
    sortOrder: number
    createdAt: number
}

export type AppItem = {
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

export type BackgroundInfo = {
    provider: string
    imageUrl: string
}

export type Weather = {
    city: string
    temperatureC: number
    weatherCode: number
    windSpeedKph: number
    fetchedAt: number

    daily: Array<{
        date: string
        weatherCode: number
        tempMaxC: number
        tempMinC: number
    }>
}

export type HostMetrics = {
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
