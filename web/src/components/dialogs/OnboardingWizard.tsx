import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../ui'
import type { BackgroundProvider, Settings } from '../../types'

interface CreateAppData {
    groupId: string | null
    name: string
    description: string | null
    url: string
    iconPath: string | null
    iconSource: string | null
}

interface OnboardingWizardProps {
    open: boolean
    settings: Settings | null
    onSaveSettings: (s: Settings) => Promise<void>
    onCreateApp: (data: CreateAppData) => Promise<void>
    onClose: () => void
}

const STEPS = ['language', 'background', 'firstApp', 'weatherCity'] as const
type Step = typeof STEPS[number]

export function OnboardingWizard({
    open,
    settings,
    onSaveSettings,
    onCreateApp,
    onClose,
}: OnboardingWizardProps) {
    const { t } = useTranslation(['common'])

    const [stepIdx, setStepIdx] = useState(0)
    const step: Step = STEPS[stepIdx]

    // Per-step draft state, hydrated from current settings.
    const [language, setLanguage] = useState<'zh' | 'en'>(
        settings?.language === 'en' ? 'en' : 'zh'
    )
    const [bgProvider, setBgProvider] = useState<BackgroundProvider>(
        settings?.background?.provider || 'default'
    )
    const [appName, setAppName] = useState('')
    const [appUrl, setAppUrl] = useState('')
    const [weatherCity, setWeatherCity] = useState(settings?.weather?.city || '')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Settings may load asynchronously; keep drafts in sync until the user
    // edits them. After the first save the user has explicit intent — don't
    // clobber it from props.
    useEffect(() => {
        if (!settings) return
        setLanguage((prev) => (prev === settings.language ? prev : settings.language === 'en' ? 'en' : 'zh'))
        setBgProvider((prev) => (prev === settings.background?.provider ? prev : settings.background?.provider || 'default'))
        setWeatherCity((prev) => (prev ? prev : settings.weather?.city || ''))
    }, [settings])

    const isLast = stepIdx === STEPS.length - 1

    const advance = () => {
        setError(null)
        if (isLast) {
            onClose()
        } else {
            setStepIdx(stepIdx + 1)
        }
    }

    const handleSave = async () => {
        if (!settings) return
        setSaving(true)
        setError(null)
        try {
            switch (step) {
                case 'language': {
                    if (settings.language !== language) {
                        await onSaveSettings({ ...settings, language })
                    }
                    break
                }
                case 'background': {
                    const cur = settings.background?.provider || 'default'
                    if (cur !== bgProvider) {
                        await onSaveSettings({
                            ...settings,
                            background: { ...(settings.background ?? { provider: 'default', unsplashQuery: '', refreshHours: 24, blur: 3 }), provider: bgProvider },
                        })
                    }
                    break
                }
                case 'firstApp': {
                    const url = appUrl.trim()
                    if (url) {
                        await onCreateApp({
                            groupId: null,
                            name: (appName.trim() || url).slice(0, 64),
                            description: null,
                            url,
                            iconPath: null,
                            iconSource: null,
                        })
                    }
                    break
                }
                case 'weatherCity': {
                    const city = weatherCity.trim()
                    if (city && city !== settings.weather?.city) {
                        await onSaveSettings({
                            ...settings,
                            weather: { ...(settings.weather ?? { city: '' }), city },
                        })
                    }
                    break
                }
            }
            advance()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'failed')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={t('onboardingTitle')}
            closeText={t('onboardingFinishLater')}
            maxWidthClass="max-w-md"
        >
            <div className="mb-4 flex items-center justify-center gap-1.5">
                {STEPS.map((_, i) => (
                    <span
                        key={i}
                        className={`h-1.5 rounded-full transition-all duration-200 ${
                            i === stepIdx
                                ? 'w-6 bg-white/80'
                                : i < stepIdx
                                  ? 'w-3 bg-white/40'
                                  : 'w-3 bg-white/15'
                        }`}
                    />
                ))}
            </div>
            <div className="mb-3 text-center text-xs text-white/40">
                {t('onboardingStepOf', { current: stepIdx + 1, total: STEPS.length })}
            </div>

            {step === 'language' && (
                <StepShell title={t('onboardingLanguageTitle')} hint={t('onboardingLanguageHint')}>
                    <div className="grid grid-cols-2 gap-2">
                        {(['zh', 'en'] as const).map((opt) => (
                            <button
                                key={opt}
                                type="button"
                                onClick={() => setLanguage(opt)}
                                className={`rounded-lg border px-3 py-3 text-sm transition-colors ${
                                    language === opt
                                        ? 'border-white/60 bg-white/10'
                                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                                }`}
                            >
                                {opt === 'zh' ? '中文' : 'English'}
                            </button>
                        ))}
                    </div>
                </StepShell>
            )}

            {step === 'background' && (
                <StepShell title={t('onboardingBackgroundTitle')} hint={t('onboardingBackgroundHint')}>
                    <div className="grid grid-cols-2 gap-2">
                        <BgButton current={bgProvider} value="default" label={t('onboardingBgDefault')} onPick={setBgProvider} />
                        <BgButton current={bgProvider} value="bing" label={t('onboardingBgBing')} onPick={setBgProvider} />
                        <BgButton current={bgProvider} value="picsum" label={t('onboardingBgPicsum')} onPick={setBgProvider} />
                        <BgButton current={bgProvider} value="default_video" label={t('onboardingBgVideo')} onPick={setBgProvider} />
                    </div>
                </StepShell>
            )}

            {step === 'firstApp' && (
                <StepShell title={t('onboardingFirstAppTitle')} hint={t('onboardingFirstAppHint')}>
                    <label className="mb-2 block text-sm">
                        <div className="mb-1 text-white/70">{t('onboardingAppUrl')}</div>
                        <input
                            value={appUrl}
                            onChange={(e) => setAppUrl(e.target.value)}
                            placeholder="https://..."
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                            type="url"
                            autoComplete="off"
                        />
                    </label>
                    <label className="block text-sm">
                        <div className="mb-1 text-white/70">{t('onboardingAppName')}</div>
                        <input
                            value={appName}
                            onChange={(e) => setAppName(e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                            autoComplete="off"
                        />
                    </label>
                </StepShell>
            )}

            {step === 'weatherCity' && (
                <StepShell title={t('onboardingWeatherTitle')} hint={t('onboardingWeatherHint')}>
                    <label className="block text-sm">
                        <div className="mb-1 text-white/70">{t('onboardingWeatherCity')}</div>
                        <input
                            value={weatherCity}
                            onChange={(e) => setWeatherCity(e.target.value)}
                            placeholder={t('onboardingWeatherPlaceholder')}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                            autoComplete="off"
                        />
                    </label>
                </StepShell>
            )}

            {error && (
                <div className="mt-3 rounded-lg border border-red-400/30 bg-red-900/20 p-2 text-xs text-red-300">
                    {error}
                </div>
            )}

            <div className="mt-5 flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={advance}
                    disabled={saving}
                    className="rounded-lg px-3 py-2 text-sm text-white/60 hover:text-white disabled:opacity-50"
                >
                    {isLast ? t('onboardingFinishLater') : t('onboardingSkip')}
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium hover:bg-white/25 disabled:opacity-50"
                >
                    {saving
                        ? t('saving')
                        : isLast
                          ? t('onboardingFinish')
                          : t('onboardingSaveAndNext')}
                </button>
            </div>
        </Modal>
    )
}

function StepShell({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
    return (
        <div>
            <h3 className="mb-1 text-base font-semibold">{title}</h3>
            <p className="mb-4 text-sm leading-relaxed text-white/60">{hint}</p>
            {children}
        </div>
    )
}

function BgButton({
    current,
    value,
    label,
    onPick,
}: {
    current: BackgroundProvider
    value: BackgroundProvider
    label: string
    onPick: (v: BackgroundProvider) => void
}) {
    const active = current === value
    return (
        <button
            type="button"
            onClick={() => onPick(value)}
            className={`rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
                active ? 'border-white/60 bg-white/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}
        >
            {label}
        </button>
    )
}

export default OnboardingWizard
