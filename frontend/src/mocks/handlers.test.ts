import {
  handleMockRequest,
  MOCK_ID_TOKEN,
  MOCK_STORE_KEY,
  seedDemoProfile,
} from './handlers'

const AUTH_HEADER = { Authorization: `Bearer ${MOCK_ID_TOKEN}` }

function request(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Request {
  return new Request(new URL(path, window.location.origin), init)
}

function cognitoRequest(target: string, body: unknown): Request {
  return new Request('https://cognito-idp.local.amazonaws.com/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  localStorage.clear()
  seedDemoProfile()
})

describe('seedDemoProfile', () => {
  it('does not overwrite existing local edits', async () => {
    const res = await handleMockRequest(
      request('/api/profile', {
        method: 'PUT',
        headers: AUTH_HEADER,
        body: JSON.stringify({ email: 'me@example.com', theme: 'dark', display_email: false, links: [] }),
      }),
    )
    expect(res?.status).toBe(200)

    seedDemoProfile()

    const me = await handleMockRequest(
      request('/api/profile/me', { headers: AUTH_HEADER }),
    )
    const profile = await me?.json()
    expect(profile.email).toBe('me@example.com')
  })
})

describe('Cognito handlers', () => {
  it('answers InitiateAuth with an OTP challenge', async () => {
    const res = await handleMockRequest(
      cognitoRequest('InitiateAuth', { AuthFlow: 'USER_AUTH' }),
    )
    expect(res?.status).toBe(200)
    const body = await res?.json()
    expect(body.ChallengeName).toBe('EMAIL_OTP')
    expect(body.Session).toBeTruthy()
  })

  it('accepts any code in RespondToAuthChallenge and returns tokens', async () => {
    const res = await handleMockRequest(
      cognitoRequest('RespondToAuthChallenge', {
        ChallengeResponses: { EMAIL_OTP_CODE: 'whatever' },
      }),
    )
    const body = await res?.json()
    expect(body.AuthenticationResult.IdToken).toBe(MOCK_ID_TOKEN)
    expect(body.AuthenticationResult.RefreshToken).toBeTruthy()
    expect(body.AuthenticationResult.ExpiresIn).toBeGreaterThan(0)
  })

  it('answers a token refresh without rotating the refresh token', async () => {
    const res = await handleMockRequest(
      cognitoRequest('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH' }),
    )
    const body = await res?.json()
    expect(body.AuthenticationResult.IdToken).toBe(MOCK_ID_TOKEN)
    expect(body.AuthenticationResult.RefreshToken).toBeUndefined()
  })

  it('confirms sign-up for any email', async () => {
    const res = await handleMockRequest(
      cognitoRequest('SignUp', { Username: 'anyone@example.com' }),
    )
    const body = await res?.json()
    expect(body.UserConfirmed).toBe(true)
  })
})

describe('profile API handlers', () => {
  it('serves runtime config', async () => {
    const res = await handleMockRequest(request('/config.json'))
    const config = await res?.json()
    expect(config.apiBase).toBe('')
    expect(config.userPoolId).toBeTruthy()
  })

  it('rejects authenticated routes without the mock token', async () => {
    const me = await handleMockRequest(request('/api/profile/me'))
    expect(me?.status).toBe(401)

    const put = await handleMockRequest(
      request('/api/profile', { method: 'PUT', body: '{}' }),
    )
    expect(put?.status).toBe(401)
  })

  it('returns the seeded profile from /me', async () => {
    const res = await handleMockRequest(
      request('/api/profile/me', { headers: AUTH_HEADER }),
    )
    expect(res?.status).toBe(200)
    const profile = await res?.json()
    expect(profile.id).toBeTruthy()
    expect(profile.display_name).toBe('Ada Lovelace')
  })

  it('updates the profile on PUT, preserving id and image', async () => {
    const imageRes = await handleMockRequest(
      request('/api/profile/image', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: JSON.stringify({ image_data: 'aGk=', content_type: 'image/jpeg' }),
      }),
    )
    expect(imageRes?.status).toBe(200)

    const before = await (
      await handleMockRequest(request('/api/profile/me', { headers: AUTH_HEADER }))
    )?.json()

    const res = await handleMockRequest(
      request('/api/profile', {
        method: 'PUT',
        headers: AUTH_HEADER,
        body: JSON.stringify({
          email: 'ada@example.com',
          display_name: 'Ada King',
          theme: 'dark',
          display_email: false,
          links: [],
        }),
      }),
    )
    const saved = await res?.json()
    expect(saved.id).toBe(before.id)
    expect(saved.display_name).toBe('Ada King')
    expect(saved.image_url).toBe('data:image/jpeg;base64,aGk=')
  })

  it('serves the public card by id without auth and 404s unknown ids', async () => {
    const me = await (
      await handleMockRequest(request('/api/profile/me', { headers: AUTH_HEADER }))
    )?.json()

    const found = await handleMockRequest(request(`/api/profile/${me.id}`))
    expect(found?.status).toBe(200)

    const missing = await handleMockRequest(request('/api/profile/nope'))
    expect(missing?.status).toBe(404)
  })

  it('deletes the profile and then 404s /me', async () => {
    const del = await handleMockRequest(
      request('/api/profile', { method: 'DELETE', headers: AUTH_HEADER, body: '{}' }),
    )
    expect(del?.status).toBe(204)

    const me = await handleMockRequest(
      request('/api/profile/me', { headers: AUTH_HEADER }),
    )
    expect(me?.status).toBe(404)
  })

  it('persists the store in localStorage', () => {
    expect(localStorage.getItem(MOCK_STORE_KEY)).toContain('Ada Lovelace')
  })

  it('passes through requests the mocks do not own', async () => {
    expect(await handleMockRequest(request('/some-asset.svg'))).toBeNull()
    expect(
      await handleMockRequest(new Request('https://example.com/api/profile/me')),
    ).toBeNull()
  })
})
