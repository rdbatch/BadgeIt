import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { QRModal } from './QRModal'

// Mock react-qr-code to avoid canvas/SVG rendering in tests
vi.mock('react-qr-code', () => ({
  default: (props: Record<string, unknown>) => (
    <svg data-testid={props['data-testid']} id={props.id as string}>
      <text>{props.value as string}</text>
    </svg>
  ),
}))

const defaultProps = {
  profileId: 'abc123',
  isOpen: true,
  onClose: vi.fn(),
}

describe('QRModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('visibility', () => {
    it('renders when isOpen is true', () => {
      render(<QRModal {...defaultProps} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('does not render when isOpen is false', () => {
      render(<QRModal {...defaultProps} isOpen={false} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('displays the profile URL', () => {
      render(<QRModal {...defaultProps} />)
      const urlDisplay = screen.getByText(/\/p\/abc123/, { selector: 'p' })
      expect(urlDisplay).toBeInTheDocument()
    })

    it('renders the QR code SVG', () => {
      render(<QRModal {...defaultProps} />)
      expect(screen.getByTestId('qr-code')).toBeInTheDocument()
    })
  })

  describe('close behavior', () => {
    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      render(<QRModal {...defaultProps} />)

      await user.click(screen.getByLabelText('Close QR code modal'))
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when Escape key is pressed', () => {
      render(<QRModal {...defaultProps} />)

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when clicking the backdrop', async () => {
      const user = userEvent.setup()
      render(<QRModal {...defaultProps} />)

      const backdrop = screen.getByRole('dialog').parentElement ?? screen.getByRole('dialog')
      // The backdrop is the outer div with onClick
      const outerDiv = screen.getByRole('dialog')
      await user.click(outerDiv)
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('photo toggle - without imageUrl', () => {
    it('does not render the toggle switch when imageUrl is undefined', () => {
      render(<QRModal {...defaultProps} />)
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })

    it('does not render the photo overlay when imageUrl is undefined', () => {
      render(<QRModal {...defaultProps} />)
      expect(screen.queryByTestId('qr-photo-overlay')).not.toBeInTheDocument()
    })
  })

  describe('photo toggle - with imageUrl', () => {
    const propsWithImage = {
      ...defaultProps,
      imageUrl: 'https://example.com/photo.jpg',
    }

    it('renders the toggle switch when imageUrl is provided', () => {
      render(<QRModal {...propsWithImage} />)
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('toggle switch has accessible label', () => {
      render(<QRModal {...propsWithImage} />)
      expect(screen.getByText('Show profile photo')).toBeInTheDocument()
    })

    it('toggle defaults to checked (on)', () => {
      render(<QRModal {...propsWithImage} />)
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    })

    it('renders photo overlay when toggle is on', () => {
      render(<QRModal {...propsWithImage} />)
      const overlay = screen.getByTestId('qr-photo-overlay')
      expect(overlay).toBeInTheDocument()
      expect(overlay).toHaveAttribute('src', 'https://example.com/photo.jpg')
    })

    it('photo overlay has appropriate alt text', () => {
      render(<QRModal {...propsWithImage} />)
      expect(screen.getByAltText('Profile photo overlay')).toBeInTheDocument()
    })

    it('photo overlay is circular (has rounded-full class)', () => {
      render(<QRModal {...propsWithImage} />)
      const overlay = screen.getByTestId('qr-photo-overlay')
      expect(overlay).toHaveClass('rounded-full')
    })

    it('hides photo overlay when toggle is turned off', async () => {
      const user = userEvent.setup()
      render(<QRModal {...propsWithImage} />)

      expect(screen.getByTestId('qr-photo-overlay')).toBeInTheDocument()

      await user.click(screen.getByRole('switch'))

      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
      expect(screen.queryByTestId('qr-photo-overlay')).not.toBeInTheDocument()
    })

    it('shows photo overlay again when toggle is turned back on', async () => {
      const user = userEvent.setup()
      render(<QRModal {...propsWithImage} />)

      // Turn off
      await user.click(screen.getByRole('switch'))
      expect(screen.queryByTestId('qr-photo-overlay')).not.toBeInTheDocument()

      // Turn back on
      await user.click(screen.getByRole('switch'))
      expect(screen.getByTestId('qr-photo-overlay')).toBeInTheDocument()
    })
  })

  describe('photo toggle - showPhotoToggle=false (read-only view)', () => {
    const propsReadOnly = {
      ...defaultProps,
      imageUrl: 'https://example.com/photo.jpg',
      showPhotoToggle: false,
    }

    it('does not render the toggle switch even though imageUrl is provided', () => {
      render(<QRModal {...propsReadOnly} />)
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })

    it('still renders the photo overlay (always-on, no way to hide it)', () => {
      render(<QRModal {...propsReadOnly} />)
      expect(screen.getByTestId('qr-photo-overlay')).toBeInTheDocument()
    })
  })

  describe('download', () => {
    it('renders download button', () => {
      render(<QRModal {...defaultProps} />)
      expect(screen.getByText('Download as PNG')).toBeInTheDocument()
    })

    it('download button calls canvas export pipeline', async () => {
      const user = userEvent.setup()

      // Mock getElementById to return a minimal SVG element
      const mockSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      vi.spyOn(document, 'getElementById').mockReturnValue(mockSvg)

      // Mock canvas context
      const mockToBlob = vi.fn()
      const mockCtx = {
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        clip: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
      }

      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.toBlob = mockToBlob as unknown as typeof HTMLCanvasElement.prototype.toBlob

      // Mock Image with a proper class
      const imageInstances: Array<{ onload: (() => void) | null; src: string; width: number; height: number }> = []
      vi.stubGlobal('Image', class {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        src = ''
        width = 220
        height = 220
        constructor() {
          imageInstances.push(this)
        }
      })

      render(<QRModal {...defaultProps} />)
      await user.click(screen.getByText('Download as PNG'))

      // Trigger the QR image onload
      expect(imageInstances.length).toBeGreaterThan(0)
      imageInstances[0].onload?.()

      // Canvas should have been drawn to
      expect(mockCtx.fillRect).toHaveBeenCalled()
      expect(mockCtx.drawImage).toHaveBeenCalled()
      expect(mockToBlob).toHaveBeenCalled()

      vi.unstubAllGlobals()
    })

    it('download with photo overlay enabled draws both the QR code and the circular photo', async () => {
      const user = userEvent.setup()

      const mockSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      vi.spyOn(document, 'getElementById').mockReturnValue(mockSvg)

      const mockToBlob = vi.fn()
      const mockCtx = {
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        clip: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
      }

      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.toBlob = mockToBlob as unknown as typeof HTMLCanvasElement.prototype.toBlob

      // Mock Image with a proper class — the component creates one Image
      // for the QR code SVG, then (since imageUrl + showPhoto are set) a
      // second Image for the profile photo. Both are same-origin URLs in
      // production, so no CORS/crossOrigin handling is needed here.
      const imageInstances: Array<{
        onload: (() => void) | null
        onerror: (() => void) | null
        src: string
        width: number
        height: number
      }> = []
      vi.stubGlobal(
        'Image',
        class {
          onload: (() => void) | null = null
          onerror: (() => void) | null = null
          src = ''
          width = 220
          height = 220
          constructor() {
            imageInstances.push(this)
          }
        },
      )

      render(
        <QRModal {...defaultProps} imageUrl="/images/abc123" />,
      )
      await user.click(screen.getByText('Download as PNG'))

      // First Image is the QR code SVG
      expect(imageInstances.length).toBe(1)
      imageInstances[0].onload?.()

      // Triggering QR onload should have created the second Image (photo)
      expect(imageInstances.length).toBe(2)
      imageInstances[1].onload?.()

      // Both the QR code and the circular photo should have been drawn
      expect(mockCtx.drawImage).toHaveBeenCalledTimes(2)
      expect(mockCtx.arc).toHaveBeenCalled() // circular clip + white ring
      expect(mockToBlob).toHaveBeenCalled()

      vi.unstubAllGlobals()
    })
  })

  describe('copy URL', () => {
    it('renders copy URL button', () => {
      render(<QRModal {...defaultProps} />)
      expect(screen.getByText('Copy URL')).toBeInTheDocument()
    })

    it('copies profile URL to clipboard when clicked', async () => {
      const user = userEvent.setup()
      const writeTextMock = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      })

      render(<QRModal {...defaultProps} />)
      await user.click(screen.getByText('Copy URL'))

      expect(writeTextMock).toHaveBeenCalledWith(
        expect.stringContaining('/p/abc123'),
      )
    })
  })

  describe('accessibility', () => {
    it('has role=dialog and aria-modal', () => {
      render(<QRModal {...defaultProps} />)
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('has aria-labelledby pointing to the title', () => {
      render(<QRModal {...defaultProps} />)
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-labelledby', 'qr-modal-title')
      expect(screen.getByText('Your QR Code')).toHaveAttribute('id', 'qr-modal-title')
    })

    it('close button has aria-label', () => {
      render(<QRModal {...defaultProps} />)
      expect(screen.getByLabelText('Close QR code modal')).toBeInTheDocument()
    })
  })
})
