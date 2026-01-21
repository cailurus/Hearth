import type { ReactNode } from 'react'

export interface BackgroundProps {
    imageUrl: string
    children?: ReactNode
}

/**
 * Full-screen background image with blur and overlay
 */
export function Background({ imageUrl, children }: BackgroundProps) {
    return (
        <div className="relative min-h-screen">
            {/* Background layer */}
            <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
                <img src={imageUrl} alt="background" className="h-full w-full scale-105 object-cover blur-sm" />
                <div className="absolute inset-0 bg-black/60" />
            </div>
            {children}
        </div>
    )
}

export default Background
