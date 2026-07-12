import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthProvider } from '../auth'
import { ConnectionsPage } from './ConnectionsPage'

const SESSION_KEY = 'badgeit-auth-session'

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

function renderConnectionsPage() {
  const router = createMemoryRouter(
    [
      { path: '/connections', element: <ConnectionsPage /> },
      { path: '/', element: <div>Landing page</div> },
      { path: '/about', element: <div>About page</div> },
    ],
    { initialEntries: ['/connections'] },
  )
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

describe('ConnectionsPage', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('redirects to the landing page when not authenticated', async () => {
    renderConnectionsPage()
    await waitFor(() => {
      expect(screen.getByText('Landing page')).toBeInTheDocument()
    })
  })

  it('renders existing connections from the API', async () => {
    seedSession()
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            id: 'conn1',
            name: 'Grace Hopper',
            event: 'AWS re:Invent',
            notes: 'Follow up re: COBOL',
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
    })

    renderConnectionsPage()

    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    })
    // "AWS re:Invent" is now the accordion group heading (also appears
    // invisibly as a <datalist> option for the event combobox).
    expect(screen.getAllByText('AWS re:Invent').length).toBeGreaterThan(0)
    const list = within(screen.getByRole('list'))
    expect(list.getByText('Follow up re: COBOL')).toBeInTheDocument()
  })

  it('shows an empty state when there are no connections', async () => {
    seedSession()
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    })

    renderConnectionsPage()

    await waitFor(() => {
      expect(screen.getByText(/No connections yet/)).toBeInTheDocument()
    })
  })

  it('adds a connection via the manual entry form', async () => {
    seedSession()

    // Stateful mock: GET returns whatever POST has "saved" so far — both
    // requests hit fetch with no explicit `method` distinguishing GET, so
    // the mock must actually track state rather than branch on shape.
    let serverConnections: Array<Record<string, unknown>> = []
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        const created = { id: 'conn1', created_at: '2024-01-01T00:00:00Z', ...body }
        serverConnections = [created, ...serverConnections]
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(created) })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(serverConnections),
      })
    })

    renderConnectionsPage()

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'AWS re:Invent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Connection' }))

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    })

    const postCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, init]) => init?.method === 'POST',
    )
    expect(postCall).toBeDefined()
    const body = JSON.parse(postCall![1].body as string)
    expect(body.name).toBe('Ada Lovelace')
    expect(body.event).toBe('AWS re:Invent')
  })

  it('deletes a connection after confirming', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, status: 204 })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            { id: 'conn1', name: 'Grace Hopper', created_at: '2024-01-01T00:00:00Z' },
          ]),
      })
    })

    renderConnectionsPage()

    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete connection with Grace Hopper' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))

    await waitFor(() => {
      expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument()
    })

    const deleteCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, init]) => init?.method === 'DELETE',
    )
    expect(deleteCall).toBeDefined()
    expect(deleteCall![0]).toContain('/api/connections/conn1')
  })

  it('cancels a pending delete without calling the API', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          { id: 'conn1', name: 'Grace Hopper', created_at: '2024-01-01T00:00:00Z' },
        ]),
    })

    renderConnectionsPage()

    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete connection with Grace Hopper' }))
    fireEvent.click(screen.getByRole('button', { name: 'No' }))

    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === 'DELETE',
      ),
    ).toBeUndefined()
  })

  it('groups connections with no event under a "No Event" accordion', async () => {
    seedSession()
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          { id: 'conn1', name: 'Grace Hopper', created_at: '2024-01-01T00:00:00Z' },
        ]),
    })

    renderConnectionsPage()

    await waitFor(() => {
      expect(screen.getByText('No Event')).toBeInTheDocument()
    })
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
  })

  it('opens the edit modal from the pencil button and saves changes', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ id: 'conn1', created_at: '2024-01-01T00:00:00Z', ...body }),
        })
      }
      if (url.includes('/api/profile/me')) {
        return Promise.resolve({ ok: false, status: 404 })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            { id: 'conn1', name: 'Grace Hopper', created_at: '2024-01-01T00:00:00Z' },
          ]),
      })
    })

    renderConnectionsPage()

    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit connection with Grace Hopper' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Connection' })
    expect(dialog).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Grace M. Hopper' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(screen.getByText('Grace M. Hopper')).toBeInTheDocument()
    })
  })

  it('clears the session and redirects when the API returns 401', async () => {
    seedSession()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 })

    renderConnectionsPage()

    await waitFor(() => {
      expect(screen.getByText('Landing page')).toBeInTheDocument()
    })
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })
})

describe('ConnectionsPage header menu', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('navigates to the about page from the header menu', async () => {
    seedSession()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) })

    renderConnectionsPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }))

    await waitFor(() => {
      expect(screen.getByText('About page')).toBeInTheDocument()
    })
  })
})
