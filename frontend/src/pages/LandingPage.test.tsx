import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthProvider } from '../auth'
import { LandingPage } from './LandingPage'

const SESSION_KEY = 'badgetag-auth-session'
const COLOR_SCHEME_KEY = 'badgetag-color-scheme'

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

function renderLandingPage() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <LandingPage /> },
      { path: '/about', element: <div>About page</div> },
      { path: '/edit', element: <div>Edit page</div> },
    ],
    { initialEntries: ['/'] },
  )
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

describe('LandingPage', () => {
  it('links to the about page', () => {
    renderLandingPage()
    expect(screen.getByRole('link', { name: 'About BadgeTag' })).toHaveAttribute('href', '/about')
  })
})

describe('LandingPage already-authenticated redirect', () => {
  afterEach(() => {
    localStorage.clear()
  })

  // Regression test: the redirect used to call navigate() synchronously
  // during render (rather than in an effect), which is undefined behavior
  // in React and rendered a blank page in Safari specifically whenever a
  // session was already present on mount.
  it('redirects to /edit without crashing when a session already exists', async () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        idToken: 'test-id-token',
        accessToken: 'test-access-token',
        email: 'test@example.com',
        expiresAt: Date.now() + 60 * 60 * 1000,
      }),
    )

    renderLandingPage()

    await waitFor(() => {
      expect(screen.getByText('Edit page')).toBeInTheDocument()
    })
  })
})

describe('LandingPage theme', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('defaults to light when the system has no dark preference', () => {
    stubMatchMedia(false)
    renderLandingPage()

    expect(document.querySelector('main')).toHaveClass('bg-white')
    expect(screen.getByLabelText('Switch to dark theme')).toBeInTheDocument()
  })

  it('defaults to dark when the system prefers dark', () => {
    stubMatchMedia(true)
    renderLandingPage()

    expect(document.querySelector('main')).toHaveClass('bg-gray-900')
    expect(screen.getByLabelText('Switch to light theme')).toBeInTheDocument()
  })

  it('toggles between light and dark when the sun/moon button is clicked', () => {
    stubMatchMedia(false)
    renderLandingPage()

    const main = document.querySelector('main')
    fireEvent.click(screen.getByLabelText('Switch to dark theme'))
    expect(main).toHaveClass('bg-gray-900')

    fireEvent.click(screen.getByLabelText('Switch to light theme'))
    expect(main).toHaveClass('bg-white')
  })

  it('shares the persisted color scheme with the about page', () => {
    stubMatchMedia(false)
    renderLandingPage()

    fireEvent.click(screen.getByLabelText('Switch to dark theme'))
    expect(localStorage.getItem(COLOR_SCHEME_KEY)).toBe('dark')
  })
})
