import { useEffect, useState } from 'react'
import type { CustomThemeColors } from '../types/profile'
import { useOverlayClose } from '../hooks/useOverlayClose'

interface CustomThemeModalProps {
  isOpen: boolean
  onClose: () => void
  initialColors: CustomThemeColors
  onApply: (colors: CustomThemeColors) => void
}

export function CustomThemeModal({ isOpen, onClose, initialColors, onApply }: CustomThemeModalProps) {
  const [colors, setColors] = useState<CustomThemeColors>(initialColors)

  useEffect(() => {
    if (isOpen) setColors(initialColors)
  }, [isOpen, initialColors])

  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const overlayClose = useOverlayClose(onClose)

  if (!isOpen) return null

  function updateColor(key: keyof CustomThemeColors, value: string) {
    setColors((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      {...overlayClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-theme-modal-title"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="custom-theme-modal-title" className="text-lg font-bold text-gray-900">
            Custom Theme Colors
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close custom theme modal"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          <ColorField label="Background" value={colors.bg} onChange={(v) => updateColor('bg', v)} />
          <ColorField label="Text" value={colors.text} onChange={(v) => updateColor('text', v)} />
          <ColorField
            label="Muted Text"
            value={colors.textMuted}
            onChange={(v) => updateColor('textMuted', v)}
          />
          <ColorField label="Accent" value={colors.accent} onChange={(v) => updateColor('accent', v)} />
        </div>

        {/* Live preview */}
        <div
          className="mt-4 rounded-lg border border-gray-200 p-4 text-center"
          style={{ backgroundColor: colors.bg }}
        >
          <p style={{ color: colors.text }} className="font-bold">
            Preview Name
          </p>
          <p style={{ color: colors.textMuted }} className="text-sm">
            Tagline preview
          </p>
          <p style={{ color: colors.accent }} className="text-sm">
            Accent link
          </p>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => {
              onApply(colors)
              onClose()
            }}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm font-medium text-gray-700">
      {label}
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-12 cursor-pointer rounded border border-gray-300"
          aria-label={`${label} color`}
        />
        <span className="w-16 text-right font-mono text-xs text-gray-500">{value}</span>
      </span>
    </label>
  )
}
