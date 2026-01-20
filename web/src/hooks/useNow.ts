import { useEffect, useState } from 'react'

/**
 * 定时更新当前时间的 Hook
 * @param tickMs 更新间隔（毫秒）
 * @returns 当前时间戳
 */
export function useNow(tickMs: number = 1000): number {
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), tickMs)
        return () => window.clearInterval(id)
    }, [tickMs])

    return now
}
