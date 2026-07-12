import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthProvider } from '../auth'
import { PublicCardPage } from './PublicCardPage'

function renderPublicCard(id = 'abc123') {
  const router = createMemoryRouter(
    [{ path: '/p/:id', element: <PublicCardPage /> }],
    { initialEntries: [`/p/${id}`] },
  )
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
})
