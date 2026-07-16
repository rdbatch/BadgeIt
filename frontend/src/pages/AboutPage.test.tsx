import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthProvider } from '../auth'
import { AboutPage } from './AboutPage'

const SESSION_KEY = 'badgetag-auth-session'
const COLOR_SCHEME_KEY = 'badgetag-color-scheme'

function seedSession() {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      idToken: 'test-id-token',
      accessToken: 'test-access-token',
      email: 'test@example.com',
      expiresAt: Date.now() + 60 * 60 * 1000,
    }),
  )
}

function stubMatchMedia(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && prefersDark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

function renderAboutPage(initialEntries: string[], initialIndex: number) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <div>Landing page</div> },
      { path: '/edit', element: <div>Edit page</div> },
      { path: '/about', element: <AboutPage /> },
    ],
    { initialEntries, initialIndex },
  )
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

describe('AboutPage', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('renders the page', () => {
    renderAboutPage(['/about'], 0)
    expect(screen.getByTestId('about-page')).toBeInTheDocument()
  })

  it('navigates back to the previous page in history when Back is clicked', async () => {
    renderAboutPage(['/edit', '/about'], 1)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => {
      expect(screen.getByText('Edit page')).toBeInTheDocument()
    })
  })

  it('navigates back to whichever prior screen is in history, not a fixed route', async () => {
    renderAboutPage(['/', '/about'], 1)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => {
      expect(screen.getByText('Landing page')).toBeInTheDocument()
    })
  })
})

describe('AboutPage theme — signed out', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('defaults to light when the system has no dark preference', () => {
    stubMatchMedia(false)
    renderAboutPage(['/about'], 0)

    const main = screen.getByTestId('about-page')
    expect(main).toHaveClass('bg-white')
    expect(screen.getByLabelText('Switch to dark theme')).toBeInTheDocument()
  })

  it('defaults to dark when the system prefers dark', () => {
    stubMatchMedia(true)
    renderAboutPage(['/about'], 0)

    const main = screen.getByTestId('about-page')
    expect(main).toHaveClass('bg-gray-900')
    expect(screen.getByLabelText('Switch to light theme')).toBeInTheDocument()
  })

  it('toggles between light and dark when the sun/moon button is clicked', () => {
    stubMatchMedia(false)
    renderAboutPage(['/about'], 0)

    const main = screen.getByTestId('about-page')
    expect(main).toHaveClass('bg-white')

    fireEvent.click(screen.getByLabelText('Switch to dark theme'))
    expect(main).toHaveClass('bg-gray-900')
    expect(main).not.toHaveClass('bg-white')

    fireEvent.click(screen.getByLabelText('Switch to light theme'))
    expect(main).toHaveClass('bg-white')
  })

  it('persists the chosen color scheme across remounts', () => {
    stubMatchMedia(false)
    const { unmount } = renderAboutPage(['/about'], 0)

    fireEvent.click(screen.getByLabelText('Switch to dark theme'))
    expect(localStorage.getItem(COLOR_SCHEME_KEY)).toBe('dark')
    unmount()

    renderAboutPage(['/about'], 0)
    expect(screen.getByTestId('about-page')).toHaveClass('bg-gray-900')
  })
})

describe('AboutPage theme — signed in', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('applies the caller’s own card theme and hides the manual toggle', async () => {
    seedSession()
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ theme: 'ocean' }),
    })

    renderAboutPage(['/about'], 0)

    await waitFor(() => {
      expect(screen.getByTestId('about-page')).toHaveClass('bg-slate-800')
    })
    expect(screen.queryByLabelText('Switch to light theme')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Switch to dark theme')).not.toBeInTheDocument()
  })

  it('falls back to the light theme when the profile fetch fails', async () => {
    seedSession()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    renderAboutPage(['/about'], 0)

    await waitFor(() => {
      expect(screen.getByTestId('about-page')).toHaveClass('bg-white')
    })
  })
})
