import { Cog } from 'lucide-react'

function UserIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
                d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.418 0-8 2.015-8 4.5V20h16v-1.5C20 16.015 16.418 14 12 14Z"
                fill="currentColor"
                opacity="0.9"
            />
        </svg>
    )
}

export interface HeaderProps {
    isAdmin: boolean
    onSettingsClick: () => void
    onLoginClick: () => void
    settingsTitle?: string
    loginTitle?: string
}

/**
 * Top-right header with settings/login button
 */
export function Header({
    isAdmin,
    onSettingsClick,
    onLoginClick,
    settingsTitle = 'Settings',
    loginTitle = 'Login',
}: HeaderProps) {
    return (
        <div className="fixed right-4 top-4 z-20 flex items-center gap-2">
            {isAdmin ? (
                <button
                    onClick={onSettingsClick}
                    className="p-1.5 text-white/90 transition-colors hover:text-white"
                    aria-label="settings"
                    title={settingsTitle}
                >
                    <Cog className="h-5 w-5" />
                </button>
            ) : (
                <button
                    onClick={onLoginClick}
                    className="p-1.5 text-white/90 transition-colors hover:text-white"
                    aria-label="user"
                    title={loginTitle}
                >
                    <UserIcon />
                </button>
            )}
        </div>
    )
}

export default Header
