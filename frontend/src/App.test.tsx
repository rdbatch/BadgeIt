import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthProvider } from './auth'
import { LandingPage } from './pages/LandingPage'
import { EditProfilePage } from './pages/EditProfilePage'
import { PublicCardPage } from './pages/PublicCardPage'

const routes = [
  { path: '/', element: <LandingPage /> },
  { path: '/edit', element: <EditProfilePage /> },
  { path: '/p/:id', element: <PublicCardPage /> },
]

function renderWithRouter(initialEntry: string) {
  const router = createMemoryRouter(routes, {
    initialEntries: [initialEntry],
  })
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

describe('Router', () => {
  it('renders the landing page at /', () => {
    renderWithRouter('/')
    expect(screen.getByText('BadgeIt')).toBeInTheDocument()
    expect(
      screen.getByText('Your lightweight digital business card'),
    ).toBeInTheDocument()
  })

  it('renders email input on landing page', () => {
    renderWithRouter('/')
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument()
  })

  it('edit page redirects to landing when not authenticated', () => {
    renderWithRouter('/edit')
    // Should redirect to landing page since there's no auth session
    expect(screen.getByText('BadgeIt')).toBeInTheDocument()
  })

  it('shows loading state on public card page', () => {
    renderWithRouter('/p/abc123')
    expect(screen.getByText('Loading card...')).toBeInTheDocument()
  })

  it('shows not found after fetch fails with 404', async () => {
    // Mock fetch to return 404
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    })

    renderWithRouter('/p/nonexistent')

    await waitFor(() => {
      expect(screen.getByText('Card Not Found')).toBeInTheDocument()
    })
    expect(screen.getByText('Create your own card')).toBeInTheDocument()

    globalThis.fetch = originalFetch
  })

  it('renders card view after successful fetch', async () => {
    const mockProfile = {
      id: 'abc123',
      email: 'test@example.com',
      display_name: 'Test User',
      tagline: 'Engineer',
      theme: 'light',
      links: [],
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockProfile),
    })

    renderWithRouter('/p/abc123')

    await waitFor(() => {
      expect(screen.getByText('Test User')).toBeInTheDocument()
    })
    expect(screen.getByText('test@example.com')).toBeInTheDocument()

    globalThis.fetch = originalFetch
  })
})

describe('Landing Page Auth UI', () => {
  it('has email input with correct type and autocomplete', () => {
    renderWithRouter('/')
    const input = screen.getByLabelText('Email address')
    expect(input).toHaveAttribute('type', 'email')
    expect(input).toHaveAttribute('autocomplete', 'email')
  })

  it('submit button is disabled when email is empty', () => {
    renderWithRouter('/')
    const button = screen.getByRole('button', { name: 'Get started' })
    expect(button).toBeDisabled()
  })
})
