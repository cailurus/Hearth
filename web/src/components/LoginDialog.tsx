import { useState, type FormEvent } from 'react'
import { Modal, Button, Input } from './ui'

interface LoginDialogProps {
    open: boolean
    onClose: () => void
    onLogin: (username: string, password: string) => Promise<void>
    lang: 'zh' | 'en'
}

/**
 * 登录对话框组件
 */
export function LoginDialog({ open, onClose, onLogin, lang }: LoginDialogProps) {
    const [username, setUsername] = useState('admin')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        if (!username || !password) return

        setError(null)
        setLoading(true)

        try {
            await onLogin(username, password)
            setPassword('')
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : t('登录失败', 'Login failed'))
        } finally {
            setLoading(false)
        }
    }

    return (
        <Modal open={open} onClose={onClose} title={t('管理员登录', 'Admin Login')}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                    label={t('用户名', 'Username')}
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t('请输入用户名', 'Enter username')}
                    autoComplete="username"
                    autoFocus
                />

                <Input
                    label={t('密码', 'Password')}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('请输入密码', 'Enter password')}
                    autoComplete="current-password"
                />

                {error && (
                    <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                        {error}
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                    <Button type="button" variant="secondary" onClick={onClose}>
                        {t('取消', 'Cancel')}
                    </Button>
                    <Button type="submit" loading={loading}>
                        {t('登录', 'Login')}
                    </Button>
                </div>
            </form>
        </Modal>
    )
}

export default LoginDialog
