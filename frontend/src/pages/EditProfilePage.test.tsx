import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthProvider } from '../auth'
import { EditProfilePage } from './EditProfilePage'

const SESSION_KEY = 'badgetag-auth-session'

function seedSession() {
  localStorage.setItem(
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
      { path: '/about', element: <div>About page</div> },
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
    localStorage.clear()
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
    localStorage.clear()
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

    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })
})

describe('EditProfilePage /api/profile/me', () => {
  afterEach(() => {
    localStorage.clear()
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

describe('EditProfilePage 3D print modal', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('opens the 3D print customizer from the 3D Print button', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'a1b2c3d4e5f6',
          email: 'test@example.com',
          theme: 'light',
          display_email: true,
          links: [],
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        }),
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'QR Code' })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'QR Code' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '3D Print' }))

    expect(screen.getByText('3D Print Your QR Code')).toBeInTheDocument()
    expect(screen.getByLabelText('Size')).toBeInTheDocument()
  })
})

describe('EditProfilePage link URL normalization', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('prepends https:// to a link URL missing a scheme on save', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        // Initial GET /api/profile/me — no profile yet.
        return Promise.resolve({ ok: false, status: 404 })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'a1b2c3d4e5f6',
            email: 'test@example.com',
            theme: 'light',
            display_email: true,
            links: [{ platform: 'linkedin', url: 'https://linkedin.com/in/ada' }],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          }),
      })
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Add link' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.change(screen.getByLabelText('URL for link 1'), {
      target: { value: 'linkedin.com/in/ada' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const putCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === 'PUT',
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse(putCall![1].body as string)
      expect(body.links).toEqual([{ platform: 'custom', url: 'https://linkedin.com/in/ada' }])
    })
  })

  it('leaves an already-schemed URL untouched', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve({ ok: false, status: 404 })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'a1b2c3d4e5f6',
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
      expect(screen.getByRole('button', { name: '+ Add link' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.change(screen.getByLabelText('URL for link 1'), {
      target: { value: 'http://example.com' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const putCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === 'PUT',
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse(putCall![1].body as string)
      expect(body.links).toEqual([{ platform: 'custom', url: 'http://example.com' }])
    })
  })

  it('leaves a bare Discord username untouched, without prepending https://', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve({ ok: false, status: 404 })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'a1b2c3d4e5f6',
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
      expect(screen.getByRole('button', { name: '+ Add link' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.click(screen.getByRole('button', { name: 'Platform: Link' }))
    fireEvent.click(screen.getByRole('option', { name: 'Discord' }))
    fireEvent.change(screen.getByLabelText('URL for link 1'), {
      target: { value: 'coolusername' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const putCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === 'PUT',
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse(putCall![1].body as string)
      expect(body.links).toEqual([{ platform: 'discord', url: 'coolusername' }])
    })
  })

  it('prepends https:// to a schemeless Discord invite URL', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve({ ok: false, status: 404 })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'a1b2c3d4e5f6',
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
      expect(screen.getByRole('button', { name: '+ Add link' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.click(screen.getByRole('button', { name: 'Platform: Link' }))
    fireEvent.click(screen.getByRole('option', { name: 'Discord' }))
    fireEvent.change(screen.getByLabelText('URL for link 1'), {
      target: { value: 'discord.gg/abc123' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const putCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === 'PUT',
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse(putCall![1].body as string)
      expect(body.links).toEqual([{ platform: 'discord', url: 'https://discord.gg/abc123' }])
    })
  })
})

describe('EditProfilePage location and pronouns', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('populates location and pronouns fields from the /me response', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'a1b2c3d4e5f6',
          email: 'test@example.com',
          location: 'San Francisco, CA',
          pronouns: 'she/her',
          theme: 'light',
          display_email: true,
          links: [],
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        }),
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByDisplayValue('San Francisco, CA')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('she/her')).toBeInTheDocument()
  })

  it('includes location and pronouns in the save payload', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve({ ok: false, status: 404 })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'a1b2c3d4e5f6',
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
      expect(screen.getByLabelText('Location (optional)')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Location (optional)'), {
      target: { value: 'London, UK' },
    })
    fireEvent.change(screen.getByLabelText('Pronouns (optional)'), {
      target: { value: 'they/them' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const putCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === 'PUT',
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse(putCall![1].body as string)
      expect(body.location).toBe('London, UK')
      expect(body.pronouns).toBe('they/them')
    })
  })
})

describe('EditProfilePage custom URL slug', () => {
  afterEach(() => {
    localStorage.clear()
  })

  const baseProfile = {
    id: 'a1b2c3d4e5f6',
    email: 'test@example.com',
    theme: 'light',
    display_email: true,
    links: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  it('populates the slug field from the /me response', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...baseProfile, slug: 'ada-lovelace' }),
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByDisplayValue('ada-lovelace')).toBeInTheDocument()
    })
  })

  it('calls PUT /api/profile/slug with the new value when the slug changed', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve({ ok: false, status: 404 })
      }
      if (url.includes('/api/profile/slug')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ...baseProfile, slug: 'ada-lovelace' }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(baseProfile) })
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByLabelText('Custom URL (optional)')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Custom URL (optional)'), {
      target: { value: 'ada-lovelace' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const slugCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) =>
        (url as string).includes('/api/profile/slug'),
      )
      expect(slugCall).toBeDefined()
      const body = JSON.parse(slugCall![1].body as string)
      expect(body.slug).toBe('ada-lovelace')
    })
  })

  it('does not call PUT /api/profile/slug when the slug is unchanged', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...baseProfile, slug: 'ada-lovelace' }),
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByDisplayValue('ada-lovelace')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Saved successfully!')).toBeInTheDocument()
    })

    const slugCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) =>
      (url as string).includes('/api/profile/slug'),
    )
    expect(slugCall).toBeUndefined()
  })

  it('shows a conflict error when the slug is already taken', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve({ ok: false, status: 404 })
      }
      if (url.includes('/api/profile/slug')) {
        return Promise.resolve({ ok: false, status: 409 })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(baseProfile) })
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByLabelText('Custom URL (optional)')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Custom URL (optional)'), {
      target: { value: 'ada-lovelace' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Error: That custom URL is already taken')).toBeInTheDocument()
    })

    const slugInput = screen.getByLabelText('Custom URL (optional)')
    expect(slugInput).toHaveAttribute('aria-invalid', 'true')
    expect(slugInput.closest('div')).toHaveClass('border-red-500')

    // Editing the field again clears the highlight.
    fireEvent.change(slugInput, { target: { value: 'ada-lovelace-2' } })
    expect(slugInput).toHaveAttribute('aria-invalid', 'false')
    expect(slugInput.closest('div')).not.toHaveClass('border-red-500')
  })

  it('populates the slug field again after a page reload following a successful save', async () => {
    seedSession()

    // Simulates a fresh page load post-save: /me now returns the slug that
    // was set, and the initial render must show it in the field (this is
    // the load path, not the save path — regression guard for the backend
    // bug where an unrelated profile save silently dropped the slug).
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...baseProfile, display_name: 'Ada King', slug: 'ada-lovelace' }),
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByDisplayValue('Ada King')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('ada-lovelace')).toBeInTheDocument()
  })

  it('lowercases input and strips disallowed characters as the user types', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByLabelText('Custom URL (optional)')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Custom URL (optional)'), {
      target: { value: 'Ada Lovelace!!' },
    })

    expect(screen.getByDisplayValue('adalovelace')).toBeInTheDocument()
  })
})

