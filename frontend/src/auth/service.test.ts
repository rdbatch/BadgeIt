import { isSessionExpiring, getSession, clearSession, refreshSession, type AuthSession } from './service'

const SESSION_KEY = 'badgeit-auth-session'

function seedSession(overrides: Partial<AuthSession> = {}): AuthSession {
  const session: AuthSession = {
    idToken: 'id-token',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    email: 'test@example.com',
    ...overrides,
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

describe('isSessionExpiring', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns false when the token has plenty of time left', () => {
    const session = seedSession({ expiresAt: Date.now() + 60 * 60 * 1000 })
    expect(isSessionExpiring(session)).toBe(false)
  })

  it('returns true once within the refresh skew window', () => {
    const session = seedSession({ expiresAt: Date.now() + 30_000 })
    expect(isSessionExpiring(session)).toBe(true)
  })

  it('returns true once the token has already expired', () => {
    const session = seedSession({ expiresAt: Date.now() - 1000 })
    expect(isSessionExpiring(session)).toBe(true)
  })
})

describe('refreshSession', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('throws when there is no session', async () => {
    clearSession()
    await expect(refreshSession()).rejects.toThrow('No refresh token available')
  })

  it('throws when the session has no refresh token', async () => {
    seedSession({ refreshToken: undefined })
    await expect(refreshSession()).rejects.toThrow('No refresh token available')
  })
})

describe('getSession', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns null when nothing is stored', () => {
    expect(getSession()).toBeNull()
  })

  it('round-trips a stored session, including the refresh token and expiry', () => {
    const seeded = seedSession()
    expect(getSession()).toEqual(seeded)
  })

  it('returns null for corrupted storage instead of throwing', () => {
    localStorage.setItem(SESSION_KEY, 'not-json')
    expect(getSession()).toBeNull()
  })
})
