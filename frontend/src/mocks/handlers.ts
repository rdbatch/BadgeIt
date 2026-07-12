/**
 * Request handlers for local mock mode (`npm run dev:mock`).
 *
 * Everything the app talks to over the network — Cognito auth and the
 * profile API — is answered here from a localStorage-backed store, so the
 * frontend runs with no AWS resources at all. The real code paths are
 * untouched: the AWS SDK and the pages' fetch calls run as normal and are
 * intercepted at the fetch boundary (see install.ts).
 *
 * This module is only ever loaded via the dev-gated dynamic import in
 * main.tsx, so none of it exists in production bundles.
 */

/** localStorage key; edits survive reloads so local testing feels real. */
export const MOCK_STORE_KEY = 'badgeit-mock-store'

export const MOCK_ID_TOKEN = 'mock-id-token'
const MOCK_ACCESS_TOKEN = 'mock-access-token'
const MOCK_REFRESH_TOKEN = 'mock-refresh-token'
const MOCK_PROFILE_ID = 'mockprofile01'

/** Profile in the API's wire format (snake_case), as the pages consume it. */
interface StoredProfile {
  id: string
  email: string
  display_name?: string
  tagline?: string
  phone?: string
  location?: string
  pronouns?: string
  image_url?: string
  theme: string
  custom_theme?: { bg: string; text: string; text_muted: string; accent: string }
  view_count?: number
  display_email: boolean
  links: Array<{ platform: string; url: string; label?: string }>
}

/** Connection in the API's wire format (snake_case), as the pages consume it. */
interface StoredConnection {
  id: string
  name: string
  notes?: string
  event?: string
  photo_url?: string
  source_profile_id?: string
  created_at: string
}

interface MockStore {
  profile: StoredProfile | null
  connections: StoredConnection[]
}

function readStore(): MockStore {
  try {
    const raw = localStorage.getItem(MOCK_STORE_KEY)
    if (raw) {
      // Defensive against a store written before `connections` existed.
      const parsed = JSON.parse(raw) as Partial<MockStore>
      return { profile: parsed.profile ?? null, connections: parsed.connections ?? [] }
    }
  } catch {
    // Corrupt store — fall through to a fresh one.
  }
  return { profile: null, connections: [] }
}

function writeStore(store: MockStore): void {
  localStorage.setItem(MOCK_STORE_KEY, JSON.stringify(store))
}

/**
 * Seeds a demo profile on first run so the edit page and public card have
 * data to show immediately. Never overwrites existing local edits.
 */
export function seedDemoProfile(): void {
  const store = readStore()
  if (store.profile) return
  writeStore({
    profile: {
      id: MOCK_PROFILE_ID,
      email: 'ada@example.com',
      display_name: 'Ada Lovelace',
      tagline: 'Analytical Engine Programmer',
      phone: '+1 (555) 010-1842',
      theme: 'ocean',
      display_email: true,
      links: [
        { platform: 'github', url: 'https://github.com/adalovelace' },
        { platform: 'website', url: 'https://example.com' },
      ],
    },
    connections: [],
  })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Cognito's JSON protocol; the SDK requires this content type to parse. */
function cognitoJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/x-amz-json-1.1' },
  })
}

const authenticationResult = {
  IdToken: MOCK_ID_TOKEN,
  AccessToken: MOCK_ACCESS_TOKEN,
  RefreshToken: MOCK_REFRESH_TOKEN,
  ExpiresIn: 3600,
  TokenType: 'Bearer',
}

/**
 * Answers the Cognito calls made by src/auth/service.ts. Any email signs
 * up, and any verification code passes the OTP challenge.
 */
