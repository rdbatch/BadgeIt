import { render, screen, fireEvent, act } from '@testing-library/react'
import { DownloadDropdown } from './DownloadDropdown'

describe('DownloadDropdown', () => {
  const options = [
    { label: 'QR Code', onSelect: vi.fn() },
    { label: '3D Print', onSelect: vi.fn() },
  ]

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders a single Download trigger and no menu by default', () => {
    render(<DownloadDropdown options={options} themeTextClass="text-gray-900" />)
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the menu with all options when clicked', () => {
    render(<DownloadDropdown options={options} themeTextClass="text-gray-900" />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'QR Code' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '3D Print' })).toBeInTheDocument()
  })

  it('calls the option callback and closes the menu on selection', () => {
    render(<DownloadDropdown options={options} themeTextClass="text-gray-900" />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'QR Code' }))

    expect(options[0].onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the menu on outside click', () => {
    render(
      <div>
        <DownloadDropdown options={options} themeTextClass="text-gray-900" />
        <button>Outside</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the menu on Escape', () => {
    render(<DownloadDropdown options={options} themeTextClass="text-gray-900" />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('disables the trigger and does not open when disabled', () => {
    render(<DownloadDropdown options={options} themeTextClass="text-gray-900" disabled />)
    const trigger = screen.getByRole('button', { name: 'Download' })
    expect(trigger).toBeDisabled()

    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders a chevron icon that flips when the menu opens', () => {
    render(<DownloadDropdown options={options} themeTextClass="text-gray-900" />)
    const trigger = screen.getByRole('button', { name: 'Download' })
    const chevron = trigger.querySelector('svg')
    expect(chevron).toBeInTheDocument()
    expect(chevron).not.toHaveClass('rotate-180')

    fireEvent.click(trigger)
    expect(chevron).toHaveClass('rotate-180')
  })

  describe('hover behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.runOnlyPendingTimers()
      vi.useRealTimers()
    })

    it('opens the menu on mouse enter, with no click needed', () => {
      const { container } = render(
        <DownloadDropdown options={options} themeTextClass="text-gray-900" />,
      )
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()

      fireEvent.mouseEnter(container.firstChild as Element)
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('closes after a short delay once the mouse leaves', () => {
      const { container } = render(
        <DownloadDropdown options={options} themeTextClass="text-gray-900" />,
      )
      const wrapper = container.firstChild as Element
      fireEvent.mouseEnter(wrapper)
      expect(screen.getByRole('menu')).toBeInTheDocument()

      fireEvent.mouseLeave(wrapper)
      // Still open immediately after leaving — the close is debounced so a
      // quick pass over the gap to the menu doesn't snap it shut.
      expect(screen.getByRole('menu')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('cancels the pending close if the mouse re-enters before the delay elapses', () => {
      const { container } = render(
        <DownloadDropdown options={options} themeTextClass="text-gray-900" />,
      )
      const wrapper = container.firstChild as Element
      fireEvent.mouseEnter(wrapper)
      fireEvent.mouseLeave(wrapper)

      act(() => {
        vi.advanceTimersByTime(100)
      })
      fireEvent.mouseEnter(wrapper)
      act(() => {
        vi.advanceTimersByTime(150)
      })

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })
  })
})
