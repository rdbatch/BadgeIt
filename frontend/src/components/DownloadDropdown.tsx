import { useEffect, useRef, useState } from 'react'

export interface DownloadOption {
  label: string
  onSelect: () => void
}

interface DownloadDropdownProps {
  options: DownloadOption[]
  disabled?: boolean
  /** Tailwind text color class matching the active card theme. */
  themeTextClass: string
  /** Trigger button label. Defaults to "Download". */
  label?: string
}

/** Delay before closing on mouse-leave, so crossing the small gap between
 * the button and the menu (or a brief, unintentional flick off the menu)
 * doesn't snap the dropdown shut mid-hover. */
const CLOSE_DELAY_MS = 200

/**
 * A single "Download" trigger that opens a small menu of download formats
 * (QR code, 3D print, etc.) — keeps the action row from growing a new
 * top-level button every time a download type is added.
 *
 * Opens on hover for mouse users (with a short close delay so moving the
 * cursor into the menu doesn't close it), and falls back to click-to-toggle
 * for touch devices, which don't reliably fire hover events.
 */
export function DownloadDropdown({ options, disabled, themeTextClass, label = 'Download' }: DownloadDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearCloseTimeout() {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }

  function handleMouseEnter() {
    clearCloseTimeout()
    setIsOpen(true)
  }

  function handleMouseLeave() {
    clearCloseTimeout()
    closeTimeoutRef.current = setTimeout(() => setIsOpen(false), CLOSE_DELAY_MS)
  }

  useEffect(() => clearCloseTimeout, [])

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
    <div
      className="relative"
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`flex items-center gap-1.5 rounded-lg border border-current/20 px-4 py-3 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50 ${themeTextClass}`}
      >
        {label}
        <svg
          className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isOpen && (
        <div
          role="menu"
          aria-label="Download options"
          className="absolute z-10 mt-2 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              role="menuitem"
              onClick={() => {
                option.onSelect()
                setIsOpen(false)
              }}
              className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
