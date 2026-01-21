import type { ReactNode } from 'react'

export interface MainContainerProps {
    children: ReactNode
    error?: string | null
}

/**
 * Main content container with error display
 */
export function MainContainer({ children, error }: MainContainerProps) {
    return (
        <main className="mx-auto max-w-6xl px-4 pb-10 pt-[20vh] text-white">
            {error ? (
                <div className="rounded-lg border border-white/10 bg-black/40 p-4 text-sm text-white/80">
                    {error}
                </div>
            ) : null}
            <div className="space-y-6">{children}</div>
        </main>
    )
}

export default MainContainer
