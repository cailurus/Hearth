/**
 * useBackgroundRefresh - 背景刷新管理
 */

import { useState, useCallback, useRef } from 'react'
import { fetchWithTimeout } from '../utils'

interface UseBackgroundRefreshOptions {
    isAdmin: boolean
    currentProvider: string
    draftProvider?: string
}

interface UseBackgroundRefreshResult {
    bgNonce: number
    refreshing: boolean
    error: string | null
    refresh: () => Promise<void>
}

export function useBackgroundRefresh({
    isAdmin,
    currentProvider,
    draftProvider,
}: UseBackgroundRefreshOptions): UseBackgroundRefreshResult {
    const [bgNonce, setBgNonce] = useState(0)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const refreshingRef = useRef(false)

    const refresh = useCallback(async () => {
        if (!isAdmin) return
        if (refreshingRef.current) return

        refreshingRef.current = true
        setRefreshing(true)
        setError(null)

        try {
            const provider = (draftProvider || currentProvider || 'default').trim()

            const refreshRes = await fetchWithTimeout(
                `/api/background/refresh?${new URLSearchParams({ provider }).toString()}`,
                { method: 'POST', credentials: 'include' },
                15000
            )

            if (!refreshRes.ok) {
                const text = await refreshRes.text().catch(() => '')
                const msg = (() => {
                    try {
                        const data = text ? (JSON.parse(text) as unknown) : null
                        if (data && typeof data === 'object' && 'error' in data) {
                            const e = (data as { error?: unknown }).error
                            if (typeof e === 'string' && e.trim()) return e.trim()
                        }
                    } catch {
                        // ignore
                    }
                    return text?.trim() || refreshRes.statusText || 'failed'
                })()
                throw new Error(msg)
            }

            // Preload the next background
            const nextNonce = Date.now()
            const base = '/api/background/image'
            const nextUrl = base + `?v=${nextNonce}`

            const res = await fetchWithTimeout(nextUrl, { credentials: 'include' }, 20000)
            if (!res.ok) {
                const text = await res.text().catch(() => '')
                const msg = (() => {
                    try {
                        const data = text ? (JSON.parse(text) as unknown) : null
                        if (data && typeof data === 'object' && 'error' in data) {
                            const e = (data as { error?: unknown }).error
                            if (typeof e === 'string' && e.trim()) return e.trim()
                        }
                    } catch {
                        // ignore
                    }
                    return text?.trim() || res.statusText || 'failed'
                })()
                throw new Error(msg)
            }

            await res.blob()

            await Promise.race([
                new Promise<void>((resolve, reject) => {
                    const img = new Image()
                    img.onload = () => resolve()
                    img.onerror = () => reject(new Error('failed'))
                    img.src = nextUrl
                }),
                new Promise<void>((_, reject) => {
                    window.setTimeout(() => reject(new Error('timeout')), 12000)
                }),
            ])

            setBgNonce(nextNonce)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'failed')
        } finally {
            refreshingRef.current = false
            setRefreshing(false)
        }
    }, [isAdmin, currentProvider, draftProvider])

    return {
        bgNonce,
        refreshing,
        error,
        refresh,
    }
}
