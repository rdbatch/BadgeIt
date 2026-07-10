import { useState } from 'react'
import type { Profile } from '../types/profile'
import { getTheme } from '../constants/themes'
import { getPlatformIcon, getPlatformLabel, EmailIcon, PhoneIcon } from './SocialIcons'
import { QRModal } from './QRModal'

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

  return (
    <article
      className={`flex min-h-screen flex-col items-center px-4 py-8 ${theme.bg}`}
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
              const label = link.label ?? getPlatformLabel(link.platform)

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

        {/* Footer */}
        <footer className={`pt-8 text-center text-sm ${theme.textMuted}`}>
          <a
            href="/"
            className="opacity-60 transition-opacity hover:opacity-100"
          >
            Made with BadgeIt
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
        />
      )}
    </article>
  )
}
