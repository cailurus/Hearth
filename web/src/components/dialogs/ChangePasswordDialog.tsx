import { useCallback, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../ui'
import { apiPost } from '../../api'

interface ChangePasswordDialogProps {
    open: boolean
    /** When true, the dialog cannot be dismissed (no close button, Esc / backdrop ignored). */
    forced: boolean
    /** Called after a successful change so the parent can refresh /api/auth/me. */
    onSuccess: () => void | Promise<void>
    /** Required when forced is false. */
    onClose?: () => void
}

const noop = () => {}

export function ChangePasswordDialog({ open, forced, onSuccess, onClose }: ChangePasswordDialogProps) {
    const { t } = useTranslation(['common', 'settings'])

    const [oldPassword, setOldPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    const reset = useCallback(() => {
        setOldPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setError(null)
    }, [])

    const handleSubmit = useCallback(
        async (e: FormEvent) => {
            e.preventDefault()
            setError(null)

            if (!oldPassword || !newPassword || !confirmPassword) {
                setError(t('settings:passwordRequired'))
                return
            }
            if (newPassword.length < 8) {
                setError(t('common:passwordTooShortStrict'))
                return
            }
            if (newPassword === oldPassword) {
                setError(t('common:passwordSameAsOld'))
                return
            }
            if (newPassword !== confirmPassword) {
                setError(t('settings:passwordMismatch'))
                return
            }

            setSubmitting(true)
            try {
                await apiPost('/api/auth/password', { oldPassword, newPassword })
                reset()
                await onSuccess()
            } catch (err) {
                setError(err instanceof Error ? err.message : t('settings:passwordChangeFailed'))
            } finally {
                setSubmitting(false)
            }
        },
        [oldPassword, newPassword, confirmPassword, onSuccess, reset, t]
    )

    const handleClose = useCallback(() => {
        if (forced) return
        reset()
        onClose?.()
    }, [forced, onClose, reset])

    return (
        <Modal
            open={open}
            onClose={forced ? noop : handleClose}
            title={forced ? t('common:firstRunTitle') : t('settings:changePassword')}
            closeText={t('common:close')}
            showCloseButton={!forced}
        >
            {forced && (
                <div className="mb-3 rounded-lg border border-amber-400/30 bg-amber-900/15 p-3 text-sm text-amber-100">
                    {t('common:firstRunHint')}
                </div>
            )}
            {error && (
                <div className="mb-3 rounded-lg border border-red-400/30 bg-red-900/20 p-3 text-sm text-red-300">
                    {error}
                </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-3">
                <label className="block text-sm">
                    <div className="mb-1 text-white/70">{t('settings:currentPassword')}</div>
                    <input
                        type="password"
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        autoComplete="current-password"
                        autoFocus
                    />
                </label>
                <label className="block text-sm">
                    <div className="mb-1 text-white/70">{t('settings:newPassword')}</div>
                    <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        autoComplete="new-password"
                    />
                </label>
                <label className="block text-sm">
                    <div className="mb-1 text-white/70">{t('settings:confirmNewPassword')}</div>
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        autoComplete="new-password"
                    />
                </label>
                <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
                >
                    {submitting ? t('settings:updatingPassword') : t('settings:updatePassword')}
                </button>
            </form>
        </Modal>
    )
}

export default ChangePasswordDialog
