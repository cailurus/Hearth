import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Highlight matching text in a string
 */
function highlightMatch(text: string, query: string): ReactNode {
    const q = (query || '').trim()
    if (!q) return text
    const i = text.toLowerCase().indexOf(q.toLowerCase())
    if (i < 0) return text
    const pre = text.slice(0, i)
    const mid = text.slice(i, i + q.length)
    const post = text.slice(i + q.length)
    return (
        <>
            <span className="text-white/80">{pre}</span>
            <span className="font-semibold text-white">{mid}</span>
            <span className="text-white/80">{post}</span>
        </>
    )
}

export interface ComboBoxProps<T> {
    value: string
    onChange: (v: string) => void
    options: T[]
    placeholder?: string
    getOptionLabel: (opt: T) => string
    onPick: (opt: T) => void
}

/**
 * Generic ComboBox component with dropdown and search functionality.
 * Both dropdown and backdrop render via portal to avoid interfering with parent scroll containers.
 */
export function ComboBox<T>({
    value,
    onChange,
    options,
    placeholder,
    getOptionLabel,
    onPick,
}: ComboBoxProps<T>) {
    const [open, setOpen] = useState(false)
    const inputId = useId()
    const inputRef = useRef<HTMLInputElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null)

    const recalcPosition = useCallback(() => {
        if (!inputRef.current) return
        const rect = inputRef.current.getBoundingClientRect()
        const spaceBelow = window.innerHeight - rect.bottom
        const spaceAbove = rect.top
        const dropdownHeight = 224
        const openUp = spaceBelow < dropdownHeight && spaceAbove > spaceBelow
        const top = openUp ? rect.top : rect.bottom + 4
        const left = rect.left
        const width = rect.width
        setDropdownPos((prev) => {
            if (prev && prev.top === top && prev.left === left && prev.width === width && prev.openUp === openUp) {
                return prev
            }
            return { top, left, width, openUp }
        })
    }, [])

    // Calculate dropdown position when opening
    useLayoutEffect(() => {
        if (!open || !inputRef.current) {
            setDropdownPos(null)
            return
        }
        recalcPosition()
    }, [open, recalcPosition])

    // Only reposition on window resize
    useEffect(() => {
        if (!open) return
        const handler = () => recalcPosition()
        window.addEventListener('resize', handler)
        return () => window.removeEventListener('resize', handler)
    }, [open, recalcPosition])

    // Prevent wheel-scroll from leaking past the dropdown boundaries
    useEffect(() => {
        const el = scrollRef.current
        if (!el || !open) return
        const handler = (e: WheelEvent) => {
            const { scrollTop, scrollHeight, clientHeight } = el
            const atTop = scrollTop <= 0 && e.deltaY < 0
            const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0
            if (atTop || atBottom) {
                e.preventDefault()
            }
            e.stopPropagation()
        }
        el.addEventListener('wheel', handler, { passive: false })
        return () => el.removeEventListener('wheel', handler)
    }, [open])

    const filtered = useMemo(() => {
        return options.map((o) => ({ o, label: getOptionLabel(o) })).slice(0, 12)
    }, [options, getOptionLabel])

    const overlay = open ? createPortal(
        <>
            <div
                className="fixed inset-0 z-[9998]"
                onMouseDown={() => setOpen(false)}
                aria-hidden="true"
            />
            {filtered.length > 0 && dropdownPos ? (
                <div
                    className="fixed z-[9999] overflow-hidden rounded-lg border border-white/10 bg-neutral-950 text-white"
                    style={{
                        top: dropdownPos.openUp ? 'auto' : dropdownPos.top,
                        bottom: dropdownPos.openUp ? `${window.innerHeight - dropdownPos.top + 4}px` : 'auto',
                        left: dropdownPos.left,
                        width: dropdownPos.width,
                        contain: 'content',
                    }}
                >
                    <div
                        ref={scrollRef}
                        className="max-h-56 overflow-auto overscroll-contain py-1"
                    >
                        {filtered.map(({ o, label }) => (
                            <button
                                key={label}
                                type="button"
                                className="flex w-full items-center px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10"
                                onMouseDown={(e) => {
                                    e.preventDefault()
                                    onPick(o)
                                    setOpen(false)
                                }}
                            >
                                {highlightMatch(label, value)}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </>,
        document.body,
    ) : null

    return (
        <div className="relative">
            <input
                ref={inputRef}
                id={inputId}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value)
                    setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false)
                }}
                placeholder={placeholder}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                autoComplete="off"
            />
            {overlay}
        </div>
    )
}

export default ComboBox