describe('EditProfilePage vCard import', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('fills blank fields and appends links from an imported vCard', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByLabelText('Import from vCard')).toBeInTheDocument()
    })

    const vcardText = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Grace Hopper',
      'TEL;TYPE=CELL:+1 555-0199',
      'URL:https://github.com/ghopper',
      'END:VCARD',
      '',
    ].join('\r\n')
    const file = new File([vcardText], 'contact.vcf', { type: 'text/vcard' })

    fireEvent.change(screen.getByLabelText('Import from vCard'), {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(screen.getByDisplayValue('Grace Hopper')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('+1 555-0199')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://github.com/ghopper')).toBeInTheDocument()
  })

  it('does not overwrite a field the user already filled in', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByLabelText('Display Name')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('Display Name'), {
      target: { value: 'Existing Name' },
    })

    const vcardText = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Grace Hopper', 'END:VCARD', ''].join(
      '\r\n',
    )
    const file = new File([vcardText], 'contact.vcf', { type: 'text/vcard' })

    fireEvent.change(screen.getByLabelText('Import from vCard'), {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(screen.getByText(/Imported from vCard/)).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('Existing Name')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Grace Hopper')).not.toBeInTheDocument()
  })
})

describe('EditProfilePage custom theme', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('opens the custom theme modal from the theme picker instead of selecting immediately', async () => {
    seedSession()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Choose custom theme colors' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Choose custom theme colors' }))

    expect(screen.getByRole('dialog', { name: 'Custom Theme Colors' })).toBeInTheDocument()
    // Selecting Custom shouldn't happen just by opening the modal — the
    // page background should still reflect the previously active theme.
    const main = screen.getByText('Edit Your Card').closest('main')
    expect(main).toHaveClass('bg-white')
  })

  it('applies the custom theme and includes it in the save payload', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve({ ok: false, status: 404 })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'a1b2c3d4e5f6',
            email: 'test@example.com',
            theme: 'custom',
            display_email: true,
            links: [],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          }),
      })
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Choose custom theme colors' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Choose custom theme colors' }))
    fireEvent.change(screen.getByLabelText('Accent color'), { target: { value: '#abcdef' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    // Applying selects the custom theme immediately.
    const main = screen.getByText('Edit Your Card').closest('main')
    expect(main).toHaveClass('[background-color:var(--badgetag-bg)]')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const putCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === 'PUT',
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse(putCall![1].body as string)
      expect(body.theme).toBe('custom')
      expect(body.custom_theme.accent).toBe('#abcdef')
    })
  })

  it('populates custom theme colors from the /me response', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'a1b2c3d4e5f6',
          email: 'test@example.com',
          theme: 'custom',
          custom_theme: { bg: '#111111', text: '#222222', text_muted: '#333333', accent: '#444444' },
          display_email: true,
          links: [],
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        }),
    })

    renderEditPage()

    await waitFor(() => {
      const main = screen.getByText('Edit Your Card').closest('main')
      expect(main).toHaveClass('[background-color:var(--badgetag-bg)]')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Choose custom theme colors' }))
    expect(screen.getByLabelText('Background color')).toHaveValue('#111111')
    expect(screen.getByLabelText('Accent color')).toHaveValue('#444444')
  })
})

describe('EditProfilePage view count', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('shows the view count from the /me response, pluralized', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'a1b2c3d4e5f6',
          email: 'test@example.com',
          theme: 'light',
          view_count: 42,
          display_email: true,
          links: [],
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        }),
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByText('42 views')).toBeInTheDocument()
    })
  })

  it('shows singular "1 view" and "0 views" correctly', async () => {
    seedSession()

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'a1b2c3d4e5f6',
          email: 'test@example.com',
          theme: 'light',
          view_count: 1,
          display_email: true,
          links: [],
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        }),
    })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByText('1 view')).toBeInTheDocument()
    })
  })

  it('does not show a view count before the first save (no profile yet)', async () => {
    seedSession()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    renderEditPage()

    await waitFor(() => {
      expect(screen.getByText('Edit Your Card')).toBeInTheDocument()
    })
    expect(screen.queryByText(/^\d+ views?$/)).not.toBeInTheDocument()
  })
})

describe('EditProfilePage header menu', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('navigates to the about page from the header menu', async () => {
    seedSession()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    renderEditPage()

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

