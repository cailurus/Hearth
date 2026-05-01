import { useState, useEffect, useCallback, useRef } from 'react'
import { apiGet } from '../api'
import { browserProbe, isPrivateHost } from '../utils'
import type { AppItem } from '../types'

export interface AppStatusItem {
    id: string
    status: 'up' | 'slow' | 'down' | 'unknown'
    statusCode: number
    latencyMs: number
}

interface StatusResponse {
    items: AppStatusItem[]
}

interface UseAppStatusOptions {
    enabled?: boolean
    intervalMs?: number
    /**
     * When true, every app whose URL host parses as a private network
     * target is probed from the browser instead of trusting the backend
     * result. Public targets keep the backend probe (it knows status
     * codes and latency, which we lose under no-cors).
     */
    vpnMode?: boolean
}

/**
 * Extract the host portion of an app URL for `isPrivateHost`. Returns
 * empty string on parse failure (caller treats that as non-private).
 */
function hostOf(url: string): string {
    try {
        return new URL(url).hostname
    } catch {
        return ''
    }
}

export function useAppStatus(
    apps: AppItem[],
    options: UseAppStatusOptions = {}
) {
    const { enabled = true, intervalMs = 60000, vpnMode = false } = options
    const [statusMap, setStatusMap] = useState<Record<string, AppStatusItem>>({})
    const mountedRef = useRef(true)

    // Stable refs so the fetch callback can read the latest values
    // without triggering a new interval on every render.
    const appsRef = useRef(apps)
    appsRef.current = apps
    const vpnModeRef = useRef(vpnMode)
    vpnModeRef.current = vpnMode

    const fetchStatus = useCallback(async () => {
        if (!enabled) return
        let backendItems: AppStatusItem[] = []
        try {
            const data = await apiGet<StatusResponse>('/api/apps/status')
            backendItems = data.items
        } catch {
            // Status is non-critical; soldier on with empty backend results.
        }
        if (!mountedRef.current) return

        const map: Record<string, AppStatusItem> = {}
        for (const item of backendItems) {
            map[item.id] = item
        }

        // VPN compat mode: for any app whose URL host is private, override
        // the backend result with a fresh browser probe. Public hosts
        // keep the backend result (we lose status codes / latency under
        // no-cors, which would be a regression for them).
        if (vpnModeRef.current) {
            const targets = appsRef.current.filter(
                (a) => a.url.startsWith('http://') || a.url.startsWith('https://'),
            ).filter((a) => isPrivateHost(hostOf(a.url)))

            await Promise.all(targets.map(async (a) => {
                const start = Date.now()
                const result = await browserProbe(a.url, 5000)
                const latencyMs = Date.now() - start
                if (!mountedRef.current) return
                map[a.id] = {
                    id: a.id,
                    status: result,
                    statusCode: 0,
                    latencyMs,
                }
            }))
        }

        if (!mountedRef.current) return
        setStatusMap(map)
    }, [enabled])

    useEffect(() => {
        mountedRef.current = true
        fetchStatus()

        if (!enabled) return
        const id = window.setInterval(fetchStatus, intervalMs)
        return () => {
            mountedRef.current = false
            window.clearInterval(id)
        }
    }, [enabled, intervalMs, fetchStatus])

    // Re-run immediately when vpnMode flips so the UI reflects the
    // change without waiting for the next tick.
    useEffect(() => {
        if (!enabled) return
        fetchStatus()
        // fetchStatus depends only on `enabled`, not on vpnMode (we
        // read the latest via vpnModeRef), so depending on vpnMode is
        // intentional even though eslint would complain.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vpnMode, enabled])

    return { statusMap, refresh: fetchStatus }
}
