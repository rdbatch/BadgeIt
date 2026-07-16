import type { DocumentType } from '@smithy/types'
import type {
  AuthenticationResultType,
  CognitoIdentityProviderClient,
  WebAuthnCredentialDescription,
} from '@aws-sdk/client-cognito-identity-provider'
import { authConfig } from './config'
import {
  serializeAuthenticationCredential,
  serializeRegistrationCredential,
  toCredentialCreationOptions,
  toCredentialRequestOptions,
} from './webauthn'

export type { WebAuthnCredentialDescription } from '@aws-sdk/client-cognito-identity-provider'

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

const SESSION_KEY = 'badgetag-auth-session'
const CHALLENGE_SESSION_KEY = 'badgetag-challenge-session'
const AUTH_MODE_KEY = 'badgetag-auth-mode'

/**
 * How long before actual expiry we proactively refresh, to avoid a request
 * racing the expiry boundary.
 */
const REFRESH_SKEW_MS = 60_000

/**
 * Which code-entry path the "verify" step should take next. Brand-new
 * accounts aren't confirmed/verified until they prove they received the
 * SignUp confirmation code (ConfirmSignUp); existing accounts go straight
 * to an EMAIL_OTP sign-in challenge. The two codes come from different
 * Cognito mechanisms and have different lengths (6 digits vs 8), so callers
 * need to know which one they're collecting.
 */
export type AuthMode = 'new' | 'existing'

export interface InitiateAuthResult {
  mode: AuthMode
  /**
   * True if this account has a registered passkey and can use it to sign
   * in instead of email OTP. Only meaningful when mode === 'existing' — a
   * brand-new (just-created, unconfirmed) account can't have a passkey
   * yet, so this is always false for mode === 'new'.
   */
  hasPasskey: boolean
}

/**
 * Starts authentication for the given email and returns which code-entry
 * path to follow next, plus whether this account has a passkey it can use
 * instead.
 *
 * We always attempt sign-up first. If the account doesn't exist yet, this
 * creates it (UNCONFIRMED) and Cognito emails a SignUp confirmation code —
 * the account only becomes CONFIRMED/verified once that code is submitted
 * via ConfirmSignUp in respondToChallenge(). If the account already exists
 * (UsernameExistsException, swallowed), we start a USER_AUTH challenge
 * instead — deliberately omitting PREFERRED_CHALLENGE so Cognito returns
 * SELECT_CHALLENGE with AvailableChallenges, reporting per-account whether
 * a passkey is available *before* any credential is submitted. That
 * SELECT_CHALLENGE is intentionally left unanswered here (its Session is
 * just stored) — the caller decides, based on hasPasskey, whether to show
 * a passkey prompt, and only then calls selectEmailOtp() or
 * signInWithPasskey() to actually answer it. SELECT_CHALLENGE is single-use
 * — see signInWithPasskey()'s doc comment for why answering it eagerly
 * here would break the "let the user pick" UX.
 *
 * There is deliberately no server-side trigger that auto-confirms/verifies
 * new users at sign-up time — that would let anyone mark an arbitrary,
 * unowned email address as "verified" just by calling SignUp.
 */
export async function initiateAuth(email: string): Promise<InitiateAuthResult> {
  const isNewUser = await signUpUser(email)

  if (isNewUser) {
    sessionStorage.setItem(AUTH_MODE_KEY, 'new')
    sessionStorage.removeItem(CHALLENGE_SESSION_KEY)
    return { mode: 'new', hasPasskey: false }
  }

  sessionStorage.setItem(AUTH_MODE_KEY, 'existing')

  const { client, sdk } = await getClient()
  const response = await client.send(new sdk.InitiateAuthCommand({
    AuthFlow: 'USER_AUTH',
    ClientId: authConfig.clientId,
    AuthParameters: {
      USERNAME: email,
    },
  }),)

  const session = response.Session
  if (!session) {
    throw new Error('No session returned from InitiateAuth')
  }

  // Store session temporarily for the challenge response — left
  // unanswered until the caller picks a path (see doc comment above).
  sessionStorage.setItem(CHALLENGE_SESSION_KEY, session)
  const hasPasskey = (response.AvailableChallenges ?? []).includes('WEB_AUTHN')
  return { mode: 'existing', hasPasskey }
}

/**
 * Answers the pending SELECT_CHALLENGE session (from initiateAuth) by
 * choosing the EMAIL_OTP path, triggering Cognito to email a code. Must be
 * called at most once per initiateAuth() session — SELECT_CHALLENGE is a
 * single-use challenge step, consumed by this call regardless of which
 * ANSWER is sent (see signInWithPasskey()'s doc comment).
 *
 * The response's Session (for the resulting EMAIL_OTP challenge) replaces
 * the stored SELECT_CHALLENGE session — respondToChallenge()'s existing
 * EMAIL_OTP branch reads it from the same storage key.
 */
