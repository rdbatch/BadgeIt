import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import type { AuthSession } from './service'
import {
  getSession,
  clearSession as clearAuthSession,
  isSessionExpiring,
  refreshSession as renewSession,
} from './service'
import { AuthContext, type AuthContextValue } from './authContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => getSession())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const syncSession = useCallback(() => {
    setSession(getSession())
  }, [])

  const logout = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    clearAuthSession()
    setSession(null)
  }, [])

  // Proactively renews the ID/access token shortly before it expires, so a
  // long-lived tab never hits a 401 from an expired token. If the refresh
  // token itself is gone/expired/revoked, log the user out so the app
  // bounces them back to the front page instead of silently failing later.
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (!session) return

    // Sessions without a refresh token (e.g. persisted by an older build,
    // or in tests) can't be silently renewed. Leave them alone here — a
    // real 401 from the API will still trigger the page-level logout path.
    if (!session.refreshToken) return

    const scheduleRefresh = (current: AuthSession) => {
      const delay = Math.max(current.expiresAt - Date.now() - REFRESH_SKEW_MS, 0)
      timerRef.current = setTimeout(() => {
        renewSession()
          .then((renewed) => {
            setSession(renewed)
            scheduleRefresh(renewed)
          })
          .catch(() => logout())
      }, delay)
    }

    if (isSessionExpiring(session)) {
      renewSession()
        .then((renewed) => {
          setSession(renewed)
          scheduleRefresh(renewed)
        })
        .catch(() => logout())
    } else {
      scheduleRefresh(session)
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs when the session identity changes (login/logout/renew)
  }, [session?.expiresAt, session?.refreshToken, logout])

  const value: AuthContextValue = {
    session,
    isAuthenticated: session !== null,
    syncSession,
    logout,
  }

  return <AuthContext value={value}>{children}</AuthContext>
}

/** Mirrors the skew used in service.ts's isSessionExpiring, for scheduling. */
const REFRESH_SKEW_MS = 60_000
