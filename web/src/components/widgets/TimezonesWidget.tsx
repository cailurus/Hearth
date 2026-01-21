/**
 * 世界时钟组件
 */

import { useMemo } from 'react'
import { useNow } from '../../hooks/useNow'
import { cityShort, ianaCityLabel, tzDeltaMeta } from '../../utils/helpers'
import { AppleClock } from './AppleClock'
import type { WorldClockCity } from '../../utils/helpers'

interface TimezonesWidgetProps {
    localTimezone: string
    clocks: WorldClockCity[]
}

// CSS for hiding scrollbar while keeping scroll functionality
const scrollbarHideStyle = {
    scrollbarWidth: 'none' as const,       /* Firefox */
    msOverflowStyle: 'none' as const,      /* IE/Edge */
    WebkitOverflowScrolling: 'touch' as const, /* Smooth scroll on iOS */
}

export function TimezonesWidget({ localTimezone, clocks }: TimezonesWidgetProps) {
    const smoothNow = useNow(200)

    // Prefer user-configured city name; fall back to timezone-derived label only if city is empty.
    const labels = useMemo(() => {
        return clocks.map((c) => {
            const raw = String(c.city ?? '').trim()
            const short = cityShort(raw)
            if (short) return short
            if (raw) return raw
            // Fallback: extract city name from timezone (e.g., "Asia/Shanghai" → "Shanghai")
            return ianaCityLabel(String(c.timezone ?? '').trim()) || 'City'
        })
    }, [clocks])

    return (
        <div className="flex h-full w-full flex-col justify-start pt-1">
            {/* 
                Layout strategy:
                - lg+ (1024px+): Grid with 4 columns, clocks centered
                - Below lg: Horizontal scroll, each clock takes exactly 50% width so 2 fit perfectly
            */}
            
            {/* Desktop/Large tablet: Grid layout */}
            <div className="hidden lg:grid lg:grid-cols-4 lg:gap-4 lg:px-2">
                {clocks.map((c, idx) => {
                    const meta = tzDeltaMeta(smoothNow, localTimezone, c.timezone)
                    return (
                        <div 
                            key={`${c.timezone}-${idx}`} 
                            className="flex flex-col items-center text-center"
                        >
                            <AppleClock now={smoothNow} timezone={c.timezone} day={meta.isDay} />
                            <div className="mt-2 min-w-0 max-w-full">
                                <div className="truncate text-[12px] font-semibold leading-tight text-white/90">
                                    {labels[idx] || cityShort(c.city) || c.city}
                                </div>
                                <div className="text-[11px] leading-tight text-white/60">{meta.dayLabel}</div>
                                <div className="text-[11px] leading-tight text-white/60">{meta.offsetLabel}</div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Mobile/Small tablet: Horizontal scroll, 2 clocks visible at a time */}
            <div 
                className="lg:hidden overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
                style={scrollbarHideStyle}
            >
                <div className="flex">
                    {clocks.map((c, idx) => {
                        const meta = tzDeltaMeta(smoothNow, localTimezone, c.timezone)
                        return (
                            <div 
                                key={`${c.timezone}-${idx}`} 
                                className="flex flex-col items-center text-center shrink-0 w-1/2 snap-start px-2"
                            >
                                <AppleClock now={smoothNow} timezone={c.timezone} day={meta.isDay} />
                                <div className="mt-1.5 min-w-0 max-w-full">
                                    <div className="truncate text-[11px] font-semibold leading-tight text-white/90">
                                        {labels[idx] || cityShort(c.city) || c.city}
                                    </div>
                                    <div className="text-[10px] leading-tight text-white/60">{meta.dayLabel}</div>
                                    <div className="text-[10px] leading-tight text-white/60">{meta.offsetLabel}</div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

export default TimezonesWidget
