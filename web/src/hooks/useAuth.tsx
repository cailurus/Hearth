import { useState, useCallback, type FormEvent } from 'react'
import { apiPost, apiGet } from '../api'

export interface UseAuthResult {
    /** Current user info */
    me: { admin: boolean } | null
    /** Login error message */
    error: string | null
    /** Whether login is in progress */
    loading: boolean
    /** Login form state */
    username: string
    password: string
    /** Login form setters */
    setUsername: (v: string) => void
    setPassword: (v: string) => void
    /** Login handler */
    onLogin: (e: FormEvent) => Promise<void>
    /** Logout handler */
    onLogout: () => Promise<void>
    /** Reload me */
    reloadMe: () => Promise<void>
}

/**
 * Hook for managing authentication state and actions
 */
export function useAuth(onAuthChange?: () => Promise<void>): UseAuthResult {
    const [me, setMe] = useState<{ admin: boolean } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [username, setUsername] = useState('admin')
    const [password, setPassword] = useState('')

    const reloadMe = useCallback(async () => {
        try {
            const m = await apiGet<{ admin: boolean }>('/api/auth/me')
            setMe(m)
        } catch {
            setMe(null)
        }
    }, [])

    const onLogin = useCallback(
        async (e: FormEvent) => {
            e.preventDefault()
            setError(null)
            setLoading(true)
            try {
                await apiPost('/api/auth/login', { username, password })
                const m = await apiGet<{ admin: boolean }>('/api/auth/me')
                setMe(m)
                setPassword('')
                await onAuthChange?.()
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Login failed')
            } finally {
                setLoading(false)
            }
        },
        [username, password, onAuthChange]
    )

    const onLogout = useCallback(async () => {
        try {
            await apiPost('/api/auth/logout')
        } finally {
            setMe(null)
            await onAuthChange?.()
        }
    }, [onAuthChange])

    return {
        me,
        error,
        loading,
        username,
        password,
        setUsername,
        setPassword,
        onLogin,
        onLogout,
        reloadMe,
    }
}

export default useAuth
