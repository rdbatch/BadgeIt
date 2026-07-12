import type {
  AuthenticationResultType,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { authConfig } from './config'

type CognitoSdk = typeof import('@aws-sdk/client-cognito-identity-provider')

let sdkPromise: Promise<CognitoSdk> | null = null
let client: CognitoIdentityProviderClient | null = null

/**
 * Lazily loads the (large) Cognito SDK and creates the client using the
 * current runtime config, so it's kept out of the main bundle until a user
 * actually starts the login flow. Must only be called after
 * loadRuntimeConfig() has resolved.
 */
async function getClient(): Promise<{ client: CognitoIdentityProviderClient; sdk: CognitoSdk }> {
  if (!sdkPromise) {
    sdkPromise = import('@aws-sdk/client-cognito-identity-provider')
  }
  const sdk = await sdkPromise
  if (!client) {
    client = new sdk.CognitoIdentityProviderClient({
      region: authConfig.region,
    })
  }
  return { client, sdk }
}

export interface AuthSession {
  idToken: string
  accessToken: string
  /**
   * The refresh token, used to silently obtain new ID/access tokens without
   * forcing the user through the OTP flow again. Absent if Cognito didn't
   * return one (shouldn't happen for USER_AUTH, but kept optional for
   * safety when reading older sessions from storage).
   */
  refreshToken?: string
  /** Epoch ms when the ID/access token expires. */
  expiresAt: number
  email: string
}

const SESSION_KEY = 'badgeit-auth-session'
const CHALLENGE_SESSION_KEY = 'badgeit-challenge-session'

/**
 * How long before actual expiry we proactively refresh, to avoid a request
 * racing the expiry boundary.
 */
const REFRESH_SKEW_MS = 60_000

/**
 * Initiates the USER_AUTH flow with email OTP.
 * Cognito sends a one-time code to the user's email automatically.
 * Returns the session string needed for RespondToAuthChallenge.
 *
 * Because the User Pool Client has `preventUserExistenceErrors` enabled
 * (to prevent user enumeration), Cognito never throws UserNotFoundException
 * from InitiateAuth — it returns a fake challenge instead. So we always
 * attempt sign-up first (idempotent, UsernameExistsException is swallowed)
 * to ensure the user exists and is confirmed before initiating auth.
 */
export async function initiateAuth(email: string): Promise<string> {
  // Ensure the user exists (no-op if they already do).
  await signUpUser(email)

  const { client, sdk } = await getClient()
  const response = await client.send(new sdk.InitiateAuthCommand({
    AuthFlow: 'USER_AUTH',
    ClientId: authConfig.clientId,
    AuthParameters: {
      USERNAME: email,
      PREFERRED_CHALLENGE: 'EMAIL_OTP',
    },
  }),)

  const session = response.Session
  if (!session) {
    throw new Error('No session returned from InitiateAuth')
  }

  // Store session temporarily for the challenge response
  sessionStorage.setItem(CHALLENGE_SESSION_KEY, session)
  return session
}

/**
 * Responds to the EMAIL_OTP challenge with the verification code.
 * On success, stores the auth session in localStorage.
 */
export async function respondToChallenge(
  email: string,
  code: string,
): Promise<AuthSession> {
  const challengeSession = sessionStorage.getItem(CHALLENGE_SESSION_KEY)
  if (!challengeSession) {
    throw new Error('No active challenge session')
  }

  const { client, sdk } = await getClient()
  const response = await client.send(new sdk.RespondToAuthChallengeCommand({
    ChallengeName: 'EMAIL_OTP',
    ClientId: authConfig.clientId,
    ChallengeResponses: {
      USERNAME: email,
      EMAIL_OTP_CODE: code,
    },
    Session: challengeSession,
  }),)

  if (!response.AuthenticationResult) {
    throw new Error('Authentication not complete')
  }

  const session = toAuthSession(response.AuthenticationResult, email)

  // Store in localStorage (persists across tab/browser close) so a signed-in
  // user stays signed in for the life of the refresh token, not just the tab.
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  sessionStorage.removeItem(CHALLENGE_SESSION_KEY)

  return session
}

/**
 * Converts a Cognito AuthenticationResult into our AuthSession shape,
 * resolving ExpiresIn (seconds, relative) to an absolute epoch-ms timestamp.
 */
function toAuthSession(result: AuthenticationResultType, email: string): AuthSession {
  const expiresInSeconds = result.ExpiresIn ?? 3600
  return {
    idToken: result.IdToken ?? '',
    accessToken: result.AccessToken ?? '',
    refreshToken: result.RefreshToken,
    expiresAt: Date.now() + expiresInSeconds * 1000,
    email,
  }
}

/**
 * Gets the current auth session from localStorage.
 * Returns null if not authenticated.
 */
export function getSession(): AuthSession | null {
  const stored = localStorage.getItem(SESSION_KEY)
  if (!stored) return null

  try {
    return JSON.parse(stored) as AuthSession
  } catch {
    return null
  }
}

/**
 * Returns true if the session's ID/access token has expired (or is within
 * REFRESH_SKEW_MS of expiring).
 */
export function isSessionExpiring(session: AuthSession): boolean {
  return Date.now() >= session.expiresAt - REFRESH_SKEW_MS
}

/**
 * Silently exchanges the stored refresh token for a new ID/access token,
 * without requiring the user to go through the OTP challenge again.
 * Updates localStorage and returns the refreshed session.
 *
 * Throws if there is no session, no refresh token, or the refresh token
 * itself has expired/been revoked (caller should treat this as "must
 * re-authenticate").
 */
export async function refreshSession(): Promise<AuthSession> {
  const current = getSession()
  if (!current?.refreshToken) {
    throw new Error('No refresh token available')
  }

  const { client, sdk } = await getClient()
  let response
  try {
    response = await client.send(new sdk.InitiateAuthCommand({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: authConfig.clientId,
      AuthParameters: {
        REFRESH_TOKEN: current.refreshToken,
      },
    }))
  } catch (error: unknown) {
    if (error instanceof sdk.NotAuthorizedException) {
      // Refresh token expired or revoked — session cannot be salvaged.
      clearSession()
    }
    throw error
  }

  if (!response.AuthenticationResult) {
    throw new Error('Refresh did not return an authentication result')
  }

  // REFRESH_TOKEN_AUTH does not return a new RefreshToken — keep the
  // existing one, which stays valid until its own (longer) expiry.
  const refreshed: AuthSession = {
    ...toAuthSession(response.AuthenticationResult, current.email),
    refreshToken: current.refreshToken,
  }

  localStorage.setItem(SESSION_KEY, JSON.stringify(refreshed))
  return refreshed
}

/**
 * Clears the auth session (logout).
 */
export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
  sessionStorage.removeItem(CHALLENGE_SESSION_KEY)
}

/**
 * Signs up a new user with a random password.
 * The password is never used since we authenticate via EMAIL_OTP.
 * The Pre Sign-up Lambda trigger auto-confirms the user and verifies their
 * email, so no separate confirmation step is needed here.
 */
async function signUpUser(email: string): Promise<void> {
  const randomPassword = crypto.randomUUID() + 'Aa1!'

  try {
    const { client, sdk } = await getClient()
    await client.send(new sdk.SignUpCommand({
      ClientId: authConfig.clientId,
      Username: email,
      Password: randomPassword,
      UserAttributes: [
        {
          Name: 'email',
          Value: email,
        },
      ],
    }),)
  } catch (error: unknown) {
    // If user already exists, that's fine — we'll just authenticate
    if (error instanceof Error && error.name === 'UsernameExistsException') {
      return
    }
    throw error
  }
}
