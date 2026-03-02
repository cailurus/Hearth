/**
 * useSettingsDraft - 设置草稿管理和自动保存
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import type { Settings } from '../types'

export type SiteDraft = Pick<Settings, 'siteTitle' | 'background' | 'time' | 'language' | 'greeting'>

interface UseSettingsDraftOptions {
    settings: Settings | null
    isAdmin: boolean
    systemTimezone: string
    onSave: (settings: Settings) => Promise<void>
}

export interface UseSettingsDraftResult {
    draft: SiteDraft | null
    setDraft: React.Dispatch<React.SetStateAction<SiteDraft | null>>
    saveError: string | null
    saveDraft: (draft: SiteDraft, mode: 'now' | 'debounce') => void
}

export function useSettingsDraft({
    settings,
    isAdmin,
    systemTimezone,
    onSave,
}: UseSettingsDraftOptions): UseSettingsDraftResult {
    const [draft, setDraft] = useState<SiteDraft | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)

    const saveSeqRef = useRef(0)
    const saveTimerRef = useRef<number | null>(null)

    // Initialize draft from settings
    useEffect(() => {
        if (!settings || draft) return

        const allowedIntervals = new Set(['0', '1h', '3h', '6h', '12h', '24h'])
        const providerRaw = String(settings.background?.provider ?? '').trim() || 'default'
        const provider = providerRaw === 'bing' ? 'bing_daily' : providerRaw
        const intervalRaw = String(settings.background?.interval ?? '').trim()
        const interval =
            provider === 'bing_daily'
                ? '24h'
                : provider === 'default'
                    ? '0'
                    : allowedIntervals.has(intervalRaw)
                        ? intervalRaw
                        : '0'

        setDraft({
            siteTitle: settings.siteTitle,
            language: settings.language || 'zh',
            background: { ...settings.background, provider, interval },
            time: settings.time ? { ...settings.time, timezone: systemTimezone } : settings.time,
            greeting: settings.greeting ?? { enabled: true },
        })
    }, [settings, draft, systemTimezone])

    const persistDraft = useCallback(
        async (draftToSave: SiteDraft) => {
            if (!isAdmin || !settings) return

            const token = ++saveSeqRef.current
            setSaveError(null)

            try {
                const normalizedTime = draftToSave.time
                    ? {
                        ...draftToSave.time,
                        mode: 'digital' as const,
                        timezone: systemTimezone,
                    }
                    : draftToSave.time

                const next: Settings = {
                    ...settings,
                    siteTitle: draftToSave.siteTitle,
                    language: draftToSave.language,
                    background: draftToSave.background,
                    time: normalizedTime,
                    greeting: draftToSave.greeting,
                }

                await onSave(next)
                if (token !== saveSeqRef.current) return
            } catch (e) {
                if (token !== saveSeqRef.current) return
                setSaveError(e instanceof Error ? e.message : 'failed')
            }
        },
        [isAdmin, settings, systemTimezone, onSave]
    )

    const saveDraft = useCallback(
        (draftToSave: SiteDraft, mode: 'now' | 'debounce') => {
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current)
                saveTimerRef.current = null
            }

            if (mode === 'now') {
                void persistDraft(draftToSave)
                return
            }

            saveTimerRef.current = window.setTimeout(() => {
                saveTimerRef.current = null
                void persistDraft(draftToSave)
            }, 300)
        },
        [persistDraft]
    )

    return {
        draft,
        setDraft,
        saveError,
        saveDraft,
    }
}
