import { useMemo, useRef, useState, useCallback } from 'react'
import type { MetricsHistoryPoint } from '../../types'
import { formatBytesPerSec } from '../../utils'

type MetricKey = 'cpu' | 'mem' | 'disk' | 'net'
type Period = '1h' | '6h' | '24h' | '7d'

interface MetricsChartProps {
    points: MetricsHistoryPoint[]
    metric: MetricKey
    period: Period
    lang: 'zh' | 'en'
}

const W = 480
const H = 200
const PAD = { top: 16, right: 12, bottom: 28, left: 52 }
const CHART_W = W - PAD.left - PAD.right
const CHART_H = H - PAD.top - PAD.bottom

function formatTimeLabel(ts: number, period: Period): string {
    const d = new Date(ts)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    if (period === '7d') {
        return `${d.getMonth() + 1}/${d.getDate()}`
    }
    return `${hh}:${mm}`
}

function pctLabel(v: number): string {
    return `${Math.round(v)}%`
}

export function MetricsChart({ points, metric, period, lang }: MetricsChartProps) {
    const svgRef = useRef<SVGSVGElement>(null)
    const [hoverIdx, setHoverIdx] = useState<number | null>(null)

    const isNet = metric === 'net'

    // Extract series data
    const { series, series2, yMax, yLabels, formatY } = useMemo(() => {
        if (points.length === 0) {
            return { series: [] as number[], series2: undefined, yMax: 100, yLabels: [] as number[], formatY: pctLabel }
        }

        if (isNet) {
            const send = points.map((p) => p.netSendRate)
            const recv = points.map((p) => p.netRecvRate)
            const maxVal = Math.max(...send, ...recv, 1)
            // Nice Y axis: round up to a nice number
            const niceMax = niceRound(maxVal)
            const labels = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax]
            return {
                series: send,
                series2: recv,
                yMax: niceMax,
                yLabels: labels,
                formatY: (v: number) => formatBytesPerSec(v),
            }
        }

        const key = metric === 'cpu' ? 'cpuPercent' : metric === 'mem' ? 'memPercent' : 'diskPercent'
        const vals = points.map((p) => p[key])
        return {
            series: vals,
            series2: undefined,
            yMax: 100,
            yLabels: [0, 25, 50, 75, 100],
            formatY: pctLabel,
        }
    }, [points, metric, isNet])

    // X/Y transform
    const xOf = useCallback(
        (i: number) => {
            if (series.length <= 1) return PAD.left + CHART_W / 2
            return PAD.left + (i / (series.length - 1)) * CHART_W
        },
        [series.length],
    )
    const yOf = useCallback(
        (v: number) => {
            if (yMax <= 0) return PAD.top + CHART_H
            const t = Math.min(v / yMax, 1)
            return PAD.top + (1 - t) * CHART_H
        },
        [yMax],
    )

    // Build polyline points string
    const polyline = useMemo(() => {
        if (series.length < 2) return ''
        return series.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
    }, [series, xOf, yOf])

    const polyline2 = useMemo(() => {
        if (!series2 || series2.length < 2) return ''
        return series2.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
    }, [series2, xOf, yOf])

    // X-axis time labels (4-5 evenly spaced)
    const timeLabels = useMemo(() => {
        if (points.length < 2) return []
        const count = period === '7d' ? 7 : 4
        const labels: { x: number; text: string }[] = []
        for (let i = 0; i <= count; i++) {
            const idx = Math.round((i / count) * (points.length - 1))
            labels.push({ x: xOf(idx), text: formatTimeLabel(points[idx].ts, period) })
        }
        return labels
    }, [points, period, xOf])

    // Hover handling
    const handleMouseMove = useCallback(
        (e: React.MouseEvent<SVGSVGElement>) => {
            if (series.length < 2 || !svgRef.current) return
            const rect = svgRef.current.getBoundingClientRect()
            const mouseX = ((e.clientX - rect.left) / rect.width) * W
            const relX = mouseX - PAD.left
            const idx = Math.round((relX / CHART_W) * (series.length - 1))
            if (idx >= 0 && idx < series.length) {
                setHoverIdx(idx)
            }
        },
        [series.length],
    )

    const handleMouseLeave = useCallback(() => setHoverIdx(null), [])

    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    if (points.length < 2) {
        return (
            <div className="flex h-[160px] items-center justify-center text-sm text-white/40">
                {t('暂无历史数据', 'No historical data yet')}
            </div>
        )
    }

    return (
        <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            style={{ height: 'auto', maxHeight: 200 }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            {/* Grid lines */}
            {yLabels.map((v, i) => {
                const y = yOf(v)
                return (
                    <g key={i}>
                        <line
                            x1={PAD.left}
                            y1={y}
                            x2={PAD.left + CHART_W}
                            y2={y}
                            stroke="rgba(255,255,255,0.08)"
                            strokeWidth="1"
                        />
                        <text
                            x={PAD.left - 6}
                            y={y + 3}
                            textAnchor="end"
                            fill="rgba(255,255,255,0.35)"
                            fontSize="9"
                        >
                            {formatY(v)}
                        </text>
                    </g>
                )
            })}

            {/* X-axis labels */}
            {timeLabels.map((l, i) => (
                <text
                    key={i}
                    x={l.x}
                    y={H - 6}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.35)"
                    fontSize="9"
                >
                    {l.text}
                </text>
            ))}

            {/* Data lines */}
            {polyline && (
                <polyline
                    points={polyline}
                    fill="none"
                    stroke={isNet ? 'rgba(96,165,250,0.8)' : 'rgba(255,255,255,0.65)'}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
            )}
            {polyline2 && (
                <polyline
                    points={polyline2}
                    fill="none"
                    stroke="rgba(74,222,128,0.8)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
            )}

            {/* Hover indicator */}
            {hoverIdx !== null && hoverIdx < series.length && (
                <>
                    <line
                        x1={xOf(hoverIdx)}
                        y1={PAD.top}
                        x2={xOf(hoverIdx)}
                        y2={PAD.top + CHART_H}
                        stroke="rgba(255,255,255,0.3)"
                        strokeWidth="1"
                        strokeDasharray="3,3"
                    />
                    {/* Tooltip */}
                    <HoverTooltip
                        x={xOf(hoverIdx)}
                        point={points[hoverIdx]}
                        metric={metric}
                        isNet={isNet}
                        series2Val={series2?.[hoverIdx]}
                        seriesVal={series[hoverIdx]}
                        formatY={formatY}
                        period={period}
                        lang={lang}
                    />
                </>
            )}

            {/* Net legend */}
            {isNet && (
                <g>
                    <line x1={PAD.left} y1={8} x2={PAD.left + 16} y2={8} stroke="rgba(96,165,250,0.8)" strokeWidth="2" />
                    <text x={PAD.left + 20} y={11} fill="rgba(255,255,255,0.5)" fontSize="9">
                        {t('上传', 'Upload')}
                    </text>
                    <line x1={PAD.left + 56} y1={8} x2={PAD.left + 72} y2={8} stroke="rgba(74,222,128,0.8)" strokeWidth="2" />
                    <text x={PAD.left + 76} y={11} fill="rgba(255,255,255,0.5)" fontSize="9">
                        {t('下载', 'Download')}
                    </text>
                </g>
            )}
        </svg>
    )
}