export async function selectEmailOtp(email: string): Promise<void> {
  const session = sessionStorage.getItem(CHALLENGE_SESSION_KEY)
  if (!session) {
    throw new Error('No active challenge session')
  }

  const { client, sdk } = await getClient()
  const response = await client.send(new sdk.RespondToAuthChallengeCommand({
    ChallengeName: 'SELECT_CHALLENGE',
    ClientId: authConfig.clientId,
    ChallengeResponses: {
      USERNAME: email,
      ANSWER: 'EMAIL_OTP',
    },
    Session: session,
  }))

  const nextSession = response.Session
  if (!nextSession) {
    throw new Error('No session returned from SELECT_CHALLENGE')
  }
  sessionStorage.setItem(CHALLENGE_SESSION_KEY, nextSession)
}

/**
 * Completes the WEB_AUTHN path of the pending SELECT_CHALLENGE session
 * (from initiateAuth): answers SELECT_CHALLENGE with WEB_AUTHN to obtain
 * CREDENTIAL_REQUEST_OPTIONS, resolves it via navigator.credentials.get(),
 * then responds to the resulting WEB_AUTHN challenge with the signed
 * assertion. On success, stores the auth session exactly like
 * respondToChallenge() does.
 *
 * Must be called at most once per initiateAuth() session, and is mutually
 * exclusive with selectEmailOtp() on that same session: SELECT_CHALLENGE
 * advances (and is consumed) as soon as either is answered, even if the
 * WebAuthn ceremony itself then fails client-side (e.g. the user cancels
 * the passkey prompt) — there is no going back to try the other option on
 * the same session afterward. Callers must recover from any failure here
 * by starting over with a fresh initiateAuth() call, not by retrying the
 * other path on the same session.
 */
export async function signInWithPasskey(email: string): Promise<AuthSession> {
  const session = sessionStorage.getItem(CHALLENGE_SESSION_KEY)
  if (!session) {
    throw new Error('No active challenge session')
  }

  const { client, sdk } = await getClient()

  const selectResponse = await client.send(new sdk.RespondToAuthChallengeCommand({
    ChallengeName: 'SELECT_CHALLENGE',
    ClientId: authConfig.clientId,
    ChallengeResponses: {
      USERNAME: email,
      ANSWER: 'WEB_AUTHN',
    },
    Session: session,
  }))

  const requestOptionsJson = selectResponse.ChallengeParameters?.CREDENTIAL_REQUEST_OPTIONS
  const webAuthnSession = selectResponse.Session
  if (!requestOptionsJson || !webAuthnSession) {
    throw new Error('No WEB_AUTHN challenge returned from SELECT_CHALLENGE')
  }

  const options = toCredentialRequestOptions(JSON.parse(requestOptionsJson))
  const credential = await navigator.credentials.get(options)
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('Passkey sign-in did not return a credential')
  }

  const response = await client.send(new sdk.RespondToAuthChallengeCommand({
    ChallengeName: 'WEB_AUTHN',
    ClientId: authConfig.clientId,
    ChallengeResponses: {
      USERNAME: email,
      CREDENTIAL: JSON.stringify(serializeAuthenticationCredential(credential)),
    },
    Session: webAuthnSession,
  }))

  return finishSignIn(response.AuthenticationResult, email)
}

/**
 * Completes authentication with the code the user was emailed. Branches on
 * the mode recorded by initiateAuth():
 * - 'new': confirms the SignUp code (ConfirmSignUp), which both verifies
 *   the email and moves the user to CONFIRMED, then immediately exchanges
 *   the Session that ConfirmSignUp returns for tokens via InitiateAuth —
 *   Cognito's documented way to sign a user in right after their first
 *   confirmation, with no second code required.
 * - 'existing': responds to the EMAIL_OTP sign-in challenge as before.
 *
 * On success, stores the auth session in localStorage.
 */
