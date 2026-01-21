/**
 * API 相关类型定义
 */

/**
 * 当前用户信息
 */
export interface Me {
    admin: boolean
}

/**
 * API 错误响应
 */
export interface ApiError {
    error?: string
}

/**
 * 图标解析结果
 */
export interface IconResolve {
    title: string
    iconUrl: string
    iconPath: string
    iconSource: string
}

/**
 * 地理编码结果
 */
export interface GeocodeResult {
    displayName: string
}

export interface GeocodeResponse {
    results: GeocodeResult[]
}

/**
 * 时区解析结果
 */
export interface TimezoneResolve {
    timezone: string
    city?: string
}

/**
 * 市场符号搜索结果
 */
export interface MarketSymbolResult {
    symbol: string
    name: string
    kind: string
}

export interface MarketSymbolSearchResponse {
    results: MarketSymbolResult[]
}

// ============ 请求参数类型 ============

export interface LoginRequest {
    username: string
    password: string
}

export interface ChangePasswordRequest {
    oldPassword: string
    newPassword: string
}

export interface CreateGroupRequest {
    name: string
    kind: 'system' | 'app'
}

export interface UpdateGroupRequest {
    name: string
}

export interface ReorderRequest {
    ids: string[]
}

export interface ReorderAppsRequest {
    groupId: string | null
    ids: string[]
}

export interface CreateAppRequest {
    groupId: string | null
    name: string
    description: string | null
    url: string
    iconPath: string | null
    iconSource: string | null
}

export interface UpdateAppRequest {
    groupId: string | null
    name: string
    description: string | null
    url: string
    iconPath: string | null
    iconSource: string | null
}

export interface IconResolveRequest {
    url: string
}
