import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth'
import { themes, getCustomThemeStyle, getCachedProfileTheme, setCachedProfileTheme } from '../constants/themes'
import { HeaderMenu } from '../components/HeaderMenu'
import { EditConnectionModal } from '../components/EditConnectionModal'
import { ChevronRightIcon, PencilIcon } from '../components/SocialIcons'
import { getRuntimeConfig } from '../config/runtimeConfig'
import { mapConnection, type Connection } from '../types/connection'
import type { CustomThemeColors, ThemeId } from '../types/profile'

const NO_EVENT_KEY = '__no_event__'

export function ConnectionsPage() {
  const { session, isAuthenticated, logout } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, navigate])

  const [connections, setConnections] = useState<Connection[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [event, setEvent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [profileId, setProfileId] = useState<string | null>(null)
  // Seeded from the last-known cached theme (rather than a hardcoded
  // 'light') so switching screens doesn't flash light before the profile
  // fetch below resolves.
  const [theme, setTheme] = useState<ThemeId>(() => getCachedProfileTheme()?.theme ?? 'light')
  const [customTheme, setCustomTheme] = useState<CustomThemeColors | undefined>(
    () => getCachedProfileTheme()?.customTheme,
  )

  // Accordions default to open — this tracks which ones the user has
  // explicitly collapsed, rather than which are open, so a newly-seen
  // event group (e.g. after adding the first connection) starts expanded
  // without needing an effect to "catch up" on initial render.
  const [closedAccordions, setClosedAccordions] = useState<Set<string>>(new Set())
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const handleUnauthorized = useCallback(() => {
    logout()
    navigate('/', { replace: true })
  }, [logout, navigate])

  const loadConnections = useCallback(async () => {
    if (!session?.idToken) return
    try {
      const res = await fetch(`${getRuntimeConfig().apiBase}/api/connections`, {
        headers: { Authorization: `Bearer ${session.idToken}` },
      })
      if (res.status === 401) {
        handleUnauthorized()
        return
      }
      if (res.ok) {
        const data = await res.json()
        setConnections(data.map(mapConnection))
      }
    } finally {
      setIsLoading(false)
    }
  }, [session?.idToken, handleUnauthorized])

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  // Apply the caller's own card theme so the connections page feels like
  // part of the same product, not a bare admin screen. A failed fetch (or
  // a user with no profile yet) simply falls back to the light theme.
  useEffect(() => {
    if (!session?.idToken) return

    fetch(`${getRuntimeConfig().apiBase}/api/profile/me`, {
      headers: { Authorization: `Bearer ${session.idToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            id?: string
            theme?: ThemeId
            custom_theme?: { bg: string; text: string; text_muted: string; accent: string }
          } | null,
        ) => {
          if (!data) return
          setProfileId(data.id ?? null)
          if (!data.theme) return
          const customTheme = data.custom_theme
            ? {
                bg: data.custom_theme.bg,
                text: data.custom_theme.text,
                textMuted: data.custom_theme.text_muted,
                accent: data.custom_theme.accent,
              }
            : undefined
          setTheme(data.theme)
          setCustomTheme(customTheme)
          setCachedProfileTheme(data.theme, customTheme)
        },
      )
      .catch(() => {
        // Non-fatal — page just uses the default light theme.
      })
  }, [session?.idToken])

  const activeTheme = themes[theme]

  const grouped = useMemo(() => {
    const map = new Map<string, Connection[]>()
    for (const c of connections) {
      const key = c.event ?? NO_EVENT_KEY
      const list = map.get(key) ?? []
      list.push(c)
      map.set(key, list)
    }
    const eventKeys = Array.from(map.keys())
      .filter((k) => k !== NO_EVENT_KEY)
      .sort()
    if (map.has(NO_EVENT_KEY)) eventKeys.push(NO_EVENT_KEY)
    return { map, eventKeys }
  }, [connections])

  function toggleAccordion(key: string) {
    setClosedAccordions((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const uniqueEvents = Array.from(
    new Set(connections.map((c) => c.event).filter((e): e is string => Boolean(e))),
  ).sort()

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    setIsSaving(true)
    setErrorMessage('')
    try {
      const res = await fetch(`${getRuntimeConfig().apiBase}/api/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.idToken}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          notes: notes || undefined,
          event: event || undefined,
        }),
      })

      if (res.status === 401) {
        handleUnauthorized()
        return
      }
      if (!res.ok) {
        throw new Error(`Save failed: ${res.status}`)
      }

      setName('')
      setNotes('')
      setEvent('')
      await loadConnections()
    } catch {
      setErrorMessage('Failed to save connection')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const previous = connections
    setConnections((prev) => prev.filter((c) => c.id !== id))
    setPendingDeleteId(null)

    try {
      const res = await fetch(`${getRuntimeConfig().apiBase}/api/connections/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session?.idToken}` },
      })
      if (res.status === 401) {
        handleUnauthorized()
        return
      }
      if (!res.ok && res.status !== 204) {
        throw new Error(`Delete failed: ${res.status}`)
      }
    } catch {
      setConnections(previous)
      setErrorMessage('Failed to delete connection')
    }
  }

  function handleConnectionSaved(updated: Connection) {
    setConnections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  if (!isAuthenticated || !session) {
    return null
  }

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading your connections...</p>
      </main>
    )
  }

  return (
    <main
      className={`min-h-screen px-4 py-8 transition-colors duration-300 ${activeTheme.bg}`}
      style={getCustomThemeStyle({ theme, customTheme })}
    >
      <div className="mx-auto max-w-lg">
        <div className="mb-8 flex items-center justify-between">
          <a
            href="/edit"
            className={`rounded-lg border border-current/20 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80 ${activeTheme.text}`}
          >
            Edit Your Card
          </a>
          <HeaderMenu
            themeTextClass={activeTheme.text}
            items={[
              {
                label: 'View Your Card',
                onClick: () => window.open(`/p/${profileId}`, '_blank'),
                disabled: !profileId,
              },
              {
                label: 'About',
                onClick: () => navigate('/about'),
              },
              {
                label: 'Sign Out',
                onClick: logout,
              },
            ]}
          />
        </div>

        <h1 className={`mb-6 text-center text-2xl font-bold ${activeTheme.text}`}>
          My Connections
        </h1>

        <form
          onSubmit={handleAdd}
          className="mb-8 space-y-3 rounded-lg border border-gray-200 bg-white p-4"
          aria-labelledby="add-connection-heading"
        >
          <h2 id="add-connection-heading" className="text-sm font-medium text-gray-900">
            Add a connection
          </h2>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            aria-label="Name"
            required
            maxLength={100}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
          />
          <input
            type="text"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            placeholder="Event (optional)"
            aria-label="Event"
            list="connection-events"
            maxLength={100}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
          />
          <datalist id="connection-events">
            {uniqueEvents.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </datalist>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            aria-label="Notes"
            maxLength={1000}
            rows={2}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
          />
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
            {isSaving ? 'Saving...' : 'Add Connection'}
          </button>
        </form>

        {connections.length === 0 ? (
          <p className={`text-center text-sm ${activeTheme.textMuted}`}>
            No connections yet. Add one above, or save people you meet directly from their card.
          </p>
        ) : (
          <div className="space-y-3">
            {grouped.eventKeys.map((key) => {
              const items = grouped.map.get(key) ?? []
              const isOpen = !closedAccordions.has(key)
              const label = key === NO_EVENT_KEY ? 'No Event' : key

              return (
                <div key={key} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                  <button
                    type="button"
                    onClick={() => toggleAccordion(key)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50"
                  >
                    <span className="flex items-center gap-2 font-medium text-gray-900">
                      {label}
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {items.length}
                      </span>
                    </span>
                    <ChevronRightIcon
                      className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    />
                  </button>

                  {isOpen && (
                    <ul className="divide-y divide-gray-100 border-t border-gray-100">
                      {items.map((c) => {
                        const clickable = Boolean(c.sourceProfileId)
                        return (
                          <li key={c.id} className="flex items-start gap-3 p-4">
                            <button
                              type="button"
                              disabled={!clickable}
                              onClick={() => {
                                if (c.sourceProfileId) {
                                  window.open(`/p/${c.sourceProfileId}`, '_blank')
                                }
                              }}
                              className={`flex min-w-0 flex-1 items-start gap-3 text-left ${
                                clickable ? 'cursor-pointer' : 'cursor-default'
                              }`}
                            >
                              {c.photoUrl ? (
                                <img
                                  src={c.photoUrl}
                                  alt={`${c.name}'s profile photo`}
                                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                                />
                              ) : (
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-500">
                                  {c.name.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-gray-900">{c.name}</p>
                                {c.notes && (
                                  <p className="mt-1 truncate text-sm text-gray-600">{c.notes}</p>
                                )}
                              </div>
                            </button>

                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setEditingConnection(c)}
                                aria-label={`Edit connection with ${c.name}`}
                                className="rounded p-1 text-gray-400 hover:text-gray-600"
                              >
                                <PencilIcon className="h-4 w-4" />
                              </button>

                              {pendingDeleteId === c.id ? (
                                <div className="flex items-center gap-1 text-xs">
                                  <span className="text-gray-500">Delete?</span>
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(c.id)}
                                    className="font-medium text-red-600 hover:text-red-800"
                                  >
                                    Yes
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPendingDeleteId(null)}
                                    className="font-medium text-gray-500 hover:text-gray-700"
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setPendingDeleteId(c.id)}
                                  aria-label={`Delete connection with ${c.name}`}
                                  className="rounded p-1 text-red-400 hover:text-red-600"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editingConnection && (
        <EditConnectionModal
          isOpen={true}
          onClose={() => setEditingConnection(null)}
          idToken={session.idToken ?? ''}
          connection={editingConnection}
          existingEvents={uniqueEvents}
          onSaved={handleConnectionSaved}
        />
      )}
    </main>
  )
}
