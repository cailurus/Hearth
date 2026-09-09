/**
 * useCitySearch - 城市搜索防抖
 */

import { useState, useEffect, useRef } from 'react'
import { apiGet } from '../api'
import type { GeocodeResult, GeocodeResponse } from '../types'
import { weatherCoordinates } from '../utils/weatherLocation'

interface UseCitySearchOptions {
    enabled: boolean
    query: string
    lang: 'zh' | 'en'
    debounceMs?: number
}

interface UseCitySearchResult {
    options: GeocodeResult[]
    loading: boolean
    clear: () => void
}

export function useCitySearch({
    enabled,
    query,
    lang,
    debounceMs = 250,
}: UseCitySearchOptions): UseCitySearchResult {
    const [options, setOptions] = useState<GeocodeResult[]>([])
    const [loading, setLoading] = useState(false)
    const seqRef = useRef(0)

    useEffect(() => {
        const seq = ++seqRef.current
        if (!enabled) {
            setOptions([])
            setLoading(false)
            return
        }

        const trimmed = (query || '').trim()
        if (!trimmed) {
            setOptions([])
            setLoading(false)
            return
        }

        const controller = new AbortController()
        setLoading(true)

        const timer = window.setTimeout(async () => {
            try {
                const res = await apiGet<GeocodeResponse>(
                    `/api/widgets/geocode?${new URLSearchParams({ query: trimmed, lang }).toString()}`,
                    { signal: controller.signal },
                )

                if (seq !== seqRef.current) return

                const unique = new Map<string, GeocodeResult>()
                for (const result of res?.results || []) {
                    if (result.displayName && !unique.has(result.displayName)) {
                        unique.set(result.displayName, { displayName: result.displayName, ...weatherCoordinates(result) })
                    }
                }
                setOptions([...unique.values()].slice(0, 12))
            } catch {
                if (seq !== seqRef.current) return
                setOptions([])
            } finally {
                if (seq === seqRef.current) {
                    setLoading(false)
                }
            }
        }, debounceMs)

        return () => {
            window.clearTimeout(timer)
            controller.abort()
            seqRef.current++
        }
    }, [enabled, query, lang, debounceMs])

    const clear = () => {
        setOptions([])
        setLoading(false)
        seqRef.current++
    }

    return { options, loading, clear }
}
