import { useEffect, useRef, useState } from 'react'
import { MenuIcon } from './SocialIcons'

export interface HeaderMenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
}

interface HeaderMenuProps {
  items: HeaderMenuItem[]
  themeTextClass: string
}

/**
 * A hamburger-triggered dropdown for secondary page actions (sign out,
 * import, view card, etc.) — keeps the header from growing a new
 * top-level button every time an action is added. Click-to-toggle only
 * (no hover), closes on outside click or Escape.
 */
export function HeaderMenu({ items, themeTextClass }: HeaderMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="More options"
        className={`flex h-10 w-10 items-center justify-center rounded-lg border border-current/20 transition-opacity hover:opacity-80 ${themeTextClass}`}
      >
        <MenuIcon className="h-5 w-5" />
      </button>
      {isOpen && (
        <div
          role="menu"
          aria-label="More options"
          className="absolute right-0 z-10 mt-2 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.onClick()
                setIsOpen(false)
              }}
              className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
