import { useTranslation } from 'react-i18next'

interface DockerBadgeProps {
    className?: string
}

/**
 * Small Docker-whale glyph overlay used to mark app cards that came
 * from a container's hearth.* / homepage.* labels rather than from a
 * user's manual entry. Inline SVG (no external icon dep) so it
 * inherits text color and ships in the main bundle without a network
 * round-trip. The path approximates Docker's whale logo at 8×8 — it's
 * a hint, not a brand mark.
 */
export function DockerBadge({ className = '' }: DockerBadgeProps) {
    const { t } = useTranslation('common')
    return (
        <span
            className={`inline-flex items-center justify-center rounded-sm bg-blue-500/80 text-white shadow-sm ${className}`}
            style={{ width: 12, height: 12 }}
            title={t('dockerDiscovered')}
            aria-label={t('dockerDiscovered')}
        >
            <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true">
                <path d="M21.4 9.6c-.6-.4-1.4-.6-2.1-.5l-.1-.6a1.5 1.5 0 0 0-1-1.2 1.5 1.5 0 0 0-1.6.4l-.4.4-.4-.4a1.5 1.5 0 0 0-2 .1l-.5.5-.4-.4a1.5 1.5 0 0 0-2 .1l-.5.5-.4-.4a1.5 1.5 0 0 0-2 .1l-.5.5-.4-.4a1.5 1.5 0 0 0-2 .1l-.5.5h-.6a1.5 1.5 0 0 0-1.5 1.5v.5c0 3.3 2.7 6 6 6h7c2.5 0 4.7-1.5 5.6-3.8.5 0 1-.1 1.4-.4.5-.3.8-.7 1-1.2.1-.4 0-.9-.1-1.3z"/>
            </svg>
        </span>
    )
}

export default DockerBadge
