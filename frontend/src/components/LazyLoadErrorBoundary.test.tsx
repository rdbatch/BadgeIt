import { render, screen, fireEvent } from '@testing-library/react'
import { LazyLoadErrorBoundary } from './LazyLoadErrorBoundary'

function Throw({ error }: { error: unknown }): never {
  throw error
}

describe('LazyLoadErrorBoundary', () => {
  // The boundary logs the caught error via React; silence it for clean output.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders children when nothing throws', () => {
    render(
      <LazyLoadErrorBoundary>
        <span>preview</span>
      </LazyLoadErrorBoundary>,
    )
    expect(screen.getByText('preview')).toBeInTheDocument()
  })

  it('shows a reload prompt for a stale-chunk MIME error', () => {
    render(
      <LazyLoadErrorBoundary>
        <Throw error={new TypeError('text/html is not a valid javascript mime type')} />
      </LazyLoadErrorBoundary>,
    )
    expect(screen.getByText(/new version of the app is available/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('shows a reload prompt for a failed dynamic import', () => {
    render(
      <LazyLoadErrorBoundary>
        <Throw error={new Error('Failed to fetch dynamically imported module: /assets/x.js')} />
      </LazyLoadErrorBoundary>,
    )
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('reloads the page when the reload button is clicked', () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    })
    render(
      <LazyLoadErrorBoundary>
        <Throw error={new Error('ChunkLoadError: Loading chunk 3 failed')} />
      </LazyLoadErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('falls back quietly for a non-chunk runtime error', () => {
    render(
      <LazyLoadErrorBoundary>
        <Throw error={new Error('WebGL context lost')} />
      </LazyLoadErrorBoundary>,
    )
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
    expect(screen.getByText(/preview failed to load/i)).toBeInTheDocument()
  })

  it('renders a custom fallback for non-chunk errors when provided', () => {
    render(
      <LazyLoadErrorBoundary fallback={<span>custom fallback</span>}>
        <Throw error={new Error('WebGL context lost')} />
      </LazyLoadErrorBoundary>,
    )
    expect(screen.getByText('custom fallback')).toBeInTheDocument()
  })
})
