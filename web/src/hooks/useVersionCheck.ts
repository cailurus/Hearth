import { useState, useEffect } from 'react'
import { apiGet } from '../api'

interface HealthResponse {
    ok: boolean
    version: string
}

interface GitHubRelease {
    tag_name: string
}

function compareVersions(current: string, latest: string): number {
    // Strip leading 'v'
    const a = current.replace(/^v/, '').split('.').map(Number)
    const b = latest.replace(/^v/, '').split('.').map(Number)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const av = a[i] ?? 0
        const bv = b[i] ?? 0
        if (av < bv) return -1
        if (av > bv) return 1
    }
    return 0
}

export function useVersionCheck() {
    const [currentVersion, setCurrentVersion] = useState<string | null>(null)
    const [latestVersion, setLatestVersion] = useState<string | null>(null)
    const [hasUpdate, setHasUpdate] = useState(false)

    useEffect(() => {
        let cancelled = false

        const check = async () => {
            try {
                // Fetch current version from backend
                const health = await apiGet<HealthResponse>('/api/health')
                if (cancelled) return
                const current = health.version
                setCurrentVersion(current)

                // Don't check for updates if running dev build
                if (current === 'dev') return

                // Fetch latest release from GitHub
                const resp = await fetch(
                    'https://api.github.com/repos/cailurus/Hearth/releases/latest',
                    { headers: { Accept: 'application/vnd.github.v3+json' } },
                )
                if (cancelled || !resp.ok) return
                const release: GitHubRelease = await resp.json()
                if (cancelled) return

                const latest = release.tag_name
                setLatestVersion(latest)
                setHasUpdate(compareVersions(current, latest) < 0)
            } catch {
                // Non-critical, silently ignore
            }
        }

        check()
        return () => { cancelled = true }
    }, [])

    return { currentVersion, latestVersion, hasUpdate }
}
