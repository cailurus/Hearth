/**
 * usePrefersReducedMotion — subscribes to `prefers-reduced-motion: reduce`.
 *
 * Use this in any component that renders ongoing motion (canvas particles,
 * looping animations, parallax, etc.) and bail out early when the user has
 * asked their OS to dial things back. CSS-driven hover/fade transitions are
 * additionally squashed via the global rule in `index.css`, so pages still
 * function — they just stop animating.
 */

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export function usePrefersReducedMotion(): boolean {
    const [reduce, setReduce] = useState<boolean>(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return false
        return window.matchMedia(QUERY).matches
    })

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return
        const mql = window.matchMedia(QUERY)
        const handler = (e: MediaQueryListEvent) => setReduce(e.matches)
        mql.addEventListener('change', handler)
        return () => mql.removeEventListener('change', handler)
    }, [])

    return reduce
}

export default usePrefersReducedMotion
