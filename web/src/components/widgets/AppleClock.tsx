/**
 * Apple 风格模拟时钟组件
 */

import { normalizeIanaTimeZone } from '../../utils/helpers'

interface AppleClockProps {
    now: number
    timezone: string
    day: boolean
}

export function AppleClock({ now, timezone, day }: AppleClockProps) {
    const d = new Date(now)
    const safeTz = normalizeIanaTimeZone(timezone, 'UTC')
    
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: safeTz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(d)
    
    const hh = Number(parts.find((p) => p.type === 'hour')?.value || '0')
    const mm = Number(parts.find((p) => p.type === 'minute')?.value || '0')
    const ss = Number(parts.find((p) => p.type === 'second')?.value || '0')

    const msFrac = d.getMilliseconds() / 1000

    const hourAngle = ((hh % 12) + mm / 60) * 30
    const minuteAngle = (mm + ss / 60) * 6
    const secondAngle = (ss + msFrac) * 6

    // Keep it consistent with the overall dark UI: day is just slightly brighter.
    const bg = day ? 'bg-white/10' : 'bg-black/70'
    const fg = 'text-white'

    const numbers: Array<{ n: number; x: number; y: number; big?: boolean }> = [
        { n: 12, x: 50, y: 13, big: true },
        { n: 1, x: 65, y: 17 },
        { n: 2, x: 76, y: 28 },
        { n: 3, x: 80, y: 50, big: true },
        { n: 4, x: 76, y: 72 },
        { n: 5, x: 65, y: 83 },
        { n: 6, x: 50, y: 87, big: true },
        { n: 7, x: 35, y: 83 },
        { n: 8, x: 24, y: 72 },
        { n: 9, x: 20, y: 50, big: true },
        { n: 10, x: 24, y: 28 },
        { n: 11, x: 35, y: 17 },
    ]

    return (
        <div className={`h-[72px] w-[72px] rounded-full ${bg} ${fg} shadow-sm shadow-black/30 ring-1 ${day ? 'ring-white/10' : 'ring-white/5'}`}>
            <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
                {numbers.map(({ n, x, y, big }) => (
                    <text
                        key={n}
                        x={x}
                        y={y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className={`fill-current ${big ? 'text-white' : 'text-white/70'}`}
                        style={{ fontSize: big ? 10 : 8, fontWeight: big ? 600 : 400 }}
                    >
                        {n}
                    </text>
                ))}

                {/* Hour hand */}
                <g transform={`rotate(${hourAngle} 50 50)`}>
                    <line x1="50" y1="50" x2="50" y2="28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-white" />
                </g>

                {/* Minute hand */}
                <g transform={`rotate(${minuteAngle} 50 50)`}>
                    <line x1="50" y1="50" x2="50" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/90" />
                </g>

                {/* Second hand */}
                <g transform={`rotate(${secondAngle} 50 50)`}>
                    <line x1="50" y1="55" x2="50" y2="18" stroke="currentColor" strokeWidth="1" strokeLinecap="round" className="text-red-400" />
                </g>

                {/* Center dot */}
                <circle cx="50" cy="50" r="3" fill="currentColor" className="text-white" />
            </svg>
        </div>
    )
}