export async function respondToChallenge(
  email: string,
  code: string,
): Promise<AuthSession> {
  const mode = sessionStorage.getItem(AUTH_MODE_KEY)
  const { client, sdk } = await getClient()

  let authResult: AuthenticationResultType | undefined

  if (mode === 'new') {
    const confirmResponse = await client.send(new sdk.ConfirmSignUpCommand({
      ClientId: authConfig.clientId,
      Username: email,
      ConfirmationCode: code,
    }))

    const confirmSession = confirmResponse.Session
    if (!confirmSession) {
      throw new Error('No session returned from ConfirmSignUp')
    }

    const signInResponse = await client.send(new sdk.InitiateAuthCommand({
      AuthFlow: 'USER_AUTH',
      ClientId: authConfig.clientId,
      Session: confirmSession,
      AuthParameters: {
        USERNAME: email,
      },
    }))

    authResult = signInResponse.AuthenticationResult
  } else {
    const challengeSession = sessionStorage.getItem(CHALLENGE_SESSION_KEY)
    if (!challengeSession) {
      throw new Error('No active challenge session')
    }

    const response = await client.send(new sdk.RespondToAuthChallengeCommand({
      ChallengeName: 'EMAIL_OTP',
      ClientId: authConfig.clientId,
      ChallengeResponses: {
        USERNAME: email,
        EMAIL_OTP_CODE: code,
      },
      Session: challengeSession,
    }),)

    authResult = response.AuthenticationResult
  }

  return finishSignIn(authResult, email)
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
 * Shared tail end of every sign-in path (email OTP, new-account
 * confirmation, and passkey): persists the session to localStorage and
 * clears the now-finished challenge state.
 */
function finishSignIn(
  authResult: AuthenticationResultType | undefined,
  email: string,
): AuthSession {
  if (!authResult) {
    throw new Error('Authentication not complete')
  }

  const session = toAuthSession(authResult, email)

  // Store in localStorage (persists across tab/browser close) so a signed-in
  // user stays signed in for the life of the refresh token, not just the tab.
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  sessionStorage.removeItem(CHALLENGE_SESSION_KEY)
  sessionStorage.removeItem(AUTH_MODE_KEY)

  return session
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
  sessionStorage.removeItem(AUTH_MODE_KEY)
}

/** The currently signed-in user's access token, or throws if there is none. */
function requireAccessToken(): string {
  const session = getSession()
  if (!session) {
    throw new Error('No active session')
  }
  return session.accessToken
}

/**
 * Begins registering a new passkey for the currently signed-in user.
 * Requires an active session (uses its access token, which already carries
 * the aws.cognito.signin.user.admin scope this API needs — no separate
 * scope configuration required). Returns the browser CredentialCreationOptions
 * to pass to navigator.credentials.create() — callers are responsible for
 * calling that and then completePasskeyRegistration() with the result.
 */
export async function startPasskeyRegistration(): Promise<CredentialCreationOptions> {
  const accessToken = requireAccessToken()
  const { client, sdk } = await getClient()

  const response = await client.send(new sdk.StartWebAuthnRegistrationCommand({
    AccessToken: accessToken,
  }))

  if (!response.CredentialCreationOptions) {
    throw new Error('No CredentialCreationOptions returned from StartWebAuthnRegistration')
  }

  return toCredentialCreationOptions(response.CredentialCreationOptions)
}

/**
 * Finishes passkey registration with the credential the browser produced
 * from the options returned by startPasskeyRegistration().
 */
export async function completePasskeyRegistration(
  credential: PublicKeyCredential,
): Promise<void> {
  const accessToken = requireAccessToken()
  const { client, sdk } = await getClient()

  await client.send(new sdk.CompleteWebAuthnRegistrationCommand({
    AccessToken: accessToken,
    // Passed as the plain object, not JSON.stringify'd — Credential is
    // typed __DocumentType (SDK marshals it as part of the request body),
    // unlike RespondToAuthChallenge's CREDENTIAL field, which is a
    // string-typed field requiring an explicit JSON.stringify (see
    // signInWithPasskey above). Confirmed from the SDK's type definitions;
    // verify empirically against real Cognito the first time this runs.
    // The cast is needed because DocumentType is a recursive
    // null|boolean|number|string|DocumentType[]|{[key:string]:DocumentType}
    // union that plain `Record<string, unknown>` doesn't structurally
    // satisfy, even though every value here is JSON-serializable.
    Credential: serializeRegistrationCredential(credential) as unknown as DocumentType,
  }))
}

/** Lists all passkeys registered to the currently signed-in user. */
export async function listPasskeys(): Promise<WebAuthnCredentialDescription[]> {
  const accessToken = requireAccessToken()
  const { client, sdk } = await getClient()

  const response = await client.send(new sdk.ListWebAuthnCredentialsCommand({
    AccessToken: accessToken,
  }))

  return response.Credentials ?? []
}

/** Deletes a single registered passkey by its CredentialId. */
export async function deletePasskey(credentialId: string): Promise<void> {
  const accessToken = requireAccessToken()
  const { client, sdk } = await getClient()

  await client.send(new sdk.DeleteWebAuthnCredentialCommand({
    AccessToken: accessToken,
    CredentialId: credentialId,
  }))
}

/**
 * Signs up a new user with a random password. The password is never used
 * since we authenticate via EMAIL_OTP; it's only required because Cognito
 * still requires password auth to remain enabled on the pool.
 *
 * Returns whether this call actually created a new (UNCONFIRMED) user, so
 * the caller can pick the right next step.
 */
async function signUpUser(email: string): Promise<boolean> {
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
    return true
  } catch (error: unknown) {
    // If user already exists, that's fine — we'll just authenticate
    if (error instanceof Error && error.name === 'UsernameExistsException') {
      return false
    }
    throw error
  }
}
