/**
 * VpnModeContext — single source of truth for the VPN compat toggle.
 *
 * `useVpnMode()` itself is a stateful hook backed by localStorage; calling
 * it from many leaf components (every AppIcon!) would create independent
 * state copies that don't see each other's toggles unless the storage
 * event fires (which it doesn't fire in the same tab that did the write).
 * This provider funnels the single HomePage-level instance down so leaves
 * can read the current value cheaply.
 */

import { createContext, useContext, type ReactNode } from 'react'

const VpnModeContext = createContext<boolean>(false)

interface VpnModeProviderProps {
    enabled: boolean
    children: ReactNode
}

export function VpnModeProvider({ enabled, children }: VpnModeProviderProps) {
    return <VpnModeContext.Provider value={enabled}>{children}</VpnModeContext.Provider>
}

/**
 * Returns the current VPN compat mode flag. Defaults to `false` outside any
 * provider — callers should treat that as "feature off", which is the safe
 * fall-through (status comes from the backend, no browser-side fallback).
 */
export function useVpnModeEnabled(): boolean {
    return useContext(VpnModeContext)
}
