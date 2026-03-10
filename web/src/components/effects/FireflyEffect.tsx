/**
 * Firefly Effect Easter Egg Component
 * Displays glowing fireflies floating across the screen
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface Firefly {
    x: number
    y: number
    size: number
    glowPhase: number
    glowSpeed: number
    vx: number
    vy: number
    targetX: number
    targetY: number
    hue: number
}

function FireflyCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const animationRef = useRef<number>(0)
    const fliesRef = useRef<Firefly[]>([])

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

        const createFirefly = (): Firefly => ({
            x: Math.random() * width,
            y: Math.random() * height,
            size: 2 + Math.random() * 2,
            glowPhase: Math.random() * Math.PI * 2,
            glowSpeed: 0.02 + Math.random() * 0.03,
            vx: 0,
            vy: 0,
            targetX: Math.random() * width,
            targetY: Math.random() * height,
            hue: 45 + Math.random() * 25, // warm yellow-green
        })

        const initFlies = () => {
            const count = Math.max(25, Math.floor(width / 40))
            fliesRef.current = Array.from({ length: count }, () => createFirefly())
        }

        resize()
        initFlies()
        window.addEventListener('resize', () => { resize(); initFlies() })

        const draw = () => {
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

            for (const f of fliesRef.current) {
                f.glowPhase += f.glowSpeed
                const glow = 0.3 + Math.sin(f.glowPhase) * 0.5 + 0.5 * 0.7

                // Drift toward target
                const dx = f.targetX - f.x
                const dy = f.targetY - f.y
                f.vx += dx * 0.001
                f.vy += dy * 0.001
                f.vx *= 0.98
                f.vy *= 0.98
                f.x += f.vx
                f.y += f.vy

                // Pick new target when close
                if (Math.abs(dx) < 30 && Math.abs(dy) < 30) {
                    f.targetX = Math.random() * width
                    f.targetY = Math.random() * height
                }

                // Outer glow
                const gradient = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.size * 8)
                gradient.addColorStop(0, `hsla(${f.hue}, 100%, 75%, ${glow * 0.4})`)
                gradient.addColorStop(0.4, `hsla(${f.hue}, 100%, 65%, ${glow * 0.15})`)
                gradient.addColorStop(1, `hsla(${f.hue}, 100%, 50%, 0)`)
                ctx.fillStyle = gradient
                ctx.fillRect(f.x - f.size * 8, f.y - f.size * 8, f.size * 16, f.size * 16)

                // Core
                ctx.beginPath()
                ctx.arc(f.x, f.y, f.size * 0.6, 0, Math.PI * 2)
                ctx.fillStyle = `hsla(${f.hue}, 100%, 90%, ${glow * 0.9})`
                ctx.fill()
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
                position: 'fixed', top: 0, left: 0,
                width: '100vw', height: '100vh',
                pointerEvents: 'none', zIndex: 99999,
            }}
        />
    )
}

export function FireflyEffect() {
    if (typeof document === 'undefined') return null
    return createPortal(<FireflyCanvas />, document.body)
}