function HoverTooltip({
    x,
    point,
    metric,
    isNet,
    seriesVal,
    series2Val,
    formatY,
    period,
}: {
    x: number
    point: MetricsHistoryPoint
    metric: MetricKey
    isNet: boolean
    seriesVal: number
    series2Val?: number
    formatY: (v: number) => string
    period: Period
    lang: 'zh' | 'en'
}) {
    const time = formatTimeLabel(point.ts, period)
    const label = isNet
        ? `↑${formatBytesPerSec(seriesVal)} ↓${formatBytesPerSec(series2Val ?? 0)}`
        : formatY(seriesVal)

    // Position tooltip to avoid going off-screen
    const anchor = x > W / 2 ? 'end' : 'start'
    const tx = x > W / 2 ? x - 6 : x + 6

    return (
        <g>
            <text x={tx} y={PAD.top - 2} textAnchor={anchor} fill="rgba(255,255,255,0.7)" fontSize="10" fontWeight="500">
                {time} {label}
            </text>
            {/* Dot on line */}
            <circle cx={x} cy={0} r="0" fill="none" />
        </g>
    )
}

function niceRound(v: number): number {
    if (v <= 0) return 1
    const mag = Math.pow(10, Math.floor(Math.log10(v)))
    const norm = v / mag
    if (norm <= 1) return mag
    if (norm <= 2) return 2 * mag
    if (norm <= 5) return 5 * mag
    return 10 * mag
}
