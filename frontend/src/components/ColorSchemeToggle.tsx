import { SunIcon, MoonIcon } from './SocialIcons'
import type { ColorScheme } from '../hooks/useColorScheme'

interface ColorSchemeToggleProps {
  colorScheme: ColorScheme
  onToggle: () => void
  className?: string
}

/** Sun/moon button for signed-out pages to switch between light and dark. */
export function ColorSchemeToggle({ colorScheme, onToggle, className = '' }: ColorSchemeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={colorScheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-opacity hover:opacity-80 ${className}`}
    >
      {colorScheme === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
    </button>
  )
}
