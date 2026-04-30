/**
 * Rain Effect Easter Egg Component
 * Displays full-screen falling rain with splash particles
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePrefersReducedMotion } from '../../hooks'

interface Drop {
    x: number
    y: number
    length: number
    speed: number
    opacity: number
}

interface Splash {
    x: number
    y: number
    radius: number
    opacity: number
    life: number
}

function RainCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const animationRef = useRef<number>(0)
    const dropsRef = useRef<Drop[]>([])
    const splashesRef = useRef<Splash[]>([])

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

        const createDrop = (randomY = true): Drop => ({
            x: Math.random() * (width + 100) - 50,
            y: randomY ? Math.random() * height : -20,
            length: 12 + Math.random() * 18,
            speed: 8 + Math.random() * 8,
            opacity: 0.15 + Math.random() * 0.25,
        })

        const initDrops = () => {
            const count = Math.max(150, Math.floor(width / 6))
            dropsRef.current = Array.from({ length: count }, () => createDrop(true))
        }

        resize()
        initDrops()
        window.addEventListener('resize', () => { resize(); initDrops() })

        const draw = () => {
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

            // Draw rain drops
            for (let i = 0; i < dropsRef.current.length; i++) {
                const d = dropsRef.current[i]
                ctx.beginPath()
                ctx.moveTo(d.x, d.y)
                ctx.lineTo(d.x - 1.5, d.y + d.length)
                ctx.strokeStyle = `rgba(174, 194, 224, ${d.opacity})`
                ctx.lineWidth = 1.2
                ctx.stroke()

                d.x -= 1.5
                d.y += d.speed

                if (d.y > height) {
                    // Spawn splash
                    if (Math.random() < 0.3) {
                        splashesRef.current.push({
                            x: d.x, y: height - 2,
                            radius: 1.5 + Math.random() * 2,
                            opacity: 0.4,
                            life: 1,
                        })
                    }
                    dropsRef.current[i] = createDrop(false)
                }
            }

            // Draw splashes
            for (let i = splashesRef.current.length - 1; i >= 0; i--) {
                const s = splashesRef.current[i]
                ctx.beginPath()
                ctx.arc(s.x, s.y, s.radius * (1 + (1 - s.life) * 2), 0, Math.PI, true)
                ctx.strokeStyle = `rgba(174, 194, 224, ${s.opacity * s.life})`
                ctx.lineWidth = 0.8
                ctx.stroke()
                s.life -= 0.04
                if (s.life <= 0) splashesRef.current.splice(i, 1)
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

export function RainEffect() {
    const reduce = usePrefersReducedMotion()
    if (typeof document === 'undefined') return null
    if (reduce) return null
    return createPortal(<RainCanvas />, document.body)
}
