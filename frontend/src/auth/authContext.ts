import { createContext } from 'react'
import type { AuthSession } from './service'

export interface AuthContextValue {
  session: AuthSession | null
  isAuthenticated: boolean
  /** Re-reads the session from localStorage (e.g. after completing the OTP flow) */
  syncSession: () => void
  /** Logs the user out */
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
