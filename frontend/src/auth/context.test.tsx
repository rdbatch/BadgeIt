import { render, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from './index'
import * as service from './service'

const SESSION_KEY = 'badgeit-auth-session'

function seedSession(expiresInMs: number) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      idToken: 'id-token',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + expiresInMs,
      email: 'test@example.com',
    }),
  )
}

function Probe() {
  const { isAuthenticated, session } = useAuth()
  return (
    <div>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <span data-testid="token">{session?.idToken ?? 'none'}</span>
    </div>
  )
}

describe('AuthProvider proactive token refresh', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('logs the user out when the token is already expiring and refresh fails', async () => {
    seedSession(0)
    vi.spyOn(service, 'refreshSession').mockRejectedValue(new Error('refresh token expired'))

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('authed')).toHaveTextContent('false')
    })
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('adopts the renewed session when refresh succeeds', async () => {
    seedSession(0)
    vi.spyOn(service, 'refreshSession').mockResolvedValue({
      idToken: 'new-id-token',
      accessToken: 'new-access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      email: 'test@example.com',
    })

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('token')).toHaveTextContent('new-id-token')
    })
    expect(screen.getByTestId('authed')).toHaveTextContent('true')
  })

  it('does not attempt to refresh a session with no refresh token', async () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        idToken: 'id-token',
        accessToken: 'access-token',
        expiresAt: Date.now() - 1000,
        email: 'test@example.com',
      }),
    )
    const spy = vi.spyOn(service, 'refreshSession')

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('authed')).toHaveTextContent('true')
    })
    expect(spy).not.toHaveBeenCalled()
  })
})
