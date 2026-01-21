/**
 * 系统设置对话框
 */

import { useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { TimezonePicker } from '../pickers/TimezonePicker'
import { apiPost } from '../../api'
import type { Settings } from '../../types'

type SettingsTab = 'general' | 'time' | 'background' | 'account'

// Use the same type as HomePage: Pick<Settings, 'siteTitle' | 'background' | 'time' | 'language'>
type SiteDraft = Pick<Settings, 'siteTitle' | 'background' | 'time' | 'language'>

interface SettingsDialogProps {
    open: boolean
    onClose: () => void
    lang: 'zh' | 'en'
    siteDraft: SiteDraft | null
    setSiteDraft: React.Dispatch<React.SetStateAction<SiteDraft | null>>
    schedulePersistSiteDraft: (draft: SiteDraft, timing: 'now' | 'debounce') => void
    siteSaveErr: string | null
    systemTimezone: string
    // Background
    bgRefreshing: boolean
    bgRefreshErr: string | null
    refreshBackground: () => void
    // Account
    onLogout: () => void
}

export function SettingsDialog({
    open,
    onClose,
    lang,
    siteDraft,
    setSiteDraft,
    schedulePersistSiteDraft,
    siteSaveErr,
    systemTimezone,
    bgRefreshing,
    bgRefreshErr,
    refreshBackground,
    onLogout,
}: SettingsDialogProps) {
    const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    // Password change state (managed internally)
    const [oldPassword, setOldPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [passwordErr, setPasswordErr] = useState<string | null>(null)
    const [passwordSuccess, setPasswordSuccess] = useState(false)
    const [changingPassword, setChangingPassword] = useState(false)

    const onChangePassword = async (e: FormEvent) => {
        e.preventDefault()
        setPasswordErr(null)
        setPasswordSuccess(false)

        if (!oldPassword || !newPassword || !confirmPassword) {
            setPasswordErr(lang === 'en' ? 'All fields are required' : '请填写所有字段')
            return
        }
        if (newPassword.length < 4) {
            setPasswordErr(lang === 'en' ? 'Password must be at least 4 characters' : '密码至少需要4个字符')
            return
        }
        if (newPassword !== confirmPassword) {
            setPasswordErr(lang === 'en' ? 'Passwords do not match' : '两次输入的密码不一致')
            return
        }

        setChangingPassword(true)
        try {
            await apiPost('/api/auth/password', { oldPassword, newPassword })
            setPasswordSuccess(true)
            setOldPassword('')
            setNewPassword('')
            setConfirmPassword('')
        } catch (err) {
            setPasswordErr(err instanceof Error ? err.message : (lang === 'en' ? 'Failed to change password' : '修改密码失败'))
        } finally {
            setChangingPassword(false)
        }
    }

    return (
        <Modal
            open={open}
            title={t('系统设置', 'Settings')}
            onClose={onClose}
            closeText={t('关闭', 'Close')}
            maxWidthClass="max-w-2xl"
            containerClassName="items-start pt-[12vh] sm:pt-[16vh]"
        >
            <div className="flex min-h-[400px]">
                {/* Left sidebar tabs */}
                <div className="flex w-32 flex-shrink-0 flex-col border-r border-white/10 pr-4">
                    <button
                        onClick={() => setSettingsTab('general')}
                        className={`mb-1 rounded-lg px-3 py-2 text-left text-sm transition-colors ${settingsTab === 'general' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/80'}`}
                    >
                        {t('通用', 'General')}
                    </button>
                    <button
                        onClick={() => setSettingsTab('time')}
                        className={`mb-1 rounded-lg px-3 py-2 text-left text-sm transition-colors ${settingsTab === 'time' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/80'}`}
                    >
                        {t('时间', 'Time')}
                    </button>
                    <button
                        onClick={() => setSettingsTab('background')}
                        className={`mb-1 rounded-lg px-3 py-2 text-left text-sm transition-colors ${settingsTab === 'background' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/80'}`}
                    >
                        {t('背景', 'Background')}
                    </button>
                    <button
                        onClick={() => setSettingsTab('account')}
                        className={`mb-1 rounded-lg px-3 py-2 text-left text-sm transition-colors ${settingsTab === 'account' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/80'}`}
                    >
                        {t('账户', 'Account')}
                    </button>
                </div>

                {/* Right content area */}
                <div className="flex-1 pl-4">
                    {siteSaveErr ? <div className="mb-4 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">{siteSaveErr}</div> : null}

                    {/* General Tab */}
                    {settingsTab === 'general' && (
                        <div className="space-y-4">
                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('标题', 'Title')}</div>
                                <input
                                    value={siteDraft?.siteTitle ?? ''}
                                    onChange={(e) =>
                                        setSiteDraft((prev) => {
                                            if (!prev) return prev
                                            const next = { ...prev, siteTitle: e.target.value }
                                            schedulePersistSiteDraft(next, 'debounce')
                                            return next
                                        })
                                    }
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                />
                            </label>

                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('语言', 'Language')}</div>
                                <select
                                    value={siteDraft?.language || 'zh'}
                                    onChange={(e) =>
                                        setSiteDraft((prev) => {
                                            if (!prev) return prev
                                            const next = { ...prev, language: e.target.value }
                                            schedulePersistSiteDraft(next, 'now')
                                            return next
                                        })
                                    }
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                >
                                    <option value="zh">{t('中文', 'Chinese')}</option>
                                    <option value="en">{t('英文', 'English')}</option>
                                </select>
                            </label>
                        </div>
                    )}

                    {/* Time Tab */}
                    {settingsTab === 'time' && (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-4">
                                <label className="flex items-center gap-2 text-sm text-white/80">
                                    <input
                                        type="checkbox"
                                        checked={!!siteDraft?.time?.enabled}
                                        onChange={(e) =>
                                            setSiteDraft((prev) => {
                                                if (!prev) return prev
                                                const next = {
                                                    ...prev,
                                                    time: {
                                                        enabled: e.target.checked,
                                                        timezone: systemTimezone,
                                                        showSeconds: prev.time?.showSeconds ?? true,
                                                        mode: 'digital',
                                                    },
                                                }
                                                schedulePersistSiteDraft(next, 'now')
                                                return next
                                            })
                                        }
                                    />
                                    {t('显示日期与时间', 'Show date & time')}
                                </label>

                                <label className={`flex items-center gap-2 text-sm ${siteDraft?.time?.enabled ? 'text-white/80' : 'text-white/40'}`}>
                                    <input
                                        type="checkbox"
                                        disabled={!siteDraft?.time?.enabled}
                                        checked={siteDraft?.time?.showSeconds ?? true}
                                        onChange={(e) =>
                                            setSiteDraft((prev) => {
                                                if (!prev) return prev
                                                const next = {
                                                    ...prev,
                                                    time: {
                                                        enabled: prev.time?.enabled ?? false,
                                                        timezone: systemTimezone,
                                                        showSeconds: e.target.checked,
                                                        mode: 'digital',
                                                    },
                                                }
                                                schedulePersistSiteDraft(next, 'now')
                                                return next
                                            })
                                        }
                                    />
                                    {t('显示秒', 'Show seconds')}
                                </label>
                            </div>

                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('当前时区', 'Current timezone')}</div>
                                <TimezonePicker
                                    value={systemTimezone}
                                    onChange={() => {
                                        // Read-only: timezone is taken from the user's system/browser.
                                    }}
                                    options={[systemTimezone]}
                                    placeholder={systemTimezone}
                                />
                                <div className="mt-1 text-xs text-white/50">{t('自动从系统读取', 'Auto from system')}</div>
                            </label>
                        </div>
                    )}

                    {/* Background Tab */}
                    {settingsTab === 'background' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="block text-sm">
                                    <div className="mb-1 text-white/70">{t('背景来源', 'Provider')}</div>
                                    <select
                                        value={siteDraft?.background.provider ?? 'default'}
                                        onChange={(e) =>
                                            setSiteDraft((prev) => {
                                                if (!prev) return prev
                                                const next = {
                                                    ...prev,
                                                    background: {
                                                        ...prev.background,
                                                        provider: e.target.value,
                                                        interval:
                                                            e.target.value === 'bing_daily'
                                                                ? '24h'
                                                                : e.target.value === 'default'
                                                                    ? '0'
                                                                    : prev.background.interval,
                                                    },
                                                }
                                                schedulePersistSiteDraft(next, 'now')
                                                return next
                                            })
                                        }
                                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                    >
                                        <option value="default">{t('系统默认', 'Default')}</option>
                                        <option value="bing_random">Bing Random</option>
                                        <option value="bing_daily">Bing Daily</option>
                                        <option value="picsum">Picsum</option>
                                    </select>
                                </label>

                                {siteDraft?.background.provider === 'bing_daily' || siteDraft?.background.provider === 'default' ? null : (
                                    <label className="block text-sm">
                                        <div className="mb-1 text-white/70">{t('更新间隔', 'Refresh interval')}</div>
                                        <select
                                            value={siteDraft?.background.interval ?? '0'}
                                            onChange={(e) =>
                                                setSiteDraft((prev) => {
                                                    if (!prev) return prev
                                                    const next = { ...prev, background: { ...prev.background, interval: e.target.value } }
                                                    schedulePersistSiteDraft(next, 'now')
                                                    return next
                                                })
                                            }
                                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                        >
                                            <option value="0">{t('手动', 'Manual')}</option>
                                            <option value="1h">{t('1小时', '1 hour')}</option>
                                            <option value="3h">{t('3小时', '3 hours')}</option>
                                            <option value="6h">{t('6小时', '6 hours')}</option>
                                            <option value="12h">{t('12小时', '12 hours')}</option>
                                            <option value="24h">{t('每日', 'Daily')}</option>
                                        </select>
                                    </label>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={refreshBackground}
                                    disabled={bgRefreshing}
                                    className="inline-flex items-center rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-60"
                                >
                                    {t('更新', 'Refresh')}
                                </button>
                                {bgRefreshing ? <Spinner /> : null}
                                {bgRefreshErr ? (
                                    <span
                                        title={bgRefreshErr}
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-400/60 text-[12px] font-semibold leading-none text-red-400"
                                    >
                                        i
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    )}

                    {/* Account Tab */}
                    {settingsTab === 'account' && (
                        <div className="space-y-6">
                            {/* Logout section */}
                            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3">
                                <div className="text-sm text-white/70">{t('当前登录', 'Logged in as')} <span className="text-white">admin</span></div>
                                <button
                                    onClick={onLogout}
                                    className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
                                >
                                    {t('登出', 'Logout')}
                                </button>
                            </div>

                            {/* Password Change Section */}
                            <div>
                                <div className="mb-3 text-sm font-semibold text-white/80">{t('修改密码', 'Change Password')}</div>
                                {passwordErr ? (
                                    <div className="mb-3 rounded-lg border border-red-400/30 bg-red-900/20 p-2 text-sm text-red-300">{passwordErr}</div>
                                ) : null}
                                {passwordSuccess ? (
                                    <div className="mb-3 rounded-lg border border-green-400/30 bg-green-900/20 p-2 text-sm text-green-300">
                                        {t('密码已更新', 'Password updated successfully')}
                                    </div>
                                ) : null}
                                <form onSubmit={onChangePassword} className="space-y-3">
                                    <label className="block text-sm">
                                        <div className="mb-1 text-white/70">{t('当前密码', 'Current password')}</div>
                                        <input
                                            type="password"
                                            value={oldPassword}
                                            onChange={(e) => setOldPassword(e.target.value)}
                                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                        />
                                    </label>
                                    <label className="block text-sm">
                                        <div className="mb-1 text-white/70">{t('新密码', 'New password')}</div>
                                        <input
                                            type="password"
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                        />
                                    </label>
                                    <label className="block text-sm">
                                        <div className="mb-1 text-white/70">{t('确认新密码', 'Confirm new password')}</div>
                                        <input
                                            type="password"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                        />
                                    </label>
                                    <button
                                        type="submit"
                                        disabled={changingPassword}
                                        className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
                                    >
                                        {changingPassword ? (t('更新中...', 'Updating...')) : (t('更新密码', 'Update password'))}
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    )
}

export default SettingsDialog
