export { AuthProvider } from './context'
export { useAuth } from './useAuth'
export {
  initiateAuth,
  selectEmailOtp,
  signInWithPasskey,
  respondToChallenge,
  startPasskeyRegistration,
  completePasskeyRegistration,
  listPasskeys,
  deletePasskey,
  getSession,
  clearSession,
  refreshSession,
  isSessionExpiring,
} from './service'
export type {
  AuthSession,
  AuthMode,
  InitiateAuthResult,
  WebAuthnCredentialDescription,
} from './service'
