import { useEffect, useRef, useState, type ReactNode } from 'react'
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

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
    if (!container) return []
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null && !el.hasAttribute('aria-hidden')
    )
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
    const panelRef = useRef<HTMLDivElement>(null)
    const previouslyFocusedRef = useRef<HTMLElement | null>(null)

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

    // Focus management: when the modal opens, remember whatever was focused on
    // the page, then move focus to the first focusable element inside the
    // panel so keyboard users land somewhere sensible. On close, restore
    // focus to the trigger so screen readers don't lose context.
    useEffect(() => {
        if (!open) return
        previouslyFocusedRef.current = document.activeElement as HTMLElement | null
        const id = window.requestAnimationFrame(() => {
            const focusables = getFocusableElements(panelRef.current)
            // Prefer the first non-close-button focusable; fall back to anything.
            const firstNonClose = focusables.find(
                (el) => el.getAttribute('aria-label') !== 'close'
            )
            ;(firstNonClose ?? focusables[0])?.focus()
        })
        return () => {
            window.cancelAnimationFrame(id)
            // Defer restoration so it runs after React unmount.
            const prev = previouslyFocusedRef.current
            window.setTimeout(() => prev?.focus?.(), 0)
        }
    }, [open])

    // Tab trap: when focus would otherwise leave the modal, wrap it.
    useEffect(() => {
        if (!open) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return
            const focusables = getFocusableElements(panelRef.current)
            if (focusables.length === 0) {
                e.preventDefault()
                return
            }
            const first = focusables[0]
            const last = focusables[focusables.length - 1]
            const active = document.activeElement
            if (e.shiftKey) {
                if (active === first || !panelRef.current?.contains(active)) {
                    e.preventDefault()
                    last.focus()
                }
            } else {
                if (active === last) {
                    e.preventDefault()
                    first.focus()
                }
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [open])

    if (!mounted) return null

    // Render via portal to escape any parent draggable elements
    return createPortal(
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
            <div
                className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-150 ${
                    visible ? 'opacity-100' : 'opacity-0'
                }`}
                onClick={onClose}
                aria-hidden="true"
            />

            <div
                className={`absolute inset-0 flex justify-center p-4 sm:p-6 ${containerClassName}`}
            >
                <div
                    ref={panelRef}
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
