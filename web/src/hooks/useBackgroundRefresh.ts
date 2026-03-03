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

            // Force the browser to load the new image by changing the nonce.
            // Always update nonce after successful refresh — even if preload fails,
            // the <img> tag will fetch the new background on its own.
            const nextNonce = Date.now()
            setBgNonce(nextNonce)

            // Best-effort preload so the transition feels instant
            try {
                const nextUrl = `/api/background/image?v=${nextNonce}`
                const img = new Image()
                img.src = nextUrl
            } catch {
                // ignore — nonce is already updated, <img> will load it
            }
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
