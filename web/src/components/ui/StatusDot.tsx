const colors: Record<string, string> = {
    up: 'bg-green-400',
    slow: 'bg-yellow-400',
    down: 'bg-red-400',
    unknown: 'bg-gray-400',
}

// Shadow glow colors for the breathing effect
const glowColors: Record<string, string> = {
    up: 'rgba(74,222,128,0.7)',
    slow: 'rgba(250,204,21,0.7)',
    down: 'rgba(248,113,113,0.7)',
    unknown: 'rgba(156,163,175,0.5)',
}

interface StatusDotProps {
    status: string
    className?: string
}

export function StatusDot({ status, className = '' }: StatusDotProps) {
    const glow = glowColors[status] || glowColors.unknown

    return (
        <span
            className={`inline-block h-2 w-2 rounded-full ${colors[status] || colors.unknown} ${className}`}
            style={{
                animation: 'statusBreath 2s ease-in-out infinite',
                boxShadow: `0 0 4px 1px ${glow}`,
            }}
            title={status}
        />
    )
}

// Inject the keyframes once
if (typeof document !== 'undefined' && !document.getElementById('status-breath-style')) {
    const style = document.createElement('style')
    style.id = 'status-breath-style'
    style.textContent = `
        @keyframes statusBreath {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(0.8); }
        }
    `
    document.head.appendChild(style)
}
