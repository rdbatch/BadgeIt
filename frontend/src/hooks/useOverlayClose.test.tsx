import { render, fireEvent, screen } from '@testing-library/react'
import { useOverlayClose } from './useOverlayClose'

function TestOverlay({ onClose }: { onClose: () => void }) {
  const overlayClose = useOverlayClose(onClose)
  return (
    <div data-testid="overlay" {...overlayClose}>
      <div data-testid="panel">
        <input data-testid="slider" type="range" />
      </div>
    </div>
  )
}

describe('useOverlayClose', () => {
  it('closes when mousedown and click both target the overlay', () => {
    const onClose = vi.fn()
    render(<TestOverlay onClose={onClose} />)
    const overlay = screen.getByTestId('overlay')

    fireEvent.mouseDown(overlay)
    fireEvent.click(overlay)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when both mousedown and click target an inner element', () => {
    const onClose = vi.fn()
    render(<TestOverlay onClose={onClose} />)
    const panel = screen.getByTestId('panel')

    fireEvent.mouseDown(panel)
    fireEvent.click(panel)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close when a drag starts inside and the click lands on the overlay', () => {
    const onClose = vi.fn()
    render(<TestOverlay onClose={onClose} />)
    const overlay = screen.getByTestId('overlay')
    const slider = screen.getByTestId('slider')

    // Simulates dragging a slider and releasing the mouse outside the
    // modal — the browser dispatches `click` on the overlay (the nearest
    // common ancestor), but the mousedown never targeted the overlay.
    fireEvent.mouseDown(slider)
    fireEvent.click(overlay)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close on a stray click with no preceding mousedown on the overlay', () => {
    const onClose = vi.fn()
    render(<TestOverlay onClose={onClose} />)

    fireEvent.click(screen.getByTestId('overlay'))

    expect(onClose).not.toHaveBeenCalled()
  })
})
