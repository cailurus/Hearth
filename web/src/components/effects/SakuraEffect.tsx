/**
 * Sakura (Cherry Blossom) Effect Easter Egg Component
 * Displays full-screen falling cherry blossom petals
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface Petal {
    x: number
    y: number
    size: number
    speed: number
    drift: number
    opacity: number
    rotation: number
    spin: number
    wobble: number
    wobbleSpeed: number
}

function SakuraCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const animationRef = useRef<number>(0)
    const petalsRef = useRef<Petal[]>([])

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

        const createPetal = (randomY = true): Petal => ({
            x: Math.random() * (width + 100) - 50,
            y: randomY ? Math.random() * height : -15,
            size: 4 + Math.random() * 6,
            speed: 0.5 + Math.random() * 1.2,
            drift: -0.3 + Math.random() * 0.8,
            opacity: 0.4 + Math.random() * 0.4,
            rotation: Math.random() * Math.PI * 2,
            spin: -0.02 + Math.random() * 0.04,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: 0.02 + Math.random() * 0.03,
        })

        const initPetals = () => {
            const count = Math.max(60, Math.floor(width / 18))
            petalsRef.current = Array.from({ length: count }, () => createPetal(true))
        }

        resize()
        initPetals()
        window.addEventListener('resize', () => { resize(); initPetals() })

        const draw = () => {
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

            for (let i = 0; i < petalsRef.current.length; i++) {
                const p = petalsRef.current[i]

                ctx.save()
                ctx.translate(p.x, p.y)
                ctx.rotate(p.rotation)

                // Draw petal shape
                ctx.beginPath()
                ctx.moveTo(0, 0)
                ctx.bezierCurveTo(p.size * 0.5, -p.size * 0.4, p.size, -p.size * 0.2, p.size, 0)
                ctx.bezierCurveTo(p.size, p.size * 0.2, p.size * 0.5, p.size * 0.4, 0, 0)
                ctx.fillStyle = `rgba(255, 183, 197, ${p.opacity})`
                ctx.fill()

                // Inner vein
                ctx.beginPath()
                ctx.moveTo(0, 0)
                ctx.lineTo(p.size * 0.85, 0)
                ctx.strokeStyle = `rgba(255, 140, 160, ${p.opacity * 0.4})`
                ctx.lineWidth = 0.5
                ctx.stroke()

                ctx.restore()

                p.wobble += p.wobbleSpeed
                p.x += p.drift + Math.sin(p.wobble) * 0.8
                p.y += p.speed
                p.rotation += p.spin

                if (p.y > height + 15 || p.x < -20 || p.x > width + 20) {
                    petalsRef.current[i] = createPetal(false)
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
                position: 'fixed', top: 0, left: 0,
                width: '100vw', height: '100vh',
                pointerEvents: 'none', zIndex: 99999,
            }}
        />
    )
}

export function SakuraEffect() {
    if (typeof document === 'undefined') return null
    return createPortal(<SakuraCanvas />, document.body)
}
