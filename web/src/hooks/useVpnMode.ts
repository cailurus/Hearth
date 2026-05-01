/**
 * useVpnMode — persistent toggle for "VPN compat mode".
 *
 * When enabled, status probing for private-host targets shifts from the
 * backend to the user's browser (see useAppStatus). Persisted per-browser
 * in localStorage; key intentionally short to keep the storage debug view
 * tidy.
 */

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'hearth_vpn_compat'

function readInitial(): boolean {
    if (typeof window === 'undefined') return false
    try {
        return window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
        return false
    }
}

export function useVpnMode(): { enabled: boolean; toggle: () => void } {
    const [enabled, setEnabled] = useState<boolean>(readInitial)

    // Sync across tabs: another tab toggles, we update.
    useEffect(() => {
        if (typeof window === 'undefined') return
        const onStorage = (e: StorageEvent) => {
            if (e.key !== STORAGE_KEY) return
            setEnabled(e.newValue === '1')
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const toggle = useCallback(() => {
        setEnabled((prev) => {
            const next = !prev
            try {
                window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
            } catch {
                // localStorage can throw in private mode / quota — treat as ephemeral.
            }
            return next
        })
    }, [])

    return { enabled, toggle }
}
