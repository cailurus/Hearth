/**
 * 认证相关 API
 */

import { apiGet, apiPost } from './client'
import type { Me, LoginRequest, ChangePasswordRequest } from '../types'

export const authApi = {
    /**
     * 获取当前用户信息
     */
    getMe: () => apiGet<Me>('/api/auth/me'),

    /**
     * 登录
     */
    login: (data: LoginRequest) => apiPost<void>('/api/auth/login', data),

    /**
     * 登出
     */
    logout: () => apiPost<void>('/api/auth/logout'),

    /**
     * 修改密码
     */
    changePassword: (data: ChangePasswordRequest) =>
        apiPost<void>('/api/auth/password', data),
}
