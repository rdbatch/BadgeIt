import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthProvider } from '../auth'
import { PublicCardPage } from './PublicCardPage'

// React Router can't express a literal `@` combined with a `:param` in one
// path segment, so `/@{slug}` vanity URLs are matched by a generic `/:slug`
// catch-all (see router.tsx) — mirrored here for the tests.
const testRoutes = [
  { path: '/p/:id', element: <PublicCardPage /> },
  { path: '/:slug', element: <PublicCardPage /> },
]

function renderPublicCard(id = 'abc123') {
  const router = createMemoryRouter(testRoutes, { initialEntries: [`/p/${id}`] })
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

function renderPublicCardBySlug(slug = 'ada-lovelace') {
  const router = createMemoryRouter(testRoutes, { initialEntries: [`/@${slug}`] })
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

describe('PublicCardPage', () => {
  it('maps every snake_case API field to the camelCase Profile shape', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'abc123',
          email: 'ada@example.com',
          display_name: 'Ada Lovelace',
          tagline: 'Countess of Computing',
          phone: '+1 555-0100',
          location: 'London, UK',
          pronouns: 'she/her',
          theme: 'light',
          display_email: true,
          links: [],
        }),
    })

    renderPublicCard()

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    })

    expect(screen.getByText('Countess of Computing')).toBeInTheDocument()
    expect(screen.getByText('London, UK')).toBeInTheDocument()
    expect(screen.getByText('(she/her)')).toBeInTheDocument()
    expect(screen.getByText('+1 555-0100')).toBeInTheDocument()
  })

  it('maps custom_theme (snake_case, nested text_muted) through to the rendered card', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'abc123',
          email: 'ada@example.com',
          display_name: 'Ada Lovelace',
          theme: 'custom',
          custom_theme: { bg: '#111111', text: '#222222', text_muted: '#333333', accent: '#444444' },
          display_email: true,
          links: [],
        }),
    })

    renderPublicCard()

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    })

    const card = screen.getByTestId('card-view')
    expect(card.style.getPropertyValue('--badgeit-bg')).toBe('#111111')
    expect(card.style.getPropertyValue('--badgeit-text-muted')).toBe('#333333')
  })

  it('shows the not-found state on a 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    renderPublicCard()

    await waitFor(() => {
      expect(screen.getByText('Card Not Found')).toBeInTheDocument()
    })
  })

  it('shows the not-found state for a catch-all segment with no @ prefix', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock

    const router = createMemoryRouter(testRoutes, { initialEntries: ['/random-typo'] })
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Card Not Found')).toBeInTheDocument()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches by @-prefixed slug when loaded via a vanity URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'abc123',
          slug: 'ada-lovelace',
          email: 'ada@example.com',
          display_name: 'Ada Lovelace',
          theme: 'light',
          display_email: true,
          links: [],
        }),
    })
    globalThis.fetch = fetchMock

    renderPublicCardBySlug('ada-lovelace')

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/profile/@ada-lovelace'),
    )
  })

  it('redirects from /p/:id to the vanity URL when the profile has a claimed slug', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'abc123',
          slug: 'ada-lovelace',
          email: 'ada@example.com',
          display_name: 'Ada Lovelace',
          theme: 'light',
          display_email: true,
          links: [],
        }),
    })

    const router = createMemoryRouter(testRoutes, { initialEntries: ['/p/abc123'] })
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    })

    expect(router.state.location.pathname).toBe('/@ada-lovelace')
  })

  it('does not redirect when loaded directly via a vanity URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'abc123',
          slug: 'ada-lovelace',
          email: 'ada@example.com',
          display_name: 'Ada Lovelace',
          theme: 'light',
          display_email: true,
          links: [],
        }),
    })

    const router = createMemoryRouter(testRoutes, { initialEntries: ['/@ada-lovelace'] })
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    })

    expect(router.state.location.pathname).toBe('/@ada-lovelace')
  })
})
