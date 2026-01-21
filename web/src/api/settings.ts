/**
 * 设置相关 API
 */

import { apiGet, apiPost, apiPut } from './client'
import type { Settings, BackgroundInfo } from '../types'

export const settingsApi = {
    /**
     * 获取设置
     */
    get: () => apiGet<Settings>('/api/settings'),

    /**
     * 更新设置
     */
    update: (data: Settings) => apiPut<void>('/api/settings', data),
}

export const backgroundApi = {
    /**
     * 获取背景信息
     */
    get: () => apiGet<BackgroundInfo>('/api/background'),

    /**
     * 刷新背景
     */
    refresh: (provider?: string) => {
        const params = provider ? `?provider=${encodeURIComponent(provider)}` : ''
        return apiPost<void>(`/api/background/refresh${params}`)
    },

    /**
     * 获取背景图片 URL
     */
    getImageUrl: (nonce?: number) => {
        const base = '/api/background/image'
        return nonce ? `${base}?v=${nonce}` : base
    },
}
