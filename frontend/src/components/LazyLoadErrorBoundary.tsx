import { Component, type ReactNode } from 'react'

// Messages browsers throw when a code-split chunk can't be fetched or parsed.
// This almost always means a deploy replaced the hashed asset while this tab
// was still open: the old chunk 404s, CloudFront's SPA fallback serves
// index.html as text/html, and the module loader rejects it ("text/html is
// not a valid javascript mime type"). A reload pulls the fresh index.html and
// its current chunk hashes, so the fix is simply to reload.
const STALE_CHUNK_ERROR =
  /valid javascript mime type|dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i

interface Props {
  children: ReactNode
  /** Rendered for errors that aren't stale-chunk failures. */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  isStaleChunk: boolean
}

/**
 * Catches failures from a lazily-loaded child (e.g. a `React.lazy` chunk).
 * A stale-chunk failure — the tab outliving a deploy — shows a reload prompt
 * instead of white-screening the whole app; any other error falls back to a
 * quieter message.
 */
export class LazyLoadErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isStaleChunk: false }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error)
    return { hasError: true, isStaleChunk: STALE_CHUNK_ERROR.test(message) }
  }

  render() {
    if (this.state.hasError && this.state.isStaleChunk) {
      return (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-lg bg-gray-100 p-4 text-center">
          <p className="text-sm text-gray-600">
            A new version of the app is available. Reload to continue.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Reload
          </button>
        </div>
      )
    }

    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-gray-100 p-4 text-center text-sm text-gray-600">
            The preview failed to load.
          </div>
        )
      )
    }

    return this.props.children
  }
}
