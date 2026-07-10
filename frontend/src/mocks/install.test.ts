import { installMocks } from './install'
import { MOCK_ID_TOKEN } from './handlers'

describe('installMocks', () => {
  const realFetch = window.fetch

  afterEach(() => {
    window.fetch = realFetch
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('intercepts profile API requests through window.fetch', async () => {
    installMocks()

    const res = await fetch('/api/profile/me', {
      headers: { Authorization: `Bearer ${MOCK_ID_TOKEN}` },
    })
    expect(res.status).toBe(200)
    const profile = await res.json()
    expect(profile.display_name).toBe('Ada Lovelace')
  })

  it('shows an on-screen mock-data badge', () => {
    installMocks()
    expect(document.body.textContent).toContain('MOCK DATA')
  })
})
