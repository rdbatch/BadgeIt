import { useState, useEffect } from 'react'
import type { Profile } from '../types/profile'
import { getTheme, getCustomThemeStyle, themeBgColors } from '../constants/themes'
import { getPlatformIcon, getPlatformLabel } from '../constants/socialPlatforms'
import { EmailIcon, PhoneIcon, LocationIcon, SaveIcon, DownloadIcon } from './SocialIcons'
import { QRModal } from './QRModal'
import { SaveConnectionModal } from './SaveConnectionModal'
import { buildVCard, downloadVCardFile, fetchImageAsVCardPhoto } from '../lib/vcard'
import { useAuth } from '../auth'
import { getRuntimeConfig } from '../config/runtimeConfig'

/** Strips the protocol and trailing slash so a URL reads cleanly as link text. */
function formatUrlForDisplay(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

interface CardViewProps {
  profile: Profile
  /**
   * The profile's short ID, used to build the shareable /p/:id URL for the
   * QR code button. When omitted, the QR code button is not rendered
   * (there's no URL to encode).
   */
  profileId?: string
}

export function CardView({ profile, profileId }: CardViewProps) {
  const theme = getTheme(profile.theme)
  const hasLinks = profile.links.length > 0
  const [showQRModal, setShowQRModal] = useState(false)
  const [isSavingContact, setIsSavingContact] = useState(false)
  const { session, isAuthenticated } = useAuth()
  const [ownProfileId, setOwnProfileId] = useState<string | null>(null)
  const [showSaveConnectionModal, setShowSaveConnectionModal] = useState(false)

  // Only signed-in viewers can save a connection, and never for their own
  // card — fetch which profile id (if any) belongs to the viewer so that
  // case can be excluded. Skipped entirely for anonymous viewers, which is
  // the common case for a shared card link.
  useEffect(() => {
    if (!isAuthenticated || !session?.idToken) {
      setOwnProfileId(null)
      return
    }

    let cancelled = false
    fetch(`${getRuntimeConfig().apiBase}/api/profile/me`, {
      headers: { Authorization: `Bearer ${session.idToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { id?: string } | null) => {
        if (!cancelled) setOwnProfileId(data?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setOwnProfileId(null)
      })

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, session?.idToken])

  const canSaveAsConnection =
    isAuthenticated && !!session?.idToken && !!profileId && ownProfileId !== profileId

  useEffect(() => {
    const color =
      profile.theme === 'custom'
        ? (profile.customTheme?.bg ?? '')
        : (themeBgColors[profile.theme] ?? '')
    document.documentElement.style.backgroundColor = color
    return () => {
      document.documentElement.style.backgroundColor = ''
    }
  }, [profile.theme, profile.customTheme])

  async function handleSaveContact() {
    setIsSavingContact(true)
    try {
      const photo = profile.imageUrl ? await fetchImageAsVCardPhoto(profile.imageUrl) : null
      const vcard = buildVCard(profile, photo ?? undefined)
      downloadVCardFile(vcard, `${profileId ?? 'badgetag'}.vcf`)
    } finally {
      setIsSavingContact(false)
    }
  }

  return (
    <article
      className={`flex min-h-screen flex-col items-center px-4 py-8 ${theme.bg}`}
      style={getCustomThemeStyle(profile)}
      data-testid="card-view"
    >
      <div className="w-full max-w-md space-y-6">
        {/* Profile Picture */}
        {profile.imageUrl && (
          <div className="flex justify-center">
            <div className="relative">
              <img
                src={profile.imageUrl}
                alt={profile.displayName ? `${profile.displayName}'s profile photo` : 'Profile photo'}
                className="h-32 w-32 rounded-full object-cover shadow-lg"
              />
              {profileId && (
                <button
                  type="button"
                  onClick={() => setShowQRModal(true)}
                  aria-label="Show QR code"
                  className="absolute right-0 bottom-0 flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-700 shadow-md ring-2 ring-white transition-colors hover:bg-gray-100"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <path d="M14 14h3v3M14 20h3M20 14v3M20 20v.01" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Display Name */}
        {profile.displayName && (
          <h1 className={`text-center text-3xl font-bold ${theme.text}`}>
            {profile.displayName}
            {profile.pronouns && (
              <span className={`ml-2 text-lg font-normal ${theme.textMuted}`}>
                ({profile.pronouns})
              </span>
            )}
          </h1>
        )}

        {/* Tagline */}
        {profile.tagline && (
          <p className={`text-center text-lg ${theme.textMuted}`}>
            {profile.tagline}
          </p>
        )}

        {/* Contact Info */}
        <div className="space-y-3">
          {/* Location */}
          {profile.location && (
            <div className={`flex items-center gap-3 rounded-lg px-4 py-3 ${theme.accent}`}>
              <LocationIcon className="h-5 w-5 shrink-0" />
              <span className="truncate">{profile.location}</span>
            </div>
          )}

          {/* Email — shown if displayEmail is true */}
          {profile.displayEmail && (
            <a
              href={`mailto:${profile.email}`}
              className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-opacity hover:opacity-80 ${theme.accent}`}
            >
              <EmailIcon className="h-5 w-5 shrink-0" />
              <span className="truncate">{profile.email}</span>
            </a>
          )}

          {/* Phone */}
          {profile.phone && (
            <a
              href={`tel:${profile.phone}`}
              className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-opacity hover:opacity-80 ${theme.accent}`}
            >
              <PhoneIcon className="h-5 w-5 shrink-0" />
              <span>{profile.phone}</span>
            </a>
          )}
        </div>

        {/* Social Links */}
        {hasLinks && (
          <nav aria-label="Social links" className="space-y-2">
            {profile.links.map((link, index) => {
              const Icon = getPlatformIcon(link.platform)
              const isGenericLink = link.platform === 'website' || link.platform === 'custom'
              // A Discord entry without an http(s) scheme is a bare
              // username (see EditProfilePage's normalizeLinkUrl) — shown
              // as plain text since there's nowhere useful to link it to.
              const isDiscordUsername = link.platform === 'discord' && !/^https?:\/\//i.test(link.url)

              if (isDiscordUsername) {
                return (
                  <div
                    key={`${link.platform}-${index}`}
                    className={`flex items-center gap-3 rounded-lg border border-current/10 px-4 py-3 ${theme.accent}`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className="truncate">{link.label ?? link.url}</span>
                  </div>
                )
              }

              const label =
                link.label ??
                (isGenericLink || link.platform === 'discord'
                  ? formatUrlForDisplay(link.url)
                  : getPlatformLabel(link.platform))

              return (
                <a
                  key={`${link.platform}-${index}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-3 rounded-lg border border-current/10 px-4 py-3 transition-opacity hover:opacity-80 ${theme.accent}`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="truncate">{label}</span>
                </a>
              )
            })}
          </nav>
        )}

        {/* Download Contact Card */}
        <button
          type="button"
          onClick={handleSaveContact}
          disabled={isSavingContact}
          className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 font-medium transition-opacity hover:opacity-80 disabled:opacity-50 ${theme.accent}`}
        >
          <DownloadIcon className="h-5 w-5 shrink-0" />
          {isSavingContact ? 'Preparing contact...' : 'Download Contact Card'}
        </button>

        {/* Save as Connection — signed-in viewers only, never on your own card */}
        {canSaveAsConnection && (
          <button
            type="button"
            onClick={() => setShowSaveConnectionModal(true)}
            className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 font-medium transition-opacity hover:opacity-80 ${theme.accent}`}
          >
            <SaveIcon className="h-5 w-5 shrink-0" />
            Save as Connection
          </button>
        )}

        {/* Footer */}
        <footer className={`pt-8 text-center text-sm ${theme.textMuted}`}>
          <a
            href="/"
            className="opacity-60 transition-opacity hover:opacity-100"
          >
            Made with BadgeTag
          </a>
        </footer>
      </div>

      {/* QR Code Modal — read-only view, no photo toggle */}
      {profileId && (
        <QRModal
          profileId={profileId}
          isOpen={showQRModal}
          onClose={() => setShowQRModal(false)}
          imageUrl={profile.imageUrl}
          showPhotoToggle={false}
          slug={profile.slug}
        />
      )}

      {canSaveAsConnection && profileId && session?.idToken && (
        <SaveConnectionModal
          isOpen={showSaveConnectionModal}
          onClose={() => setShowSaveConnectionModal(false)}
          idToken={session.idToken}
          prefill={{
            name: profile.displayName ?? 'Someone',
            photoUrl: profile.imageUrl,
            sourceProfileId: profileId,
          }}
        />
      )}
    </article>
  )
}
