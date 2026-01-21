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
    rotation: number
    spin: number
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
            rotation: Math.random() * Math.PI * 2,
            spin: -0.01 + Math.random() * 0.02,
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

                ctx.save()
                ctx.translate(flake.x, flake.y)
                ctx.rotate(flake.rotation)
                ctx.strokeStyle = `rgba(255, 255, 255, ${flake.opacity})`
                ctx.lineWidth = Math.max(0.6, flake.radius * 0.35)

                const arm = flake.radius * 3.2
                const twig = flake.radius * 1.4

                for (let k = 0; k < 6; k++) {
                    const angle = (Math.PI / 3) * k
                    const x = Math.cos(angle) * arm
                    const y = Math.sin(angle) * arm

                    ctx.beginPath()
                    ctx.moveTo(0, 0)
                    ctx.lineTo(x, y)

                    const nx = Math.cos(angle + Math.PI / 6) * twig
                    const ny = Math.sin(angle + Math.PI / 6) * twig
                    const px = Math.cos(angle - Math.PI / 6) * twig
                    const py = Math.sin(angle - Math.PI / 6) * twig

                    ctx.moveTo(x * 0.6, y * 0.6)
                    ctx.lineTo(x * 0.6 + nx, y * 0.6 + ny)
                    ctx.moveTo(x * 0.6, y * 0.6)
                    ctx.lineTo(x * 0.6 + px, y * 0.6 + py)
                    ctx.stroke()
                }

                ctx.restore()

                flake.x += flake.drift
                flake.y += flake.speed
                flake.rotation += flake.spin

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
