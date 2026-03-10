/**
 * Shooting Star Effect Easter Egg Component
 * Displays occasional shooting stars streaking across the sky
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface Star {
    x: number
    y: number
    size: number
    twinklePhase: number
    twinkleSpeed: number
    opacity: number
}

interface ShootingStar {
    x: number
    y: number
    angle: number
    speed: number
    length: number
    life: number
    maxLife: number
    opacity: number
}

function StarCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const animationRef = useRef<number>(0)
    const starsRef = useRef<Star[]>([])
    const shootingRef = useRef<ShootingStar[]>([])
    const frameRef = useRef(0)

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

        const initStars = () => {
            const count = Math.max(60, Math.floor((width * height) / 8000))
            starsRef.current = Array.from({ length: count }, () => ({
                x: Math.random() * width,
                y: Math.random() * height,
                size: 0.5 + Math.random() * 1.8,
                twinklePhase: Math.random() * Math.PI * 2,
                twinkleSpeed: 0.01 + Math.random() * 0.03,
                opacity: 0.3 + Math.random() * 0.5,
            }))
        }

        resize()
        initStars()
        window.addEventListener('resize', () => { resize(); initStars() })

        const draw = () => {
            frameRef.current++
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

            // Draw twinkling stars
            for (const s of starsRef.current) {
                s.twinklePhase += s.twinkleSpeed
                const brightness = s.opacity * (0.5 + Math.sin(s.twinklePhase) * 0.5)

                ctx.beginPath()
                ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
                ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`
                ctx.fill()

                // Cross glow for brighter stars
                if (s.size > 1.2) {
                    ctx.strokeStyle = `rgba(255, 255, 255, ${brightness * 0.3})`
                    ctx.lineWidth = 0.5
                    const arm = s.size * 3
                    ctx.beginPath()
                    ctx.moveTo(s.x - arm, s.y)
                    ctx.lineTo(s.x + arm, s.y)
                    ctx.moveTo(s.x, s.y - arm)
                    ctx.lineTo(s.x, s.y + arm)
                    ctx.stroke()
                }
            }

            // Spawn shooting stars occasionally
            if (frameRef.current % 90 === 0 && Math.random() < 0.6) {
                const angle = Math.PI * 0.15 + Math.random() * Math.PI * 0.2
                shootingRef.current.push({
                    x: Math.random() * width * 0.8,
                    y: Math.random() * height * 0.3,
                    angle,
                    speed: 6 + Math.random() * 6,
                    length: 60 + Math.random() * 80,
                    life: 1,
                    maxLife: 1,
                    opacity: 0.7 + Math.random() * 0.3,
                })
            }

            // Draw shooting stars
            for (let i = shootingRef.current.length - 1; i >= 0; i--) {
                const ss = shootingRef.current[i]
                const tailX = ss.x - Math.cos(ss.angle) * ss.length * ss.life
                const tailY = ss.y - Math.sin(ss.angle) * ss.length * ss.life

                const grad = ctx.createLinearGradient(ss.x, ss.y, tailX, tailY)
                grad.addColorStop(0, `rgba(255, 255, 255, ${ss.opacity * ss.life})`)
                grad.addColorStop(1, `rgba(255, 255, 255, 0)`)

                ctx.beginPath()
                ctx.moveTo(ss.x, ss.y)
                ctx.lineTo(tailX, tailY)
                ctx.strokeStyle = grad
                ctx.lineWidth = 1.5
                ctx.stroke()

                // Head glow
                ctx.beginPath()
                ctx.arc(ss.x, ss.y, 2, 0, Math.PI * 2)
                ctx.fillStyle = `rgba(255, 255, 255, ${ss.opacity * ss.life})`
                ctx.fill()

                ss.x += Math.cos(ss.angle) * ss.speed
                ss.y += Math.sin(ss.angle) * ss.speed
                ss.life -= 0.015

                if (ss.life <= 0 || ss.x > width + 20 || ss.y > height + 20) {
                    shootingRef.current.splice(i, 1)
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

export function StarEffect() {
    if (typeof document === 'undefined') return null
    return createPortal(<StarCanvas />, document.body)
}
