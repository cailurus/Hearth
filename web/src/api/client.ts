/**
 * HTTP 客户端基础函数
 */

import type { ApiError } from '../types'

/**
 * 解析 JSON 响应或抛出错误
 */
async function parseJsonOrThrow<T>(res: Response): Promise<T> {
    const text = await res.text()
    const data = text ? (JSON.parse(text) as unknown) : undefined
    if (!res.ok) {
        const msg = (data as ApiError | undefined)?.error || res.statusText
        throw new Error(msg)
    }
    return data as T
}

/**
 * GET 请求
 */
export async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: 'include' })
    return parseJsonOrThrow<T>(res)
}

/**
 * POST 请求
 */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    return parseJsonOrThrow<T>(res)
}

/**
 * PUT 请求
 */
export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    return parseJsonOrThrow<T>(res)
}

/**
 * DELETE 请求
 */
export async function apiDelete<T>(path: string): Promise<T> {
    const res = await fetch(path, {
        method: 'DELETE',
        credentials: 'include',
    })
    return parseJsonOrThrow<T>(res)
}

/**
 * 下载文件
 */
export async function apiDownload(path: string): Promise<Blob> {
    const res = await fetch(path, { credentials: 'include' })
    if (!res.ok) {
        const maybe = (await res.json().catch(() => null)) as ApiError | null
        throw new Error(maybe?.error || res.statusText)
    }
    return await res.blob()
}
