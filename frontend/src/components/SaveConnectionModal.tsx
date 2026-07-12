import { useEffect, useState, type FormEvent } from 'react'
import { getRuntimeConfig } from '../config/runtimeConfig'
import { useOverlayClose } from '../hooks/useOverlayClose'

interface SaveConnectionModalProps {
  isOpen: boolean
  onClose: () => void
  idToken: string
  prefill: {
    name: string
    photoUrl?: string
    sourceProfileId: string
  }
}

/**
 * Lets a signed-in viewer save the card they're looking at as a connection,
 * pre-filled with that profile's name/photo. Notes and an event tag (a
 * combobox — pick an existing event or type a new one, via a native
 * <datalist>) are the only fields the viewer fills in themselves.
 */
export function SaveConnectionModal({ isOpen, onClose, idToken, prefill }: SaveConnectionModalProps) {
  const [notes, setNotes] = useState('')
  const [event, setEvent] = useState('')
  const [existingEvents, setExistingEvents] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  // Reset per-open state and fetch the viewer's existing event tags so the
  // combobox can offer them, without ever loading the viewer's connections
  // list eagerly (this modal is the only place that needs it, and only
  // once opened).
  useEffect(() => {
    if (!isOpen) return
    setNotes('')
    setEvent('')
    setSaved(false)
    setErrorMessage('')

    fetch(`${getRuntimeConfig().apiBase}/api/connections`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Array<{ event?: string }>) => {
        const events = Array.from(
          new Set(data.map((c) => c.event).filter((e): e is string => Boolean(e))),
        ).sort()
        setExistingEvents(events)
      })
      .catch(() => {
        // Non-fatal — the combobox just won't suggest existing events.
      })
  }, [isOpen, idToken])

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

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setIsSaving(true)
    setErrorMessage('')

    try {
      const res = await fetch(`${getRuntimeConfig().apiBase}/api/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          name: prefill.name,
          photo_url: prefill.photoUrl,
          source_profile_id: prefill.sourceProfileId,
          notes: notes || undefined,
          event: event || undefined,
        }),
      })

      if (!res.ok) {
        throw new Error(`Save failed: ${res.status}`)
      }

      setSaved(true)
    } catch {
      setErrorMessage('Failed to save connection')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      {...overlayClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-connection-title"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="save-connection-title" className="text-lg font-bold text-gray-900">
            Save Connection
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close save connection modal"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {saved ? (
          <div>
            <p className="text-sm text-green-700" role="status">
              Saved {prefill.name} to your connections.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3">
            <div className="flex items-center gap-3">
              {prefill.photoUrl && (
                <img
                  src={prefill.photoUrl}
                  alt={`${prefill.name}'s profile photo`}
                  className="h-10 w-10 rounded-full object-cover"
                />
              )}
              <p className="font-medium text-gray-900">{prefill.name}</p>
            </div>

            <div>
              <label htmlFor="connection-event" className="block text-sm font-medium text-gray-700">
                Event <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <input
                id="connection-event"
                type="text"
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                list="save-connection-events"
                maxLength={100}
                placeholder="AWS re:Invent"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
              />
              <datalist id="save-connection-events">
                {existingEvents.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </datalist>
            </div>

            <div>
              <label htmlFor="connection-notes" className="block text-sm font-medium text-gray-700">
                Notes <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <textarea
                id="connection-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Follow up re: pricing"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
              />
            </div>

            {errorMessage && (
              <p className="text-sm text-red-600" role="alert">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={isSaving}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Connection'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
