import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useAuth, initiateAuth, respondToChallenge } from '../auth'

type AuthStep = 'email' | 'verify'

export function LandingPage() {
  const [step, setStep] = useState<AuthStep>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const { isAuthenticated, syncSession } = useAuth()

  // If already authenticated, redirect to edit
  if (isAuthenticated) {
    navigate('/edit', { replace: true })
    return null
  }

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      await initiateAuth(email.trim().toLowerCase())
      setStep('verify')
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to send verification code'
      setError(message)
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
      navigate('/edit', { replace: true })
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Verification failed'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900">BadgeIt</h1>
          <p className="mt-2 text-lg text-gray-600">
            Your lightweight digital business card
          </p>
        </div>

        {/* Email Step */}
        {step === 'email' && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
          </form>
        )}

        {/* Verification Code Step */}
        {step === 'verify' && (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-gray-600">
                We sent a verification code to{' '}
                <span className="font-medium text-gray-900">{email}</span>
              </p>
            </div>

            <div>
              <label
                htmlFor="code"
                className="block text-sm font-medium text-gray-700"
              >
                Verification code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{8}"
                maxLength={8}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="12345678"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-2xl tracking-widest text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
              disabled={isLoading || code.length !== 8}
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
              className="w-full text-sm text-gray-500 transition-colors hover:text-gray-700"
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
