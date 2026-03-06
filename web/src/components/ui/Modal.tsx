import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface ModalProps {
    open: boolean
    onClose: () => void
    title?: string
    children: ReactNode
    closeText?: string
    maxWidthClass?: string
    containerClassName?: string
    className?: string
    showCloseButton?: boolean
}

export function Modal({
    open,
    onClose,
    title,
    children,
    closeText,
    maxWidthClass = 'max-w-lg',
    containerClassName = 'items-center',
    className = '',
    showCloseButton = true,
}: ModalProps) {
    const [mounted, setMounted] = useState(open)
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        if (open) {
            setMounted(true)
            const id = window.requestAnimationFrame(() => setVisible(true))
            return () => window.cancelAnimationFrame(id)
        }
        setVisible(false)
        const id = window.setTimeout(() => setMounted(false), 150)
        return () => window.clearTimeout(id)
    }, [open])

    useEffect(() => {
        if (!open) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [open, onClose])

    if (!mounted) return null

    // Render via portal to escape any parent draggable elements
    return createPortal(
        <div className="fixed inset-0 z-50">
            <div
                className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-150 ${
                    visible ? 'opacity-100' : 'opacity-0'
                }`}
                onClick={onClose}
            />

            <div
                className={`absolute inset-0 flex justify-center p-4 sm:p-6 ${containerClassName}`}
            >
                <div
                    className={`w-full ${maxWidthClass} overflow-hidden rounded-xl border border-white/10 bg-black/60 text-white backdrop-blur transition-all duration-150 ${
                        visible
                            ? 'translate-y-0 scale-100 opacity-100'
                            : 'translate-y-1 scale-[0.99] opacity-0'
                    } ${className}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    {title && (
                        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                            <div className="text-sm font-semibold">{title}</div>
                            {showCloseButton && (
                                <button
                                    onClick={onClose}
                                    className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/90 hover:bg-white/20 transition-colors"
                                    aria-label="close"
                                >
                                    {closeText ?? 'Close'}
                                </button>
                            )}
                        </div>
                    )}

                    <div className="max-h-[85vh] overflow-auto scrollbar-thin px-4 py-4">{children}</div>
                </div>
            </div>
        </div>,
        document.body,
    )
}

export default Modal
