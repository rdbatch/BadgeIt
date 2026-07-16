import { useEffect, useRef, useState } from 'react'
import {
  listPasskeys,
  deletePasskey,
  startPasskeyRegistration,
  completePasskeyRegistration,
  type WebAuthnCredentialDescription,
} from '../auth'
import { useOverlayClose } from '../hooks/useOverlayClose'

interface ManagePasskeysModalProps {
  isOpen: boolean
  onClose: () => void
}

/** WebAuthnCredentialDescription with CredentialId narrowed to required —
 * Cognito always populates it in practice, but the SDK types it optional. */
type Passkey = WebAuthnCredentialDescription & { CredentialId: string }

function isUserCancellation(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotAllowedError'
}

function toPasskeys(credentials: WebAuthnCredentialDescription[]): Passkey[] {
  return credentials.filter((c): c is Passkey => c.CredentialId !== undefined)
}

/**
 * Lets a signed-in user register, list, and remove passkeys on their
 * account. Structured like QRModal (isOpen/onClose, useOverlayClose for
 * backdrop click, and the same inline Escape-key/focus-trap handling —
 * this codebase doesn't extract that into a shared hook, so this modal
 * doesn't either).
 */
export function ManagePasskeysModal({ isOpen, onClose }: ManagePasskeysModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [error, setError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setError('')
    setConfirmDeleteId(null)
    setIsLoading(true)
    listPasskeys()
      .then((credentials) => setPasskeys(toPasskeys(credentials)))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load passkeys')
      })
      .finally(() => setIsLoading(false))
  }, [isOpen])

  // Focus trap and ESC key handling — copied from QRModal, this codebase's
  // existing pattern for this (not extracted as a shared hook).
  useEffect(() => {
    if (!isOpen) return

    previousFocusRef.current = document.activeElement as HTMLElement

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    const firstButton = modalRef.current?.querySelector<HTMLElement>('button')
    firstButton?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [isOpen, onClose])

  const overlayClose = useOverlayClose(onClose)

  if (!isOpen) return null

  async function handleAdd() {
    setError('')
    setIsAdding(true)
    try {
      const options = await startPasskeyRegistration()
      const credential = await navigator.credentials.create(options)
      if (!(credential instanceof PublicKeyCredential)) {
        throw new Error('Passkey creation did not return a credential')
      }
      await completePasskeyRegistration(credential)
      setPasskeys(toPasskeys(await listPasskeys()))
    } catch (err: unknown) {
      const message = isUserCancellation(err)
        ? 'Passkey setup was cancelled.'
        : err instanceof Error
          ? err.message
          : 'Failed to add passkey'
      setError(message)
    } finally {
      setIsAdding(false)
    }
  }

  async function handleConfirmDelete(credentialId: string) {
    setError('')
    setDeletingId(credentialId)
    try {
      await deletePasskey(credentialId)
      setPasskeys(toPasskeys(await listPasskeys()))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove passkey')
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      {...overlayClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="passkeys-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 id="passkeys-modal-title" className="text-lg font-bold text-gray-900">
            Manage Passkeys
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close passkeys modal"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <p className="mb-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {isLoading ? (
          <p className="py-4 text-center text-sm text-gray-500">Loading...</p>
        ) : passkeys.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-500">No passkeys registered yet.</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {passkeys.map((passkey) => (
              <li
                key={passkey.CredentialId}
                className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {passkey.FriendlyCredentialName ?? 'Passkey'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {passkey.AuthenticatorAttachment === 'platform' ? 'This device' : 'Security key'}
                    {passkey.CreatedAt &&
                      ` · Added ${new Date(passkey.CreatedAt).toLocaleDateString()}`}
                  </p>
                </div>
                {confirmDeleteId === passkey.CredentialId ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleConfirmDelete(passkey.CredentialId)}
                      disabled={deletingId === passkey.CredentialId}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      {deletingId === passkey.CredentialId ? 'Removing...' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(passkey.CredentialId)}
                    className="shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    aria-label={`Remove ${passkey.FriendlyCredentialName ?? 'passkey'}`}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={handleAdd}
          disabled={isAdding}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isAdding ? 'Adding passkey...' : 'Add a passkey'}
        </button>
      </div>
    </div>
  )
}
