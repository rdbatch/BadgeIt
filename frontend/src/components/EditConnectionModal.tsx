import { useEffect, useState, type FormEvent } from 'react'
import { getRuntimeConfig } from '../config/runtimeConfig'
import { mapConnection, type Connection } from '../types/connection'
import { useOverlayClose } from '../hooks/useOverlayClose'

interface EditConnectionModalProps {
  isOpen: boolean
  onClose: () => void
  idToken: string
  connection: Connection
  existingEvents: string[]
  onSaved: (updated: Connection) => void
}

/**
 * Lets the owner edit a saved connection's name, notes, and event tag.
 * Photo and source profile link are set once at save time and not
 * editable here — see the backend's ConnectionUpdateRequest.
 */
export function EditConnectionModal({
  isOpen,
  onClose,
  idToken,
  connection,
  existingEvents,
  onSaved,
}: EditConnectionModalProps) {
  const [name, setName] = useState(connection.name)
  const [notes, setNotes] = useState(connection.notes ?? '')
  const [event, setEvent] = useState(connection.event ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setName(connection.name)
    setNotes(connection.notes ?? '')
    setEvent(connection.event ?? '')
    setErrorMessage('')
  }, [isOpen, connection])

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
    if (!name.trim()) return

    setIsSaving(true)
    setErrorMessage('')

    try {
      const res = await fetch(`${getRuntimeConfig().apiBase}/api/connections/${connection.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          notes: notes || undefined,
          event: event || undefined,
        }),
      })

      if (!res.ok) {
        throw new Error(`Save failed: ${res.status}`)
      }

      const data = await res.json()
      onSaved(mapConnection(data))
      onClose()
    } catch {
      setErrorMessage('Failed to save changes')
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
      aria-labelledby="edit-connection-title"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="edit-connection-title" className="text-lg font-bold text-gray-900">
            Edit Connection
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close edit connection modal"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label htmlFor="edit-connection-name" className="block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              id="edit-connection-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="edit-connection-event" className="block text-sm font-medium text-gray-700">
              Event <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <input
              id="edit-connection-event"
              type="text"
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              list="edit-connection-events"
              maxLength={100}
              placeholder="AWS re:Invent"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
            />
            <datalist id="edit-connection-events">
              {existingEvents.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="edit-connection-notes" className="block text-sm font-medium text-gray-700">
              Notes <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <textarea
              id="edit-connection-notes"
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
            disabled={isSaving || !name.trim()}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  )
}
