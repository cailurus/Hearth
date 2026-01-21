/**
 * 天气图标组件
 */

import { weatherKind } from '../../utils/weather'

interface WeatherGlyphProps {
    code: number
    windKph: number
    size?: number
}

export function WeatherGlyph({ code, windKph, size = 40 }: WeatherGlyphProps) {
    const kind = weatherKind(code)

    if (kind === 'sun') {
        return (
            <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" className="text-white" />
                <g className="animate-pulse text-white/90">
                    <path d="M12 2v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M12 19v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M2 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M4.2 4.2l2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M17.7 17.7l2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M19.8 4.2l-2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M6.3 17.7l-2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </g>
            </svg>
        )
    }

    if (kind === 'rain') {
        return (
            <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.8 1.3A3.5 3.5 0 0 1 17.5 16H7Z" stroke="currentColor" strokeWidth="2" className="text-white" />
                <g className="text-white/90">
                    <path d="M9 18l-1 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-bounce" />
                    <path d="M13 18l-1 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-bounce" style={{ animationDelay: '120ms' }} />
                    <path d="M17 18l-1 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-bounce" style={{ animationDelay: '240ms' }} />
                </g>
            </svg>
        )
    }

    if (kind === 'snow') {
        return (
            <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.8 1.3A3.5 3.5 0 0 1 17.5 16H7Z" stroke="currentColor" strokeWidth="2" className="text-white" />
                <g className="text-white/90 animate-pulse">
                    <circle cx="9" cy="19" r="1" fill="currentColor" />
                    <circle cx="13" cy="19" r="1" fill="currentColor" />
                    <circle cx="17" cy="19" r="1" fill="currentColor" />
                </g>
            </svg>
        )
    }

    if (kind === 'storm') {
        return (
            <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.8 1.3A3.5 3.5 0 0 1 17.5 16H7Z" stroke="currentColor" strokeWidth="2" className="text-white" />
                <path d="M13 16l-2 4h2l-1 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white animate-pulse" />
            </svg>
        )
    }

    if (kind === 'fog') {
        return (
            <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/90" />
                <path d="M6 16h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/70" />
                <path d="M8 20h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/60" />
            </svg>
        )
    }

    // clouds / default
    return (
        <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.8 1.3A3.5 3.5 0 0 1 17.5 16H7Z" stroke="currentColor" strokeWidth="2" className="text-white" />
            {windKph >= 18 ? (
                <path d="M5 19h9c2 0 2-2 0-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/80 animate-pulse" />
            ) : null}
        </svg>
    )
}
