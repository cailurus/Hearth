type ApiError = { error?: string }

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
    const text = await res.text()
    const data = text ? (JSON.parse(text) as unknown) : undefined
    if (!res.ok) {
        const msg = (data as ApiError | undefined)?.error || res.statusText
        throw new Error(msg)
    }
    return data as T
}

export async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: 'include' })
    return parseJsonOrThrow<T>(res)
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    return parseJsonOrThrow<T>(res)
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    return parseJsonOrThrow<T>(res)
}

export async function apiDelete<T>(path: string): Promise<T> {
    const res = await fetch(path, {
        method: 'DELETE',
        credentials: 'include',
    })
    return parseJsonOrThrow<T>(res)
}

export async function apiDownload(path: string): Promise<Blob> {
    const res = await fetch(path, { credentials: 'include' })
    if (!res.ok) {
        const maybe = (await res.json().catch(() => null)) as ApiError | null
        throw new Error(maybe?.error || res.statusText)
    }
    return await res.blob()
}
