/**
 * Apps 和 Groups 相关 API
 */

import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type {
    Group,
    AppItem,
    CreateGroupRequest,
    UpdateGroupRequest,
    ReorderRequest,
    CreateAppRequest,
    UpdateAppRequest,
    ReorderAppsRequest,
    IconResolve,
    IconResolveRequest,
} from '../types'

export const groupsApi = {
    /**
     * 获取所有分组
     */
    list: () => apiGet<Group[]>('/api/groups'),

    /**
     * 创建分组
     */
    create: (data: CreateGroupRequest) => apiPost<Group>('/api/groups', data),

    /**
     * 更新分组
     */
    update: (id: string, data: UpdateGroupRequest) =>
        apiPut<void>(`/api/groups/${id}`, data),

    /**
     * 删除分组
     */
    delete: (id: string) => apiDelete<void>(`/api/groups/${id}`),

    /**
     * 重新排序分组
     */
    reorder: (data: ReorderRequest) => apiPost<void>('/api/groups/reorder', data),
}

export const appsApi = {
    /**
     * 获取所有 Apps
     */
    list: () => apiGet<AppItem[]>('/api/apps'),

    /**
     * 创建 App
     */
    create: (data: CreateAppRequest) => apiPost<AppItem>('/api/apps', data),

    /**
     * 更新 App
     */
    update: (id: string, data: UpdateAppRequest) =>
        apiPut<void>(`/api/apps/${id}`, data),

    /**
     * 删除 App
     */
    delete: (id: string) => apiDelete<void>(`/api/apps/${id}`),

    /**
     * 重新排序 Apps
     */
    reorder: (data: ReorderAppsRequest) => apiPost<void>('/api/apps/reorder', data),
}

export const iconApi = {
    /**
     * 解析图标
     */
    resolve: (data: IconResolveRequest) =>
        apiPost<IconResolve>('/api/icon/resolve', data),
}
