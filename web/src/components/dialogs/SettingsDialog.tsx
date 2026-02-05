/**
 * 系统设置对话框
 */

import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
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
    const { t } = useTranslation(['settings', 'common'])
    const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')

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
            setPasswordErr(t('settings:passwordRequired'))
            return
        }
        if (newPassword.length < 4) {
            setPasswordErr(t('settings:passwordTooShort'))
            return
        }
        if (newPassword !== confirmPassword) {
            setPasswordErr(t('settings:passwordMismatch'))
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
            setPasswordErr(err instanceof Error ? err.message : t('settings:passwordChangeFailed'))
        } finally {
            setChangingPassword(false)
        }
    }

    return (
        <Modal
            open={open}
            title={t('settings:title')}
            onClose={onClose}
            closeText={t('common:close')}
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
                        {t('settings:general')}
                    </button>
                    <button
                        onClick={() => setSettingsTab('time')}
                        className={`mb-1 rounded-lg px-3 py-2 text-left text-sm transition-colors ${settingsTab === 'time' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/80'}`}
                    >
                        {t('settings:time')}
                    </button>
                    <button
                        onClick={() => setSettingsTab('background')}
                        className={`mb-1 rounded-lg px-3 py-2 text-left text-sm transition-colors ${settingsTab === 'background' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/80'}`}
                    >
                        {t('settings:background')}
                    </button>
                    <button
                        onClick={() => setSettingsTab('account')}
                        className={`mb-1 rounded-lg px-3 py-2 text-left text-sm transition-colors ${settingsTab === 'account' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/80'}`}
                    >
                        {t('settings:account')}
                    </button>
                </div>

                {/* Right content area */}
                <div className="flex-1 pl-4">
                    {siteSaveErr ? <div className="mb-4 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">{siteSaveErr}</div> : null}

                    {/* General Tab */}
                    {settingsTab === 'general' && (
                        <div className="space-y-4">
                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('settings:siteTitle')}</div>
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
                                <div className="mb-1 text-white/70">{t('settings:language')}</div>
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
                                    <option value="zh">{t('settings:languageChinese')}</option>
                                    <option value="en">{t('settings:languageEnglish')}</option>
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
                                    {t('settings:showDateTime')}
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
                                    {t('settings:showSeconds')}
                                </label>
                            </div>

                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('settings:currentTimezone')}</div>
                                <TimezonePicker
                                    value={systemTimezone}
                                    onChange={() => {
                                        // Read-only: timezone is taken from the user's system/browser.
                                    }}
                                    options={[systemTimezone]}
                                    placeholder={systemTimezone}
                                />
                                <div className="mt-1 text-xs text-white/50">{t('settings:timezoneAutoHint')}</div>
                            </label>
                        </div>
                    )}

                    {/* Background Tab */}
                    {settingsTab === 'background' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="block text-sm">
                                    <div className="mb-1 text-white/70">{t('settings:bgProvider')}</div>
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
                                                                : e.target.value === 'default' || e.target.value === 'default_video'
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
                                        <option value="default">{t('settings:bgDefault')}</option>
                                        <option value="default_video">{t('settings:bgDefaultVideo')}</option>
                                        <option value="bing_random">Bing Random</option>
                                        <option value="bing_daily">Bing Daily</option>
                                        <option value="picsum">Picsum</option>
                                    </select>
                                </label>

                                {siteDraft?.background.provider === 'bing_daily' || siteDraft?.background.provider === 'default' || siteDraft?.background.provider === 'default_video' ? null : (
                                    <label className="block text-sm">
                                        <div className="mb-1 text-white/70">{t('settings:bgRefreshInterval')}</div>
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
                                            <option value="0">{t('settings:bgManual')}</option>
                                            <option value="1h">{t('settings:bgHour1')}</option>
                                            <option value="3h">{t('settings:bgHours3')}</option>
                                            <option value="6h">{t('settings:bgHours6')}</option>
                                            <option value="12h">{t('settings:bgHours12')}</option>
                                            <option value="24h">{t('settings:bgDaily')}</option>
                                        </select>
                                    </label>
                                )}

                                <label className="block text-sm">
                                    <div className="mb-1 text-white/70">{t('settings:bgBlur')}</div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={siteDraft?.background?.blur ?? (siteDraft?.background?.provider === 'default_video' ? 0 : 3)}
                                            onChange={(e) =>
                                                setSiteDraft((prev) => {
                                                    if (!prev) return prev
                                                    const next = { ...prev, background: { ...prev.background, blur: parseInt(e.target.value, 10) } }
                                                    schedulePersistSiteDraft(next, 'debounce')
                                                    return next
                                                })
                                            }
                                            className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
                                        />
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={siteDraft?.background?.blur ?? (siteDraft?.background?.provider === 'default_video' ? 0 : 3)}
                                            onChange={(e) =>
                                                setSiteDraft((prev) => {
                                                    if (!prev) return prev
                                                    const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0))
                                                    const next = { ...prev, background: { ...prev.background, blur: val } }
                                                    schedulePersistSiteDraft(next, 'debounce')
                                                    return next
                                                })
                                            }
                                            className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white text-center outline-none"
                                        />
                                    </div>
                                </label>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={refreshBackground}
                                    disabled={bgRefreshing}
                                    className="inline-flex items-center rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-60"
                                >
                                    {t('settings:bgRefresh')}
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
                                <div className="text-sm text-white/70">{t('settings:loggedInAs')} <span className="text-white">admin</span></div>
                                <button
                                    onClick={onLogout}
                                    className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
                                >
                                    {t('common:logout')}
                                </button>
                            </div>

                            {/* Password Change Section */}
                            <div>
                                <div className="mb-3 text-sm font-semibold text-white/80">{t('settings:changePassword')}</div>
                                {passwordErr ? (
                                    <div className="mb-3 rounded-lg border border-red-400/30 bg-red-900/20 p-2 text-sm text-red-300">{passwordErr}</div>
                                ) : null}
                                {passwordSuccess ? (
                                    <div className="mb-3 rounded-lg border border-green-400/30 bg-green-900/20 p-2 text-sm text-green-300">
                                        {t('settings:passwordUpdated')}
                                    </div>
                                ) : null}
                                <form onSubmit={onChangePassword} className="space-y-3">
                                    <label className="block text-sm">
                                        <div className="mb-1 text-white/70">{t('settings:currentPassword')}</div>
                                        <input
                                            type="password"
                                            value={oldPassword}
                                            onChange={(e) => setOldPassword(e.target.value)}
                                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                        />
                                    </label>
                                    <label className="block text-sm">
                                        <div className="mb-1 text-white/70">{t('settings:newPassword')}</div>
                                        <input
                                            type="password"
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                        />
                                    </label>
                                    <label className="block text-sm">
                                        <div className="mb-1 text-white/70">{t('settings:confirmNewPassword')}</div>
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
                                        {changingPassword ? t('settings:updatingPassword') : t('settings:updatePassword')}
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
