import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { CardView } from './CardView'
import type { Profile } from '../types/profile'

// Mock react-qr-code to avoid canvas/SVG rendering in tests
vi.mock('react-qr-code', () => ({
  default: (props: Record<string, unknown>) => (
    <svg data-testid={props['data-testid']} id={props.id as string}>
      <text>{props.value as string}</text>
    </svg>
  ),
}))

// Default to an anonymous viewer — most tests in this file exercise the
// public, read-only rendering and don't care about auth. Tests that do
// (the "Save as Connection" describe block) override this per-test.
const useAuthMock = vi.fn().mockReturnValue({ isAuthenticated: false, session: null })
vi.mock('../auth', () => ({
  useAuth: () => useAuthMock(),
}))

const fullProfile: Profile = {
  email: 'test@example.com',
  displayName: 'Test User',
  tagline: 'Senior Engineer @ TestCo',
  phone: '+1 555-0100',
  imageUrl: 'https://example.com/photo.jpg',
  theme: 'light',
  displayEmail: true,
  links: [
    { platform: 'linkedin', url: 'https://linkedin.com/in/test' },
    { platform: 'github', url: 'https://github.com/test' },
    { platform: 'custom', url: 'https://blog.test.com', label: 'My Blog' },
  ],
}

const minimalProfile: Profile = {
  email: 'min@example.com',
  theme: 'light',
  displayEmail: true,
  links: [],
}

