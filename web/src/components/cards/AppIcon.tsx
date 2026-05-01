import { useEffect, useState } from 'react'
import { isPrivateHost } from '../../utils'
import { useVpnModeEnabled } from '../../contexts/VpnModeContext'

// Lucide CDN URL for SVG icons - pinned version for security
const LUCIDE_CDN_BASE = 'https://unpkg.com/lucide-static@0.460.0/icons'

// Cache for loaded SVGs (with size limit)
const svgCache = new Map<string, string>()
const SVG_CACHE_MAX = 200

/** Strip potentially dangerous elements and attributes from SVG markup */
function sanitizeSvg(raw: string): string {
    return raw
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
        .replace(/<use[^>]*href\s*=\s*["'][^#][^"']*["'][^>]*\/?>/gi, '')
}

function cacheSvg(key: string, value: string) {
    if (svgCache.size >= SVG_CACHE_MAX) {
        // Evict oldest half
        const keys = Array.from(svgCache.keys())
        for (let i = 0; i < keys.length / 2; i++) {
            svgCache.delete(keys[i])
        }
    }
    svgCache.set(key, value)
}

export interface AppIconProps {
    iconPath: string | null
    name: string
    size?: 'sm' | 'md' | 'lg'
    /**
     * The app's URL. Used by the VPN compat fallback path: when the
     * backend can't resolve an icon for a LAN service (because the
     * server's network can't reach it) but the user's browser can, we
     * point an `<img>` straight at `${origin}/favicon.ico`. Browsers
     * load cross-origin images fine — they just can't read the pixels,
     * which we don't need.
     */
    appUrl?: string | null
}

/**
 * App icon component with error handling fallback
 * Supports:
 * - Lucide icons (iconPath starts with "lucide:") - loaded from CDN
 * - Regular image icons (server-cached)
 * - VPN compat mode: when iconPath is empty and appUrl points at a
 *   private host, try the app's own /favicon.ico via the browser
 * - Fallback to first letter of name
 */
export function AppIcon({ iconPath, name, size = 'md', appUrl }: AppIconProps) {
    const [hasError, setHasError] = useState(false)
    const [vpnFaviconErr, setVpnFaviconErr] = useState(false)
    const vpnMode = useVpnModeEnabled()

    // Reset error state when inputs change.
    useEffect(() => {
        setHasError(false)
        setVpnFaviconErr(false)
    }, [iconPath, appUrl])

    const px = size === 'sm' ? 28 : size === 'lg' ? 44 : 36
    const lucidePx = size === 'sm' ? 18 : size === 'lg' ? 28 : 22
    const textClass = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm'
    const boxStyle: React.CSSProperties = { width: px, height: px, minWidth: px, minHeight: px }
    const boxClass = 'flex items-center justify-center rounded-lg bg-white/10 '

    // Lucide icon
    if (iconPath?.startsWith('lucide:')) {
        const iconName = iconPath.slice('lucide:'.length)

        return (
            <div className={boxClass} style={boxStyle}>
                <LucideIcon name={iconName} size={lucidePx} />
            </div>
        )
    }

    // VPN compat mode: when there's no server-cached icon for a LAN
    // service, attempt a direct browser load of `${origin}/favicon.ico`
    // before giving up. We only do this for private hosts so we don't
    // hammer random public sites with extra requests when they already
    // have a working server-cached path.
    if (!iconPath && vpnMode && appUrl && !vpnFaviconErr) {
        let origin: string | null = null
        let host = ''
        try {
            const u = new URL(appUrl)
            origin = u.origin
            host = u.hostname
        } catch {
            // fall through to letter fallback
        }
        if (origin && isPrivateHost(host)) {
            return (
                <img
                    src={`${origin}/favicon.ico`}
                    alt=""
                    className="rounded-lg bg-white/10 object-contain"
                    style={boxStyle}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => setVpnFaviconErr(true)}
                />
            )
        }
    }

    // Fallback: first letter
    if (!iconPath || hasError) {
        return (
            <div className={`${boxClass} ${textClass} font-semibold`} style={boxStyle}>
                {name.slice(0, 1).toUpperCase()}
            </div>
        )
    }

    // Regular image icon (server-cached or absolute URL)
    const src = iconPath.startsWith('http') || iconPath.startsWith('data:')
        ? iconPath
        : `/assets/icons/${iconPath}`

    return (
        <img
            src={src}
            alt=""
            className={`rounded-lg bg-white/10  object-contain`}
            style={boxStyle}
            loading="lazy"
            onError={() => setHasError(true)}
        />
    )
}

/**
 * Lucide icon component that loads SVG from CDN.
 * Uses a single numeric `size` (px) to avoid Tailwind/inline-style conflicts.
 */
function LucideIcon({ name, size = 20 }: { name: string; size?: number }) {
    const [svg, setSvg] = useState<string | null>(() => svgCache.get(name.toLowerCase()) || null)
    const [error, setError] = useState(false)

    const kebabName = name
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
        .toLowerCase()

    useEffect(() => {
        if (svgCache.has(kebabName)) {
            setSvg(svgCache.get(kebabName)!)
            return
        }

        let mounted = true
        const loadSvg = async () => {
            try {
                const res = await fetch(`${LUCIDE_CDN_BASE}/${kebabName}.svg`)
                if (res.ok && mounted) {
                    const text = sanitizeSvg(await res.text())
                    cacheSvg(kebabName, text)
                    setSvg(text)
                } else if (mounted) {
                    setError(true)
                }
            } catch {
                if (mounted) setError(true)
            }
        }
        loadSvg()

        return () => { mounted = false }
    }, [kebabName])

    if (error) {
        return <span style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>?</span>
    }

    if (!svg) {
        return <span style={{ width: size, height: size, display: 'inline-block' }} />
    }

    // Replace any existing width/height and set our own to guarantee a square.
    const processed = svg
        .replace(/width="[^"]*"/, `width="${size}"`)
        .replace(/height="[^"]*"/, `height="${size}"`)
        .replace(/stroke="[^"]*"/g, 'stroke="currentColor"')

    return (
        <span
            className="text-white/80"
            style={{ display: 'inline-flex', width: size, height: size }}
            dangerouslySetInnerHTML={{ __html: processed }}
        />
    )
}

export default AppIcon
