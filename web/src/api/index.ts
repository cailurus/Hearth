/**
 * API 统一导出
 */

// HTTP 客户端
export { apiGet, apiPost, apiPut, apiDelete, apiDownload } from './client'

// 领域 API
export { authApi } from './auth'
export { groupsApi, appsApi, iconApi } from './apps'
export { settingsApi, backgroundApi } from './settings'
export { widgetsApi } from './widgets'