async function handleCognito(request: Request): Promise<Response> {
  const target = request.headers.get('x-amz-target') ?? ''
  const body = (await request.json().catch(() => ({}))) as {
    AuthFlow?: string
  }

  if (target.endsWith('.SignUp')) {
    return cognitoJson({ UserConfirmed: true, UserSub: 'mock-user-sub' })
  }
  if (target.endsWith('.InitiateAuth')) {
    if (body.AuthFlow === 'REFRESH_TOKEN_AUTH') {
      // Like real Cognito, a refresh does not return a new RefreshToken.
      const { RefreshToken: _omitted, ...rest } = authenticationResult
      return cognitoJson({ AuthenticationResult: rest })
    }
    return cognitoJson({
      ChallengeName: 'EMAIL_OTP',
      Session: 'mock-challenge-session',
    })
  }
  if (target.endsWith('.RespondToAuthChallenge')) {
    return cognitoJson({ AuthenticationResult: authenticationResult })
  }
  return json({ __type: 'UnknownOperationException' }, 400)
}

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${MOCK_ID_TOKEN}`
}

async function handleApi(request: Request, url: URL): Promise<Response> {
  const { pathname } = url
  const method = request.method.toUpperCase()
  const store = readStore()

  // Public card lookup — the only /api route without auth. Mirrors the real
  // backend's best-effort view counter on every public fetch.
  const publicMatch = pathname.match(/^\/api\/profile\/([^/]+)$/)
  if (method === 'GET' && publicMatch && publicMatch[1] !== 'me') {
    if (store.profile && publicMatch[1] === store.profile.id) {
      const viewed = { ...store.profile, view_count: (store.profile.view_count ?? 0) + 1 }
      writeStore({ ...store, profile: viewed })
      return json(viewed)
    }
    return json({ message: 'Not found' }, 404)
  }

  if (!isAuthorized(request)) {
    return json({ message: 'Unauthorized' }, 401)
  }

  if (method === 'GET' && pathname === '/api/profile/me') {
    return store.profile ? json(store.profile) : json({ message: 'Not found' }, 404)
  }

  if (method === 'PUT' && pathname === '/api/profile') {
    const body = (await request.json()) as Omit<StoredProfile, 'id' | 'image_url'>
    const profile: StoredProfile = {
      ...body,
      // Preserve the server-assigned bits the PUT body doesn't carry.
      id: store.profile?.id ?? MOCK_PROFILE_ID,
      image_url: store.profile?.image_url,
    }
    writeStore({ ...store, profile })
    return json(profile)
  }

  if (method === 'POST' && pathname === '/api/profile/image') {
    if (!store.profile) return json({ message: 'Not found' }, 404)
    const body = (await request.json()) as {
      image_data: string
      content_type: string
    }
    const imageUrl = `data:${body.content_type};base64,${body.image_data}`
    writeStore({ ...store, profile: { ...store.profile, image_url: imageUrl } })
    return json({ image_url: imageUrl })
  }

  if (method === 'DELETE' && pathname === '/api/profile') {
    writeStore({ ...store, profile: null })
    return new Response(null, { status: 204 })
  }

  if (method === 'GET' && pathname === '/api/connections') {
    return json(store.connections)
  }

  if (method === 'POST' && pathname === '/api/connections') {
    const body = (await request.json()) as {
      name: string
      notes?: string
      event?: string
      photo_url?: string
      source_profile_id?: string
    }
    const connection: StoredConnection = {
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      name: body.name,
      notes: body.notes,
      event: body.event,
      photo_url: body.photo_url,
      source_profile_id: body.source_profile_id,
      created_at: new Date().toISOString(),
    }
    writeStore({ ...store, connections: [connection, ...store.connections] })
    return json(connection)
  }

  const connectionDeleteMatch = pathname.match(/^\/api\/connections\/([^/]+)$/)
  if (method === 'DELETE' && connectionDeleteMatch) {
    const id = connectionDeleteMatch[1]
    writeStore({ ...store, connections: store.connections.filter((c) => c.id !== id) })
    return new Response(null, { status: 204 })
  }

  return json({ message: 'Not found' }, 404)
}

/**
 * Routes a request to the matching mock handler, or returns null for
 * anything the mocks don't own (Vite dev-server traffic, etc.) so the
 * caller can pass it through to the real fetch.
 */
export async function handleMockRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url, window.location.origin)

  if (url.hostname.includes('cognito-idp')) {
    return handleCognito(request)
  }

  if (url.origin === window.location.origin) {
    // Serve config the app would normally get from the deploy process.
    if (url.pathname === '/config.json') {
      return json({
        region: 'local',
        userPoolId: 'local_mock',
        userPoolClientId: 'local-mock-client',
        apiBase: '',
      })
    }
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, url)
    }
  }

  return null
}
