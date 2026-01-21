import type { SelectHTMLAttributes } from 'react'
import { forwardRef } from 'react'

export interface SelectOption {
    value: string
    label: string
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
    label?: string
    options: SelectOption[]
    error?: string
}

/**
 * 通用下拉选择组件
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
    ({ label, options, error, className = '', ...props }, ref) => {
        return (
            <div className="flex flex-col gap-1">
                {label && (
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {label}
                    </label>
                )}
                <select
                    ref={ref}
                    className={`
                        px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600
                        bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${error ? 'border-red-500 focus:ring-red-500' : ''}
                        ${className}
                    `}
                    {...props}
                >
                    {options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
                {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
        )
    }
)

Select.displayName = 'Select'

export default Select
