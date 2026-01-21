import { useEffect, useState } from 'react'

export interface AppIconProps {
    iconPath: string | null
    name: string
    size?: 'sm' | 'md' | 'lg'
}

/**
 * App icon component with error handling fallback
 * Shows first letter of name if icon fails to load
 */
export function AppIcon({ iconPath, name, size = 'md' }: AppIconProps) {
    const [hasError, setHasError] = useState(false)

    // Reset error state when iconPath changes
    useEffect(() => {
        setHasError(false)
    }, [iconPath])

    const sizeClass = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9'
    const textClass = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm'

    if (!iconPath || hasError) {
        return (
            <div className={`flex ${sizeClass} items-center justify-center rounded-lg bg-white/10 ${textClass} font-semibold`}>
                {name.slice(0, 1).toUpperCase()}
            </div>
        )
    }

    return (
        <img
            src={`/assets/icons/${iconPath}`}
            alt=""
            className={`${sizeClass} rounded-lg bg-white/10 object-contain`}
            loading="lazy"
            onError={() => setHasError(true)}
        />
    )
}

export default AppIcon
