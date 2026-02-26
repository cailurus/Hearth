/**
 * Hook for managing video background download and state
 */

import { useState, useEffect, useCallback, useRef } from 'react'

// Video is stored in public/assets/videos/rain.mp4
// In Docker, this file doesn't exist - need to download from GitHub
const LOCAL_VIDEO_PATH = '/assets/videos/rain.mp4'
const GITHUB_VIDEO_URL = 'https://raw.githubusercontent.com/cailurus/Hearth/main/web/public/assets/videos/rain.mp4'

// IndexedDB for storing downloaded video
const DB_NAME = 'hearth-video-bg'
const DB_VERSION = 1
const STORE_NAME = 'videos'
const VIDEO_KEY = 'rain.mp4'

interface VideoBackgroundState {
    videoUrl: string | null
    isDownloading: boolean
    downloadProgress: number
    error: string | null
    isReady: boolean
}

async function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME)
            }
        }
    })
}

async function getVideoFromDB(): Promise<Blob | null> {
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly')
            const store = tx.objectStore(STORE_NAME)
            const request = store.get(VIDEO_KEY)
            request.onerror = () => reject(request.error)
            request.onsuccess = () => resolve(request.result as Blob | null)
        })
    } catch {
        return null
    }
}

async function saveVideoToDB(blob: Blob): Promise<void> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const request = store.put(blob, VIDEO_KEY)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
    })
}

async function checkLocalVideo(): Promise<boolean> {
    try {
        const response = await fetch(LOCAL_VIDEO_PATH, { method: 'HEAD' })
        // Check if file exists and has reasonable size (not an error page)
        const contentLength = response.headers.get('content-length')
        return response.ok && contentLength !== null && parseInt(contentLength, 10) > 1000000
    } catch {
        return false
    }
}

export function useVideoBackground(enabled: boolean): VideoBackgroundState {
    const [videoUrl, setVideoUrl] = useState<string | null>(null)
    const [isDownloading, setIsDownloading] = useState(false)
    const [downloadProgress, setDownloadProgress] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [isReady, setIsReady] = useState(false)
    const objectUrlsRef = useRef<string[]>([])

    // Helper to track and set object URLs
    const setObjectUrl = useCallback((url: string | null) => {
        setVideoUrl(url)
        if (url && url.startsWith('blob:')) {
            objectUrlsRef.current.push(url)
        }
    }, [])

    // Revoke all tracked object URLs
    const revokeAllUrls = useCallback(() => {
        for (const u of objectUrlsRef.current) {
            URL.revokeObjectURL(u)
        }
        objectUrlsRef.current = []
    }, [])

    const downloadVideo = useCallback(async () => {
        setIsDownloading(true)
        setDownloadProgress(0)
        setError(null)

        try {
            const response = await fetch(GITHUB_VIDEO_URL)
            if (!response.ok) {
                throw new Error(`Failed to download: ${response.status}`)
            }

            const contentLength = response.headers.get('content-length')
            const total = contentLength ? parseInt(contentLength, 10) : 0

            const reader = response.body?.getReader()
            if (!reader) {
                throw new Error('No reader available')
            }

            const chunks: BlobPart[] = []
            let received = 0

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                chunks.push(value.slice().buffer)
                received += value.length
                if (total > 0) {
                    setDownloadProgress(Math.round((received / total) * 100))
                }
            }

            const blob = new Blob(chunks, { type: 'video/mp4' })
            await saveVideoToDB(blob)

            const url = URL.createObjectURL(blob)
            setObjectUrl(url)
            setIsReady(true)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Download failed')
        } finally {
            setIsDownloading(false)
        }
    }, [])

    useEffect(() => {
        if (!enabled) {
            revokeAllUrls()
            setVideoUrl(null)
            setIsReady(false)
            return
        }

        let cancelled = false

        const init = async () => {
            const localExists = await checkLocalVideo()
            if (cancelled) return

            if (localExists) {
                setVideoUrl(LOCAL_VIDEO_PATH)
                setIsReady(true)
                return
            }

            const cachedBlob = await getVideoFromDB()
            if (cancelled) return

            if (cachedBlob) {
                setObjectUrl(URL.createObjectURL(cachedBlob))
                setIsReady(true)
                return
            }

            await downloadVideo()
        }

        void init()

        return () => {
            cancelled = true
            revokeAllUrls()
        }
    }, [enabled, downloadVideo, setObjectUrl, revokeAllUrls])

    return { videoUrl, isDownloading, downloadProgress, error, isReady }
}
