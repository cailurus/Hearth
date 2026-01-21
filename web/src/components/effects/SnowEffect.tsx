/**
 * Snow Effect Easter Egg Component
 * Displays full-screen falling snow
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface SnowEffectProps {
    onClose?: () => void
}

interface Snowflake {
    x: number
    y: number
    radius: number
    speed: number
    drift: number
    opacity: number
}

function SnowCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const animationRef = useRef<number>(0)
    const flakesRef = useRef<Snowflake[]>([])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        let width = window.innerWidth
        let height = window.innerHeight
        let dpr = window.devicePixelRatio || 1

        const resize = () => {
            width = window.innerWidth
            height = window.innerHeight
            dpr = window.devicePixelRatio || 1

            canvas.width = Math.floor(width * dpr)
            canvas.height = Math.floor(height * dpr)
            canvas.style.width = `${width}px`
            canvas.style.height = `${height}px`
        }

        const createFlake = (randomY = true): Snowflake => ({
            x: Math.random() * width,
            y: randomY ? Math.random() * height : -10,
            radius: 1 + Math.random() * 2.5,
            speed: 0.6 + Math.random() * 1.6,
            drift: -0.6 + Math.random() * 1.2,
            opacity: 0.35 + Math.random() * 0.45,
        })

        const initFlakes = () => {
            const count = Math.max(100, Math.floor(width / 12))
            flakesRef.current = Array.from({ length: count }, () => createFlake(true))
        }

        resize()
        initFlakes()
        window.addEventListener('resize', () => {
            resize()
            initFlakes()
        })

        const draw = () => {
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

            for (let i = 0; i < flakesRef.current.length; i++) {
                const flake = flakesRef.current[i]

                ctx.beginPath()
                ctx.fillStyle = `rgba(255, 255, 255, ${flake.opacity})`
                ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2)
                ctx.fill()

                flake.x += flake.drift
                flake.y += flake.speed

                if (flake.y > height + 8 || flake.x < -10 || flake.x > width + 10) {
                    flakesRef.current[i] = createFlake(false)
                }
            }

            animationRef.current = requestAnimationFrame(draw)
        }

        draw()

        return () => {
            cancelAnimationFrame(animationRef.current)
            window.removeEventListener('resize', resize)
        }
    }, [])

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                pointerEvents: 'none',
                zIndex: 99999,
            }}
        />
    )
}

export function SnowEffect(_props: SnowEffectProps) {
    if (typeof document === 'undefined') return null
    return createPortal(<SnowCanvas />, document.body)
}

export default SnowEffect
