import { useTranslation } from 'react-i18next'
import { Shield, ShieldCheck } from 'lucide-react'

interface VpnModeToggleProps {
    enabled: boolean
    onToggle: () => void
}

/**
 * Floating button in the bottom-right corner. Visible regardless of
 * admin/guest state — it's a per-browser preference, not server config.
 */
export function VpnModeToggle({ enabled, onToggle }: VpnModeToggleProps) {
    const { t } = useTranslation('common')
    const Icon = enabled ? ShieldCheck : Shield
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const label = t('vpnCompatMode' as any) as string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateLabel = t((enabled ? 'vpnModeOn' : 'vpnModeOff') as any) as string

    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={enabled}
            aria-label={label}
            title={`${label} — ${stateLabel}`}
            className={
                'fixed bottom-4 right-4 z-30 flex items-center justify-center rounded-full p-2 backdrop-blur transition-colors ' +
                (enabled
                    ? 'border border-blue-400/60 bg-blue-400/10 text-blue-300 hover:bg-blue-400/20'
                    : 'border border-white/20 bg-black/40 text-white/40 hover:text-white/70')
            }
        >
            <Icon className="h-4 w-4" aria-hidden="true" />
        </button>
    )
}

export default VpnModeToggle
