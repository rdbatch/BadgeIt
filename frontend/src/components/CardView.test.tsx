import { render, screen } from '@testing-library/react'
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
})
