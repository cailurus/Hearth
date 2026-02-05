import { useState, useCallback, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../ui'

interface LoginDialogProps {
    open: boolean
    onClose: () => void
    onLogin: (username: string, password: string) => Promise<void>
}

export function LoginDialog({ open, onClose, onLogin }: LoginDialogProps) {
    const { t } = useTranslation('common')

    const [username, setUsername] = useState('admin')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const handleSubmit = useCallback(
        async (e: FormEvent) => {
            e.preventDefault()
            if (!username || !password) return

            setError(null)
            setLoading(true)
            try {
                await onLogin(username, password)
                setPassword('')
                onClose()
            } catch (err) {
                setError(err instanceof Error ? err.message : t('loginFailed'))
            } finally {
                setLoading(false)
            }
        },
        [username, password, onLogin, onClose, t]
    )

    const handleClose = useCallback(() => {
        setError(null)
        setPassword('')
        onClose()
    }, [onClose])

    return (
        <Modal open={open} title={t('login')} onClose={handleClose} closeText={t('close')}>
            {error && (
                <div className="mb-3 rounded-lg border border-red-400/30 bg-red-900/20 p-3 text-sm text-red-300">
                    {error}
                </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-3">
                <label className="block text-sm">
                    <div className="mb-1 text-white/70">{t('username')}</div>
                    <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        autoComplete="username"
                    />
                </label>
                <label className="block text-sm">
                    <div className="mb-1 text-white/70">{t('password')}</div>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        autoComplete="current-password"
                    />
                </label>
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
                >
                    {loading ? t('loggingIn') : t('login')}
                </button>
            </form>
        </Modal>
    )
}

export default LoginDialog
