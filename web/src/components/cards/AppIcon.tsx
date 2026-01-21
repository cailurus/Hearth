import { useEffect, useState } from 'react'

// Lucide CDN URL for SVG icons
const LUCIDE_CDN_BASE = 'https://unpkg.com/lucide-static@latest/icons'

// Cache for loaded SVGs
const svgCache = new Map<string, string>()

export interface AppIconProps {
    iconPath: string | null
    name: string
    size?: 'sm' | 'md' | 'lg'
}

/**
 * App icon component with error handling fallback
 * Supports:
 * - Lucide icons (iconPath starts with "lucide:") - loaded from CDN
 * - Regular image icons
 * - Fallback to first letter of name
 */
export function AppIcon({ iconPath, name, size = 'md' }: AppIconProps) {
    const [hasError, setHasError] = useState(false)

    // Reset error state when iconPath changes
    useEffect(() => {
        setHasError(false)
    }, [iconPath])

    const sizeClass = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9'
    const iconSizeClass = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5'
    const textClass = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm'

    // Check if it's a Lucide icon
    if (iconPath?.startsWith('lucide:')) {
        const iconName = iconPath.slice('lucide:'.length)
        
        return (
            <div className={`flex ${sizeClass} items-center justify-center rounded-lg bg-white/10`}>
                <LucideIcon name={iconName} className={`${iconSizeClass} text-white/80`} />
            </div>
        )
    }

    // Regular image icon or fallback
    if (!iconPath || hasError) {
        return (
            <div className={`flex ${sizeClass} items-center justify-center rounded-lg bg-white/10 ${textClass} font-semibold`}>
                {name.slice(0, 1).toUpperCase()}
            </div>
        )
    }

    const src = iconPath.startsWith('http') || iconPath.startsWith('data:')
        ? iconPath
        : `/assets/icons/${iconPath}`

    return (
        <img
            src={src}
            alt=""
            className={`${sizeClass} rounded-lg bg-white/10 object-contain`}
            loading="lazy"
            onError={() => setHasError(true)}
        />
    )
}

/**
 * Lucide icon component that loads SVG from CDN
 */
interface LucideIconProps {
    name: string
    className?: string
}

function LucideIcon({ name, className = 'h-5 w-5' }: LucideIconProps) {
    const [svg, setSvg] = useState<string | null>(() => svgCache.get(name.toLowerCase()) || null)
    const [error, setError] = useState(false)

    // Convert PascalCase to kebab-case for CDN URL
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
                    const text = await res.text()
                    svgCache.set(kebabName, text)
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

    // Parse size from className
    const sizeMatch = className.match(/h-(\d+)/)
    const size = sizeMatch ? parseInt(sizeMatch[1]) * 4 : 20

    if (error) {
        return <span className={className}>?</span>
    }

    if (!svg) {
        // Loading placeholder - invisible
        return <span className={className} />
    }

    return (
        <span
            className={className}
            style={{ display: 'inline-flex', width: size, height: size }}
            dangerouslySetInnerHTML={{
                __html: svg
                    .replace('<svg', `<svg width="${size}" height="${size}"`)
                    .replace(/stroke="[^"]*"/g, 'stroke="currentColor"')
            }}
        />
    )
}

export default AppIcon
