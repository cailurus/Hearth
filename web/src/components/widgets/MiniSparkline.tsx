/**
 * 迷你走势图组件
 *
 * totalSlots: if provided, the X axis represents this many slots total,
 * but only series.length points are drawn. The line occupies a portion
 * of the chart width, with the rest empty (for in-progress trading days).
 */

interface MiniSparklineProps {
    series: number[]
    totalSlots?: number
}

export function MiniSparkline({ series, totalSlots }: MiniSparklineProps) {
    const pts = Array.isArray(series) ? series.filter((n) => Number.isFinite(n)) : []

    if (pts.length < 2) {
        return <div className="h-6 w-full rounded bg-white/5" />
    }

    const width = 120
    const height = 24
    const min = Math.min(...pts)
    const max = Math.max(...pts)
    const span = max - min

    const yOf = (v: number) => {
        if (!Number.isFinite(v)) return height / 2
        if (span <= 0) return height / 2
        const t = (v - min) / span
        return (1 - t) * (height - 6) + 2
    }

    // If totalSlots is set and larger than pts.length, the line only
    // occupies a portion of the chart width (partial trading day).
    const slots = totalSlots && totalSlots > pts.length ? totalSlots : pts.length
    const step = width / Math.max(slots - 1, 1)
    const d = pts.map((v, i) => `${(i * step).toFixed(2)},${yOf(v).toFixed(2)}`).join(' ')

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-6 w-full" aria-hidden="true">
            <g className="text-white/20">
                <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="currentColor" strokeWidth="1" />
                <line x1="0" y1={height - 4} x2="0" y2={height - 1} stroke="currentColor" strokeWidth="1" />
                <line x1={width / 2} y1={height - 4} x2={width / 2} y2={height - 1} stroke="currentColor" strokeWidth="1" />
                <line x1={width} y1={height - 4} x2={width} y2={height - 1} stroke="currentColor" strokeWidth="1" />
            </g>
            <g className="text-white/65">
                <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            </g>
        </svg>
    )
}
