import { render, screen, fireEvent } from '@testing-library/react'
import { CustomThemeModal } from './CustomThemeModal'
import { DEFAULT_CUSTOM_THEME_COLORS } from '../types/profile'

describe('CustomThemeModal', () => {
  it('renders nothing when closed', () => {
    render(
      <CustomThemeModal
        isOpen={false}
        onClose={vi.fn()}
        initialColors={DEFAULT_CUSTOM_THEME_COLORS}
        onApply={vi.fn()}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders color fields seeded from initialColors', () => {
    render(
      <CustomThemeModal
        isOpen={true}
        onClose={vi.fn()}
        initialColors={{ bg: '#111111', text: '#222222', textMuted: '#333333', accent: '#444444' }}
        onApply={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Background color')).toHaveValue('#111111')
    expect(screen.getByLabelText('Text color')).toHaveValue('#222222')
    expect(screen.getByLabelText('Muted Text color')).toHaveValue('#333333')
    expect(screen.getByLabelText('Accent color')).toHaveValue('#444444')
  })

  it('calls onApply with the edited colors and closes on Apply', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(
      <CustomThemeModal
        isOpen={true}
        onClose={onClose}
        initialColors={DEFAULT_CUSTOM_THEME_COLORS}
        onApply={onApply}
      />,
    )

    fireEvent.change(screen.getByLabelText('Accent color'), { target: { value: '#abcdef' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledWith({ ...DEFAULT_CUSTOM_THEME_COLORS, accent: '#abcdef' })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes without applying on Cancel', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(
      <CustomThemeModal
        isOpen={true}
        onClose={onClose}
        initialColors={DEFAULT_CUSTOM_THEME_COLORS}
        onApply={onApply}
      />,
    )

    fireEvent.change(screen.getByLabelText('Accent color'), { target: { value: '#abcdef' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('resets to initialColors each time it reopens', () => {
    const { rerender } = render(
      <CustomThemeModal
        isOpen={true}
        onClose={vi.fn()}
        initialColors={DEFAULT_CUSTOM_THEME_COLORS}
        onApply={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Accent color'), { target: { value: '#abcdef' } })
    expect(screen.getByLabelText('Accent color')).toHaveValue('#abcdef')

    rerender(
      <CustomThemeModal
        isOpen={false}
        onClose={vi.fn()}
        initialColors={DEFAULT_CUSTOM_THEME_COLORS}
        onApply={vi.fn()}
      />,
    )
    rerender(
      <CustomThemeModal
        isOpen={true}
        onClose={vi.fn()}
        initialColors={DEFAULT_CUSTOM_THEME_COLORS}
        onApply={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Accent color')).toHaveValue(DEFAULT_CUSTOM_THEME_COLORS.accent)
  })

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn()
    render(
      <CustomThemeModal
        isOpen={true}
        onClose={onClose}
        initialColors={DEFAULT_CUSTOM_THEME_COLORS}
        onApply={vi.fn()}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
