import { type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
 * Generic ComboBox component with dropdown and search functionality
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
    const [query, setQuery] = useState(value)
    const inputId = useId()
    const inputRef = useRef<HTMLInputElement>(null)
    const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null)

    useEffect(() => {
        setQuery(value)
    }, [value])

    // Calculate dropdown position when opening
    useLayoutEffect(() => {
        if (!open || !inputRef.current) {
            setDropdownPos(null)
            return
        }
        const rect = inputRef.current.getBoundingClientRect()
        const viewportHeight = window.innerHeight
        const spaceBelow = viewportHeight - rect.bottom
        const spaceAbove = rect.top
        const dropdownHeight = 224 // max-h-56 = 14rem = 224px

        // Open upward if not enough space below and more space above
        const openUp = spaceBelow < dropdownHeight && spaceAbove > spaceBelow

        setDropdownPos({
            top: openUp ? rect.top : rect.bottom + 4,
            left: rect.left,
            width: rect.width,
            openUp,
        })
    }, [open])

    const filtered = useMemo(() => {
        // Don't filter the options - the API already returns search results
        // Just take the first 12 options as-is
        return options.map((o) => ({ o, label: getOptionLabel(o) })).slice(0, 12)
    }, [options, getOptionLabel])

    const dropdown = open && filtered.length > 0 && dropdownPos ? (
        createPortal(
            <div
                className="fixed z-[9999] overflow-hidden rounded-lg border border-white/10 bg-black/90 text-white shadow-lg shadow-black/40 backdrop-blur"
                style={{
                    top: dropdownPos.openUp ? 'auto' : dropdownPos.top,
                    bottom: dropdownPos.openUp ? `${window.innerHeight - dropdownPos.top + 4}px` : 'auto',
                    left: dropdownPos.left,
                    width: dropdownPos.width,
                }}
            >
                <div
                    className="max-h-56 overflow-auto overscroll-contain py-1"
                    onWheel={(e) => e.stopPropagation()}
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
                            {highlightMatch(label, query)}
                        </button>
                    ))}
                </div>
            </div>,
            document.body
        )
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
            {dropdown}
            {open ? (
                <div
                    className="fixed inset-0 z-[9998]"
                    onMouseDown={() => setOpen(false)}
                    aria-hidden="true"
                />
            ) : null}
        </div>
    )
}

export default ComboBox