describe('CardView', () => {
  describe('renders populated fields only', () => {
    it('renders all fields when fully populated', () => {
      render(<CardView profile={fullProfile} />)

      expect(screen.getByText('Test User')).toBeInTheDocument()
      expect(screen.getByText('Senior Engineer @ TestCo')).toBeInTheDocument()
      expect(screen.getByText('test@example.com')).toBeInTheDocument()
      expect(screen.getByText('+1 555-0100')).toBeInTheDocument()
      expect(screen.getByAltText("Test User's profile photo")).toBeInTheDocument()
      expect(screen.getByText('LinkedIn')).toBeInTheDocument()
      expect(screen.getByText('GitHub')).toBeInTheDocument()
      expect(screen.getByText('My Blog')).toBeInTheDocument()
    })

    it('renders only email for minimal profile', () => {
      render(<CardView profile={minimalProfile} />)

      expect(screen.getByText('min@example.com')).toBeInTheDocument()
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Social links')).not.toBeInTheDocument()
    })

    it('does not render phone when not provided', () => {
      const noPhone: Profile = { ...fullProfile, phone: undefined }
      render(<CardView profile={noPhone} />)

      expect(screen.queryByText('+1 555-0100')).not.toBeInTheDocument()
    })

    it('does not render image when not provided', () => {
      const noImage: Profile = { ...fullProfile, imageUrl: undefined }
      render(<CardView profile={noImage} />)

      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('does not render tagline when not provided', () => {
      const noTagline: Profile = { ...fullProfile, tagline: undefined }
      render(<CardView profile={noTagline} />)

      expect(screen.queryByText('Senior Engineer @ TestCo')).not.toBeInTheDocument()
    })

    it('does not render social links section when links array is empty', () => {
      const noLinks: Profile = { ...fullProfile, links: [] }
      render(<CardView profile={noLinks} />)

      expect(screen.queryByLabelText('Social links')).not.toBeInTheDocument()
    })

    it('does not render location or pronouns when not provided', () => {
      render(<CardView profile={minimalProfile} />)

      expect(screen.queryByText(/San Francisco/)).not.toBeInTheDocument()
      expect(screen.queryByText(/she\/her/)).not.toBeInTheDocument()
    })
  })

  describe('location and pronouns', () => {
    it('renders pronouns next to the display name when provided', () => {
      const withPronouns: Profile = { ...fullProfile, pronouns: 'she/her' }
      render(<CardView profile={withPronouns} />)

      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveTextContent('Test User')
      expect(heading).toHaveTextContent('(she/her)')
    })

    it('renders location when provided', () => {
      const withLocation: Profile = { ...fullProfile, location: 'San Francisco, CA' }
      render(<CardView profile={withLocation} />)

      expect(screen.getByText('San Francisco, CA')).toBeInTheDocument()
    })

    it('does not render location row when not provided', () => {
      const noLocation: Profile = { ...fullProfile, location: undefined }
      render(<CardView profile={noLocation} />)

      expect(screen.queryByText('San Francisco, CA')).not.toBeInTheDocument()
    })
  })

  describe('theme support', () => {
    it('applies light theme classes', () => {
      render(<CardView profile={fullProfile} />)
      const card = screen.getByTestId('card-view')
      expect(card).toHaveClass('bg-white')
    })

    it('applies dark theme classes', () => {
      const darkProfile: Profile = { ...fullProfile, theme: 'dark' }
      render(<CardView profile={darkProfile} />)
      const card = screen.getByTestId('card-view')
      expect(card).toHaveClass('bg-gray-900')
    })

    it('applies ocean theme classes', () => {
      const oceanProfile: Profile = { ...fullProfile, theme: 'ocean' }
      render(<CardView profile={oceanProfile} />)
      const card = screen.getByTestId('card-view')
      expect(card).toHaveClass('bg-slate-800')
    })
  })

  describe('accessibility', () => {
    it('uses semantic HTML structure', () => {
      render(<CardView profile={fullProfile} />)

      expect(screen.getByRole('article')).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('provides alt text for profile image', () => {
      render(<CardView profile={fullProfile} />)
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('alt', "Test User's profile photo")
    })

    it('provides generic alt text when no display name', () => {
      const noName: Profile = { ...fullProfile, displayName: undefined }
      render(<CardView profile={noName} />)
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('alt', 'Profile photo')
    })

    it('email link has correct mailto href', () => {
      render(<CardView profile={fullProfile} />)
      const emailLink = screen.getByText('test@example.com').closest('a')
      expect(emailLink).toHaveAttribute('href', 'mailto:test@example.com')
    })

    it('phone link has correct tel href', () => {
      render(<CardView profile={fullProfile} />)
      const phoneLink = screen.getByText('+1 555-0100').closest('a')
      expect(phoneLink).toHaveAttribute('href', 'tel:+1 555-0100')
    })

    it('social links open in new tab with security attributes', () => {
      render(<CardView profile={fullProfile} />)
      const linkedinLink = screen.getByText('LinkedIn').closest('a')
      expect(linkedinLink).toHaveAttribute('target', '_blank')
      expect(linkedinLink).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  describe('footer', () => {
    it('renders Made with BadgeIt footer', () => {
      render(<CardView profile={fullProfile} />)
      expect(screen.getByText('Made with BadgeIt')).toBeInTheDocument()
    })

    it('footer links to landing page', () => {
      render(<CardView profile={fullProfile} />)
      const footerLink = screen.getByText('Made with BadgeIt').closest('a')
      expect(footerLink).toHaveAttribute('href', '/')
    })
  })

  describe('QR code button', () => {
    it('does not render the QR button when profileId is not provided', () => {
      render(<CardView profile={fullProfile} />)
      expect(screen.queryByLabelText('Show QR code')).not.toBeInTheDocument()
    })

    it('does not render the QR button when there is no profile photo, even with profileId', () => {
      const noImage: Profile = { ...fullProfile, imageUrl: undefined }
      render(<CardView profile={noImage} profileId="abc123" />)
      expect(screen.queryByLabelText('Show QR code')).not.toBeInTheDocument()
    })

    it('renders the QR button when both profileId and a profile photo are present', () => {
      render(<CardView profile={fullProfile} profileId="abc123" />)
      expect(screen.getByLabelText('Show QR code')).toBeInTheDocument()
    })

    it('opens the QR modal when the button is clicked', async () => {
      const user = userEvent.setup()
      render(<CardView profile={fullProfile} profileId="abc123" />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      await user.click(screen.getByLabelText('Show QR code'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('does not render a photo toggle switch inside the modal (read-only view)', async () => {
      const user = userEvent.setup()
      render(<CardView profile={fullProfile} profileId="abc123" />)

      await user.click(screen.getByLabelText('Show QR code'))

      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })

    it('closes the QR modal when its close button is clicked', async () => {
      const user = userEvent.setup()
      render(<CardView profile={fullProfile} profileId="abc123" />)

      await user.click(screen.getByLabelText('Show QR code'))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      await user.click(screen.getByLabelText('Close QR code modal'))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('Download Contact Card button', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('renders the Download Contact Card button', () => {
      render(<CardView profile={fullProfile} />)
      expect(screen.getByRole('button', { name: 'Download Contact Card' })).toBeInTheDocument()
    })

    it('downloads a vCard file when clicked', async () => {
      const user = userEvent.setup()

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          headers: { get: () => 'image/jpeg' },
          blob: () => Promise.resolve(new Blob(['fake'], { type: 'image/jpeg' })),
        }),
      )

      const createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
      const revokeObjectURL = vi.fn()
      vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

      const clickSpy = vi.fn()
      const realCreateElement = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'a') vi.spyOn(el, 'click').mockImplementation(clickSpy)
        return el
      })

      render(<CardView profile={fullProfile} profileId="abc123" />)
      await user.click(screen.getByRole('button', { name: 'Download Contact Card' }))

      await vi.waitFor(() => {
        expect(clickSpy).toHaveBeenCalled()
      })
      expect(createObjectURL).toHaveBeenCalled()
    })
  })

  describe('custom theme', () => {
    it('applies CSS custom properties from customTheme when theme is custom', () => {
      const customProfile: Profile = {
        ...fullProfile,
        theme: 'custom',
        customTheme: { bg: '#111111', text: '#222222', textMuted: '#333333', accent: '#444444' },
      }
      render(<CardView profile={customProfile} />)

      const card = screen.getByTestId('card-view')
      expect(card).toHaveClass('[background-color:var(--badgeit-bg)]')
      expect(card.style.getPropertyValue('--badgeit-bg')).toBe('#111111')
      expect(card.style.getPropertyValue('--badgeit-accent')).toBe('#444444')
    })

    it('does not apply custom theme styles for a preset theme', () => {
      render(<CardView profile={fullProfile} />)
      const card = screen.getByTestId('card-view')
      expect(card.style.getPropertyValue('--badgeit-bg')).toBe('')
    })
  })

  describe('Save as Connection', () => {
    afterEach(() => {
      useAuthMock.mockReturnValue({ isAuthenticated: false, session: null })
      vi.unstubAllGlobals()
    })

    it('does not render for an anonymous viewer', () => {
      render(<CardView profile={fullProfile} profileId="abc123" />)
      expect(screen.queryByRole('button', { name: 'Save as Connection' })).not.toBeInTheDocument()
    })

    it('does not render without a profileId, even when signed in', () => {
      useAuthMock.mockReturnValue({
        isAuthenticated: true,
        session: { idToken: 'test-token' },
      })
      render(<CardView profile={fullProfile} />)
      expect(screen.queryByRole('button', { name: 'Save as Connection' })).not.toBeInTheDocument()
    })

    it('renders for a signed-in viewer looking at someone else\'s card', async () => {
      useAuthMock.mockReturnValue({
        isAuthenticated: true,
        session: { idToken: 'test-token' },
      })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ id: 'my-own-id' }),
        }),
      )

      render(<CardView profile={fullProfile} profileId="someone-elses-id" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save as Connection' })).toBeInTheDocument()
      })
    })

    it('does not render when viewing your own card', async () => {
      useAuthMock.mockReturnValue({
        isAuthenticated: true,
        session: { idToken: 'test-token' },
      })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ id: 'my-own-id' }),
        }),
      )

      render(<CardView profile={fullProfile} profileId="my-own-id" />)

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Save as Connection' })).not.toBeInTheDocument()
      })
    })

    it('opens the save-connection modal when clicked', async () => {
      const user = userEvent.setup()
      useAuthMock.mockReturnValue({
        isAuthenticated: true,
        session: { idToken: 'test-token' },
      })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.includes('/api/profile/me')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'my-own-id' }) })
          }
          return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        }),
      )

      render(<CardView profile={fullProfile} profileId="someone-elses-id" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save as Connection' })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: 'Save as Connection' }))

      expect(screen.getByRole('dialog', { name: 'Save Connection' })).toBeInTheDocument()
    })
  })
})
