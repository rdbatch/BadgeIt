import { useParams, useNavigate } from 'react-router'
import { useState, useEffect } from 'react'
import { CardView } from '../components/CardView'
import { getRuntimeConfig } from '../config/runtimeConfig'
import type { Profile } from '../types/profile'

export function PublicCardPage() {
  // Exactly one of these is defined, depending on which route matched:
  // `/p/:id` (the immutable ID, e.g. from a QR code) or the generic
  // `/:slug` catch-all used for vanity URLs. `slug` captures the whole
  // segment including its `@` prefix (React Router can't express a literal
  // `@` combined with a `:param` in one segment — see router.tsx) — a
  // segment without one isn't a valid vanity URL.
  const { id, slug: rawSlug } = useParams<{ id?: string; slug?: string }>()
  const slug = rawSlug?.startsWith('@') ? rawSlug : undefined
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  // The profile's real, immutable ID — always used to identify this profile
  // in API calls (e.g. saving a connection), regardless of which URL the
  // visitor arrived on. Never the slug, since a slug can change or be
  // cleared later.
  const [profileId, setProfileId] = useState<string | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<'not-found' | 'error' | null>(null)

  useEffect(() => {
    if (!id && !slug) {
      setError('not-found')
      setIsLoading(false)
      return
    }

    async function fetchProfile() {
      try {
        const apiBase = getRuntimeConfig().apiBase
        // `slug` already carries its `@` prefix (see the param derivation
        // above), which is also what the backend expects as the signal to
        // resolve it as a slug rather than a raw ID.
        const lookup = id ?? slug
        const res = await fetch(`${apiBase}/api/profile/${lookup}`)
        if (res.status === 404) {
          setError('not-found')
          return
        }
        if (!res.ok) {
          setError('error')
          return
        }

        const data = await res.json()
        // Map snake_case API response to camelCase frontend types
        const mapped: Profile = {
          email: data.email,
          slug: data.slug,
          displayName: data.display_name,
          tagline: data.tagline,
          phone: data.phone,
          location: data.location,
          pronouns: data.pronouns,
          imageUrl: data.image_url,
          theme: data.theme ?? 'light',
          customTheme: data.custom_theme
            ? {
                bg: data.custom_theme.bg,
                text: data.custom_theme.text,
                textMuted: data.custom_theme.text_muted,
                accent: data.custom_theme.accent,
              }
            : undefined,
          displayEmail: data.display_email ?? true,
          links: data.links ?? [],
        }
        setProfile(mapped)
        setProfileId(data.id)

        // Arrived via the immutable-ID URL (e.g. a QR scan) and a vanity
        // slug is set — swap the address bar over to it. Arriving via
        // `/@:slug` directly needs no redirect, it's already the pretty URL.
        if (id && data.slug) {
          navigate(`/@${data.slug}`, { replace: true })
        }
      } catch {
        setError('error')
      } finally {
        setIsLoading(false)
      }
    }

    fetchProfile()
  }, [id, slug, navigate])

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-center" aria-live="polite" aria-busy="true">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
          <p className="mt-4 text-gray-500">Loading card...</p>
        </div>
      </main>
    )
  }

  if (error === 'not-found') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4">
        <h1 className="text-2xl font-bold text-gray-900">Card Not Found</h1>
        <p className="mt-2 text-gray-600">
          This card doesn&apos;t exist or has been deleted.
        </p>
        <a
          href="/"
          className="mt-6 rounded-lg bg-blue-600 px-6 py-3 text-white transition-colors hover:bg-blue-700"
        >
          Create your own card
        </a>
      </main>
    )
  }

  if (error === 'error') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4">
        <h1 className="text-2xl font-bold text-gray-900">Something went wrong</h1>
        <p className="mt-2 text-gray-600">
          We couldn&apos;t load this card. Please try again later.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 rounded-lg bg-blue-600 px-6 py-3 text-white transition-colors hover:bg-blue-700"
        >
          Try again
        </button>
      </main>
    )
  }

  if (!profile) return null

  return <CardView profile={profile} profileId={profileId} />
}
