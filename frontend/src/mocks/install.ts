import { handleMockRequest, seedDemoProfile } from './handlers'
import { installMockWebAuthn } from './webauthn'

/**
 * Activates mock mode: seeds demo data and wraps window.fetch so Cognito
 * and profile-API requests are answered locally (see handlers.ts).
 *
 * Only reachable through the `import.meta.env.DEV`-gated dynamic import in
 * main.tsx — that guard is statically false in production builds, so this
 * module (and everything under src/mocks/) is excluded from them entirely.
 * The throw below is a second line of defense in case that gate is ever
 * refactored away.
 */
export function installMocks(): void {
  if (!import.meta.env.DEV) {
    throw new Error('Mock mode is dev-only and must never run in a production build')
  }

  seedDemoProfile()
  installMockWebAuthn()

  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    // Normalizing to a Request up front also snapshots the body, so
    // handlers can read it and pass-through requests stay usable. Relative
    // URLs are resolved explicitly — the browser's Request would do this
    // itself, but Node's (used by vitest) refuses them.
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(new URL(input, window.location.origin), init)
    const mocked = await handleMockRequest(request)
    return mocked ?? realFetch(request)
  }

  addMockBadge()

  console.info(
    '[badgeit mock] Running against local mock data — any email and any ' +
      'verification code signs in; edits persist in localStorage.',
  )
}

/** Always-visible reminder that nothing on screen is real. */
function addMockBadge(): void {
  const badge = document.createElement('div')
  badge.textContent = 'MOCK DATA'
  badge.style.cssText = [
    'position:fixed',
    'bottom:8px',
    'left:8px',
    'z-index:9999',
    'padding:2px 8px',
    'border-radius:6px',
    'background:#b45309',
    'color:#fff',
    'font:600 11px/1.6 ui-sans-serif,system-ui,sans-serif',
    'letter-spacing:0.05em',
    'pointer-events:none',
  ].join(';')
  document.body.appendChild(badge)
}
