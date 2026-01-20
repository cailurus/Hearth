interface SpinnerProps {
    size?: 'sm' | 'md' | 'lg'
    className?: string
}

const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-3',
}

/**
 * 加载动画组件
 */
export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
    return (
        <div
            className={`animate-spin rounded-full border-t-transparent border-blue-500 ${sizeClasses[size]} ${className}`}
        />
    )
}

export default Spinner
