import type { GeocodeResult, WeatherSettings } from '../types'

export function weatherCoordinates(value: { lat?: unknown; lon?: unknown } | null | undefined): Pick<WeatherSettings, 'lat' | 'lon'> {
    if (typeof value?.lat !== 'number' || typeof value.lon !== 'number'
        || !Number.isFinite(value.lat) || !Number.isFinite(value.lon)
        || Math.abs(value.lat) > 90 || Math.abs(value.lon) > 180) return {}
    return { lat: value.lat, lon: value.lon }
}

export function weatherLocation(city: string, option?: GeocodeResult): WeatherSettings {
    return { city, ...weatherCoordinates(option) }
}

export function weatherQuery(cfg: WeatherSettings, lang: 'zh' | 'en'): URLSearchParams {
    const params = new URLSearchParams({ city: cfg.city.trim(), lang })
    const { lat, lon } = weatherCoordinates(cfg)
    if (lat !== undefined && lon !== undefined) {
        params.set('lat', String(lat))
        params.set('lon', String(lon))
    }
    return params
}
