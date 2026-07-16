import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router'
import {
  useAuth,
  initiateAuth,
  selectEmailOtp,
  signInWithPasskey,
  respondToChallenge,
  startPasskeyRegistration,
  completePasskeyRegistration,
  type AuthMode,
} from '../auth'
import { themes, themeBgColors } from '../constants/themes'
import { useColorScheme } from '../hooks/useColorScheme'
import { ColorSchemeToggle } from '../components/ColorSchemeToggle'
import { RotatingTagline } from '../components/RotatingTagline'
import logo from '../assets/logo.svg'

type AuthStep = 'email' | 'choose-method' | 'verify' | 'setup-passkey'

/** True for a WebAuthn ceremony the user themselves dismissed/cancelled. */
function isUserCancellation(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotAllowedError'
}

/**
 * Cognito's SignUp confirmation code (new accounts) and EMAIL_OTP sign-in
 * code (existing accounts) are different lengths — 6 digits vs. 8 — so the
 * code input has to adapt to which one was actually sent.
 */
const CODE_LENGTH: Record<AuthMode, number> = {
  new: 6,
  existing: 8,
}

export function LandingPage() {
  const [step, setStep] = useState<AuthStep>('email')
  const [authMode, setAuthMode] = useState<AuthMode>('existing')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const { isAuthenticated, syncSession } = useAuth()
  const { colorScheme, toggleColorScheme } = useColorScheme()
  const activeTheme = themes[colorScheme]

  // If already authenticated, redirect to edit. This must happen in an
  // effect, not during render — calling navigate() synchronously while
  // rendering is undefined behavior (React warns "Cannot update a
  // component while rendering a different component") and was observed to
  // render a blank page in Safari specifically, whenever a session was
  // already present in localStorage on mount.
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/edit', { replace: true })
    }
  }, [isAuthenticated, navigate])

  useEffect(() => {
    document.documentElement.style.backgroundColor = themeBgColors[colorScheme] ?? ''
    return () => {
      document.documentElement.style.backgroundColor = ''
    }
  }, [colorScheme])

  if (isAuthenticated) {
    return null
  }

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const { mode, hasPasskey } = await initiateAuth(email.trim().toLowerCase())
      setAuthMode(mode)
      if (mode === 'existing' && hasPasskey) {
        setStep('choose-method')
      } else if (mode === 'existing') {
        // No passkey on this account — go straight to email OTP, same as
        // before, just with one explicit selectEmailOtp() call now that
        // SELECT_CHALLENGE requires an answer before Cognito will send it.
        await selectEmailOtp(email.trim().toLowerCase())
        setStep('verify')
      } else {
        setStep('verify')
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to send verification code'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  async function handlePasskeySignIn() {
    setError('')
    setIsLoading(true)

    try {
      await signInWithPasskey(email.trim().toLowerCase())
      syncSession()
      navigate('/edit', { replace: true })
    } catch (err: unknown) {
      // SELECT_CHALLENGE is single-use and was just consumed by this
      // attempt — even a cancelled/failed passkey ceremony leaves it
      // unusable, so "Send a code via email instead" can no longer answer
      // the same session. Send the user back to a fresh initiateAuth().
      const message = isUserCancellation(err)
        ? 'Passkey sign-in was cancelled. Please try again.'
        : err instanceof Error
          ? `${err.message} Please try again.`
          : 'Passkey sign-in failed. Please try again.'
      setError(message)
      setStep('email')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleUseEmailInstead() {
    setError('')
    setIsLoading(true)

    try {
      await selectEmailOtp(email.trim().toLowerCase())
      setStep('verify')
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to send verification code. Please try again.'
      setError(message)
      setStep('email')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleCodeSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      await respondToChallenge(email.trim().toLowerCase(), code.trim())
      syncSession()
      if (authMode === 'new') {
        setStep('setup-passkey')
      } else {
        navigate('/edit', { replace: true })
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Verification failed'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSetupPasskey() {
    setError('')
    setIsLoading(true)

    try {
      const options = await startPasskeyRegistration()
      const credential = await navigator.credentials.create(options)
      if (!(credential instanceof PublicKeyCredential)) {
        throw new Error('Passkey creation did not return a credential')
      }
      await completePasskeyRegistration(credential)
      navigate('/edit', { replace: true })
    } catch (err: unknown) {
      // Unlike the sign-in path, there's no consumed challenge session
      // here — registration calls are independent/retryable against an
      // already-authenticated access token, so staying on this screen and
      // letting the user retry (or skip) is safe.
      const message = isUserCancellation(err)
        ? 'Passkey setup was cancelled.'
        : err instanceof Error
          ? err.message
          : 'Passkey setup failed'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main
      className={`relative flex min-h-screen flex-col items-center justify-center px-4 py-12 transition-colors duration-300 ${activeTheme.bg}`}
    >
      <div className="absolute top-4 right-4">
        <ColorSchemeToggle
          colorScheme={colorScheme}
          onToggle={toggleColorScheme}
          className={activeTheme.textMuted}
        />
      </div>

      <div className="w-full max-w-sm space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <img src={logo} alt="" width={40} height={40} className="h-10 w-10" />
            <h1 className={`text-4xl font-bold ${activeTheme.text}`}>BadgeTag</h1>
          </div>
          <RotatingTagline className={activeTheme.textMuted} />
        </div>

        {/* Email Step */}
        {step === 'email' && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className={`block text-sm font-medium ${activeTheme.text}`}
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={`mt-1 block w-full rounded-lg border border-current/20 bg-transparent px-4 py-3 placeholder-current/40 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none ${activeTheme.text}`}
                disabled={isLoading}
                autoComplete="email"
                autoFocus
              />
            </div>

            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading || !email.trim()}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? 'Sending code...' : 'Get started'}
            </button>

            <Link
              to="/about"
              className={`block text-center text-sm transition-opacity hover:opacity-80 ${activeTheme.textMuted}`}
            >
              About BadgeTag
            </Link>
          </form>
        )}

        {/* Choose sign-in method: passkey (if registered) or email code */}
        {step === 'choose-method' && (
          <div className="space-y-4">
            <div className="text-center">
              <p className={`text-sm ${activeTheme.textMuted}`}>
                Sign in as{' '}
                <span className={`font-medium ${activeTheme.text}`}>{email}</span>
              </p>
            </div>

            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handlePasskeySignIn}
              disabled={isLoading}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? 'Waiting for passkey...' : 'Sign in with Passkey'}
            </button>

            <button
              type="button"
              onClick={handleUseEmailInstead}
              disabled={isLoading}
              className={`w-full rounded-lg border border-current/20 px-4 py-3 font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 ${activeTheme.text}`}
            >
              Send a code via email instead
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('email')
                setError('')
              }}
              className={`w-full text-sm transition-opacity hover:opacity-80 ${activeTheme.textMuted}`}
            >
              Use a different email
            </button>
          </div>
        )}

        {/* Verification Code Step */}
        {step === 'verify' && (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div className="text-center">
              <p className={`text-sm ${activeTheme.textMuted}`}>
                We sent a verification code to{' '}
                <span className={`font-medium ${activeTheme.text}`}>{email}</span>
              </p>
            </div>

            <div>
              <label
                htmlFor="code"
                className={`block text-sm font-medium ${activeTheme.text}`}
              >
                Verification code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                pattern={`[0-9]{${CODE_LENGTH[authMode]}}`}
                maxLength={CODE_LENGTH[authMode]}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className={`mt-1 block w-full rounded-lg border border-current/20 bg-transparent px-4 py-3 text-center text-2xl tracking-widest placeholder-current/40 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none ${activeTheme.text}`}
                disabled={isLoading}
                autoFocus
              />
            </div>

            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading || code.length !== CODE_LENGTH[authMode]}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? 'Verifying...' : 'Verify'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('email')
                setCode('')
                setError('')
              }}
              className={`w-full text-sm transition-opacity hover:opacity-80 ${activeTheme.textMuted}`}
            >
              Use a different email
            </button>
          </form>
        )}

        {/* Post-signup optional passkey setup */}
        {step === 'setup-passkey' && (
          <div className="space-y-4 text-center">
            <h2 className={`text-xl font-bold ${activeTheme.text}`}>Set up a passkey?</h2>
            <p className={`text-sm ${activeTheme.textMuted}`}>
              Sign in faster next time with Face ID, Touch ID, or your device's screen lock
              — no more waiting on emailed codes.
            </p>

            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleSetupPasskey}
              disabled={isLoading}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? 'Setting up...' : 'Set up passkey'}
            </button>

            <button
              type="button"
              onClick={() => navigate('/edit', { replace: true })}
              disabled={isLoading}
              className={`w-full text-sm transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 ${activeTheme.textMuted}`}
            >
              Skip for now
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
