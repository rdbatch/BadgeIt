import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthProvider } from '../auth'
import { EditProfilePage } from './EditProfilePage'

const SESSION_KEY = 'badgeit-auth-session'

function seedSession() {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      idToken: 'test-id-token',
      accessToken: 'test-access-token',
      email: 'test@example.com',
      // Far in the future and with no refresh token so the AuthProvider's
      // proactive-refresh effect is a no-op in these tests.
      expiresAt: Date.now() + 60 * 60 * 1000,
    }),
  )
}

function renderEditPage() {
  const router = createMemoryRouter(
    [
      { path: '/edit', element: <EditProfilePage /> },
      { path: '/', element: <div>Landing page</div> },
    ],
    { initialEntries: ['/edit'] },
  )
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

describe('EditProfilePage dynamic theming', () => {
  beforeEach(() => {
    seedSession()

    // No existing profile — GET returns a non-ok response so the form
    // starts blank rather than waiting on real data.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    })
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('applies the default light theme background on load', async () => {
    renderEditPage()

    await waitFor(() => {
      expect(screen.getByText('Edit Your Card')).toBeInTheDocument()
    })

    const main = screen.getByText('Edit Your Card').closest('main')
    expect(main).toHaveClass('bg-white')
  })

  it('updates the page background immediately when a theme is clicked', async () => {
    renderEditPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select Dark theme' })).toBeInTheDocument()
    })

    const main = screen.getByText('Edit Your Card').closest('main')
    expect(main).toHaveClass('bg-white')

    fireEvent.click(screen.getByRole('button', { name: 'Select Dark theme' }))

    expect(main).toHaveClass('bg-gray-900')
    expect(main).not.toHaveClass('bg-white')
  })

  it('updates heading text color to match the selected theme', async () => {
    renderEditPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select Ocean theme' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Select Ocean theme' }))

    const heading = screen.getByText('Edit Your Card')
    expect(heading).toHaveClass('text-sky-100')
  })
})

describe('EditProfilePage session expiry', () => {
  afterEach(() => {
    sessionStorage.clear()
  })

  it('clears the session and bounces to the front page when save returns 401', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        // Initial GET /api/profile/me
        return Promise.resolve({ ok: false, status: 404 })
      }
      // Save PUT — simulate an expired token
      return Promise.resolve({ ok: false, status: 401 })
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Landing page')).toBeInTheDocument()
    })

    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
})

describe('EditProfilePage /api/profile/me', () => {
  afterEach(() => {
    sessionStorage.clear()
  })

  it('fetches its own profile from the authenticated /me endpoint, not a client-computed id', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByText('Edit Your Card')).toBeInTheDocument()
    })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/profile/me',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-id-token' }),
      }),
    )
  })

  it('populates the form and enables the QR/Preview buttons from the /me response', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'a1b2c3d4e5f6',
          email: 'test@example.com',
          display_name: 'Ada Lovelace',
          tagline: 'Engineer',
          phone: '',
          theme: 'light',
          display_email: true,
          links: [],
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        }),
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'QR Code' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
  })

  it('disables QR/Preview until a first save assigns a profile id for a new user', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        // Initial GET /api/profile/me — no profile yet.
        return Promise.resolve({ ok: false, status: 404 })
      }
      // Save PUT — backend assigns a random id on first save.
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'f6e5d4c3b2a1',
            email: 'test@example.com',
            theme: 'light',
            display_email: true,
            links: [],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          }),
      })
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'QR Code' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'QR Code' })).toBeEnabled()
    })
  })
})

