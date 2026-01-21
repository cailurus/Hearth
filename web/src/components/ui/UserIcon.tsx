/**
 * 用户图标组件
 */

interface UserIconProps {
    size?: number
}

export function UserIcon({ size = 18 }: UserIconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
                d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.418 0-8 2.015-8 4.5V20h16v-1.5C20 16.015 16.418 14 12 14Z"
                fill="currentColor"
                opacity="0.9"
            />
        </svg>
    )
}
