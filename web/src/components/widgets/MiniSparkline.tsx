/**
 * 迷你走势图组件
 */

interface MiniSparklineProps {
    series: number[]
}

export function MiniSparkline({ series }: MiniSparklineProps) {
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
        // Keep a bit of room for the x-axis.
        return (1 - t) * (height - 6) + 2
    }

    const step = width / (pts.length - 1)
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
