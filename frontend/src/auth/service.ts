import {
  type AuthenticationResultType,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  NotAuthorizedException,
  RespondToAuthChallengeCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { authConfig } from './config'

let client: CognitoIdentityProviderClient | null = null

/**
 * Lazily creates the Cognito client using the current runtime config.
 * Must only be called after loadRuntimeConfig() has resolved.
 */
function getClient(): CognitoIdentityProviderClient {
  if (!client) {
    client = new CognitoIdentityProviderClient({
      region: authConfig.region,
    })
  }
  return client
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

  const response = await getClient().send(new InitiateAuthCommand({
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
 * On success, stores the auth session in sessionStorage.
 */
export async function respondToChallenge(
  email: string,
  code: string,
): Promise<AuthSession> {
  const challengeSession = sessionStorage.getItem(CHALLENGE_SESSION_KEY)
  if (!challengeSession) {
    throw new Error('No active challenge session')
  }

  const response = await getClient().send(new RespondToAuthChallengeCommand({
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

  // Store in sessionStorage (tab-scoped)
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
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
 * Gets the current auth session from sessionStorage.
 * Returns null if not authenticated.
 */
export function getSession(): AuthSession | null {
  const stored = sessionStorage.getItem(SESSION_KEY)
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
 * Updates sessionStorage and returns the refreshed session.
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

  let response
  try {
    response = await getClient().send(new InitiateAuthCommand({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: authConfig.clientId,
      AuthParameters: {
        REFRESH_TOKEN: current.refreshToken,
      },
    }))
  } catch (error: unknown) {
    if (error instanceof NotAuthorizedException) {
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

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(refreshed))
  return refreshed
}

/**
 * Clears the auth session (logout).
 */
export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
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
    await getClient().send(new SignUpCommand({
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
