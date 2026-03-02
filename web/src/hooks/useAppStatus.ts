import { useState, useEffect, useCallback, useRef } from 'react'
import { apiGet } from '../api'

export interface AppStatusItem {
    id: string
    status: 'up' | 'slow' | 'down'
    statusCode: number
    latencyMs: number
}

interface StatusResponse {
    items: AppStatusItem[]
}

export function useAppStatus(enabled: boolean, intervalMs: number = 60000) {
    const [statusMap, setStatusMap] = useState<Record<string, AppStatusItem>>({})
    const mountedRef = useRef(true)

    const fetchStatus = useCallback(async () => {
        if (!enabled) return
        try {
            const data = await apiGet<StatusResponse>('/api/apps/status')
            if (!mountedRef.current) return
            const map: Record<string, AppStatusItem> = {}
            for (const item of data.items) {
                map[item.id] = item
            }
            setStatusMap(map)
        } catch {
            // Status is non-critical, silently ignore
        }
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

    return { statusMap }
}
