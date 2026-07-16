import { render, screen, fireEvent } from '@testing-library/react'
import { Print3DModal } from './Print3DModal'
import { computeMinSizeMm, DEFAULT_QUIET_ZONE_COMPONENTS, QR3MF_LIMITS } from '../lib/qr3mf'

const PROFILE_ID = 'abc123def456'

function renderModal(props: Partial<Parameters<typeof Print3DModal>[0]> = {}) {
  const onClose = vi.fn()
  const result = render(
    <Print3DModal profileId={PROFILE_ID} isOpen onClose={onClose} {...props} />,
  )
  return { onClose, ...result }
}

describe('Print3DModal', () => {
  it('renders nothing when closed', () => {
    renderModal({ isOpen: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the customizer controls when open', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('3D Print Your QR Code')).toBeInTheDocument()
    expect(screen.getByLabelText('Size')).toBeInTheDocument()
    expect(screen.getByLabelText('Thickness')).toBeInTheDocument()
    expect(screen.getByLabelText('Quiet zone')).toBeInTheDocument()
    expect(screen.getByLabelText('Relief height')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /Lanyard loop/ })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Download .3mf' }),
    ).toBeInTheDocument()
  })

  it('renders the live preview region', async () => {
    renderModal()
    // The preview is lazy-loaded; in jsdom (no WebGL) it resolves to its
    // fallback message once the chunk loads.
    expect(
      await screen.findByText(/preview isn't available/i),
    ).toBeInTheDocument()
  })

  it('uses plain "square" language rather than QR jargon like "module"/"component"', () => {
    renderModal()
    expect(screen.queryByText(/module/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/component/i)).not.toBeInTheDocument()
    expect(screen.getAllByText(/square/i).length).toBeGreaterThan(0)
  })

  it('constrains the size slider so the code stays scannable', () => {
    renderModal()
    const url = `${window.location.origin}/p/${PROFILE_ID}`
    const slider = screen.getByLabelText('Size')
    expect(slider).toHaveAttribute(
      'min',
      String(computeMinSizeMm(url, DEFAULT_QUIET_ZONE_COMPONENTS)),
    )
    expect(slider).toHaveAttribute('max', String(QR3MF_LIMITS.maxSizeMm))
  })

  it('constrains the thickness slider to printable limits', () => {
    renderModal()
    const slider = screen.getByLabelText('Thickness')
    expect(slider).toHaveAttribute('min', String(QR3MF_LIMITS.minThicknessMm))
    expect(slider).toHaveAttribute('max', String(QR3MF_LIMITS.maxThicknessMm))
  })

  it('constrains the quiet zone slider to the printable/scannable range', () => {
    renderModal()
    const slider = screen.getByLabelText('Quiet zone')
    expect(slider).toHaveAttribute('min', String(QR3MF_LIMITS.minQuietZoneComponents))
    expect(slider).toHaveAttribute('max', String(QR3MF_LIMITS.maxQuietZoneComponents))
    expect(slider).toHaveValue(String(DEFAULT_QUIET_ZONE_COMPONENTS))
  })

  it('constrains the relief height slider to the printable range', () => {
    renderModal()
    const slider = screen.getByLabelText('Relief height')
    expect(slider).toHaveAttribute('min', String(QR3MF_LIMITS.minReliefMm))
    expect(slider).toHaveAttribute('max', String(QR3MF_LIMITS.maxReliefMm))
  })

  it('raises the minimum size when the quiet zone slider is widened', () => {
    renderModal()
    const sizeSlider = screen.getByLabelText('Size')
    const initialMin = Number(sizeSlider.getAttribute('min'))

    fireEvent.change(screen.getByLabelText('Quiet zone'), {
      target: { value: String(QR3MF_LIMITS.maxQuietZoneComponents) },
    })

    const widenedMin = Number(sizeSlider.getAttribute('min'))
    expect(widenedMin).toBeGreaterThan(initialMin)
  })

  it('updates the size readout when the slider moves', () => {
    renderModal()
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '80' } })
    expect(screen.getByText('80 × 80 mm')).toBeInTheDocument()
  })

  it('updates the thickness readout when the slider moves', () => {
    renderModal()
    fireEvent.change(screen.getByLabelText('Thickness'), {
      target: { value: '4.2' },
    })
    expect(screen.getByText('4.2 mm')).toBeInTheDocument()
  })

  it('toggles the lanyard loop switch', () => {
    renderModal()
    const loopSwitch = screen.getByRole('switch', { name: /Lanyard loop/ })
    expect(loopSwitch).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(loopSwitch)
    expect(loopSwitch).toHaveAttribute('aria-checked', 'false')
  })

  it('downloads a .3mf file named after the profile', () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    })

    let downloadName = ''
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadName = this.download
      })

    try {
      renderModal()
      fireEvent.click(screen.getByRole('button', { name: 'Download .3mf' }))

      expect(createObjectURL).toHaveBeenCalledTimes(1)
      const blob = createObjectURL.mock.calls[0][0] as unknown as Blob
      expect(blob.type).toBe('model/3mf')
      expect(blob.size).toBeGreaterThan(0)
      expect(downloadName).toBe(`badgetag-${PROFILE_ID}.3mf`)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    } finally {
      clickSpy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('closes on Escape', () => {
    const { onClose } = renderModal()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes when the backdrop is clicked', () => {
    const { onClose } = renderModal()
    const dialog = screen.getByRole('dialog')
    fireEvent.mouseDown(dialog)
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close when clicking inside the panel', () => {
    const { onClose } = renderModal()
    const heading = screen.getByText('3D Print Your QR Code')
    fireEvent.mouseDown(heading)
    fireEvent.click(heading)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close when a drag starts on a slider and is released over the backdrop', () => {
    // Regression test: browsers dispatch `click` on the nearest common
    // ancestor of the mousedown/mouseup targets, so starting a drag on the
    // size slider and releasing over the backdrop used to fire a click
    // whose target was the backdrop itself, closing the modal mid-drag.
    const { onClose } = renderModal()
    const dialog = screen.getByRole('dialog')
    const slider = screen.getByLabelText('Size')

    fireEvent.mouseDown(slider)
    fireEvent.click(dialog)

    expect(onClose).not.toHaveBeenCalled()
  })
})
