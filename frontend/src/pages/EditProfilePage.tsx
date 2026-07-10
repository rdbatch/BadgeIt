import { useState, useRef, useEffect, useCallback, type FormEvent, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth'
import { themes } from '../constants/themes'
import { getPlatformLabel } from '../components/SocialIcons'
import { QRModal } from '../components/QRModal'
import { Print3DModal } from '../components/Print3DModal'
import { getRuntimeConfig } from '../config/runtimeConfig'
import type { SocialLink, SocialPlatform, ThemeId } from '../types/profile'

const SOCIAL_PLATFORMS: SocialPlatform[] = [
  'linkedin', 'github', 'twitter', 'instagram', 'youtube',
  'mastodon', 'bluesky', 'website', 'custom',
]

export function EditProfilePage() {
  const { session, isAuthenticated, logout } = useAuth()
  const navigate = useNavigate()

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, navigate])

  const [displayName, setDisplayName] = useState('')
  const [tagline, setTagline] = useState('')
  const [phone, setPhone] = useState('')
  const [links, setLinks] = useState<SocialLink[]>([])
  const [theme, setTheme] = useState<ThemeId>('light')
  const [displayEmail, setDisplayEmail] = useState(true)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [saveMessage, setSaveMessage] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteEmail, setDeleteEmail] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [showQRModal, setShowQRModal] = useState(false)
  const [showPrint3DModal, setShowPrint3DModal] = useState(false)
  const [profileId, setProfileId] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const email = session?.email ?? ''

  // If a request comes back 401 despite the proactive token refresh (e.g.
  // the refresh token itself expired/was revoked), the session is no
  // longer usable — clear it and send the user back to sign in again
  // rather than showing a confusing save error.
  const handleUnauthorized = useCallback(() => {
    logout()
    navigate('/', { replace: true })
  }, [logout, navigate])

  // Load the caller's own profile (including its server-assigned id) via
  // the authenticated /me endpoint. The id is never computed client-side —
  // it's a random token assigned by the backend on first save and only
  // discoverable by the authenticated owner.
  useEffect(() => {
    if (!session?.idToken) return

    async function loadProfile() {
      try {
        const res = await fetch(`${getRuntimeConfig().apiBase}/api/profile/me`, {
          headers: {
            Authorization: `Bearer ${session?.idToken}`,
          },
        })
        if (res.status === 401) {
          handleUnauthorized()
          return
        }
        if (res.ok) {
          const data = await res.json()
          setProfileId(data.id)
          setDisplayName(data.display_name ?? '')
          setTagline(data.tagline ?? '')
          setPhone(data.phone ?? '')
          setLinks(data.links)
          setTheme(data.theme)
          setDisplayEmail(data.display_email ?? true)
          if (data.image_url) {
            setImagePreview(data.image_url)
          }
        }
        // 404 means the authenticated user has no profile yet — leave the
        // form blank; profileId stays '' until the first successful save.
      } catch {
        // New user, or a transient error — leave form blank.
      } finally {
        setIsLoading(false)
      }
    }

    loadProfile()
  }, [session?.idToken, handleUnauthorized])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setIsSaving(true)
    setSaveMessage('')

    try {
      const body = {
        email,
        display_name: displayName || undefined,
        tagline: tagline || undefined,
        phone: phone || undefined,
        theme,
        display_email: displayEmail,
        links,
      }

      const res = await fetch(`${getRuntimeConfig().apiBase}/api/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.idToken}`,
        },
        body: JSON.stringify(body),
      })

      if (res.status === 401) {
        handleUnauthorized()
        return
      }

      if (!res.ok) {
        throw new Error(`Save failed: ${res.status}`)
      }

      // The backend assigns a random profile id on first save (there's no
      // client-side id to compute anymore) — capture it so the QR code and
      // preview link work immediately for a brand-new profile.
      const saved = await res.json()
      if (saved.id) {
        setProfileId(saved.id)
      }

      // Upload image if changed
      if (imageFile) {
        const resizedData = await resizeImage(imageFile)
        const imageRes = await fetch(`${getRuntimeConfig().apiBase}/api/profile/image`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.idToken}`,
          },
          body: JSON.stringify({
            image_data: resizedData,
            content_type: 'image/jpeg',
          }),
        })

        if (imageRes.status === 401) {
          handleUnauthorized()
          return
        }

        if (!imageRes.ok) {
          throw new Error(`Image upload failed: ${imageRes.status}`)
        }
        setImageFile(null)
      }

      setSaveMessage('Saved successfully!')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Save failed'
      setSaveMessage(`Error: ${message}`)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (deleteEmail.toLowerCase() !== email.toLowerCase()) return

    setIsDeleting(true)
    try {
      const res = await fetch(`${getRuntimeConfig().apiBase}/api/profile`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.idToken}`,
        },
        body: JSON.stringify({ email }),
      })

      if (res.status === 401) {
        handleUnauthorized()
        return
      }

      if (!res.ok && res.status !== 204) {
        throw new Error(`Delete failed: ${res.status}`)
      }

      logout()
      navigate('/', { replace: true })
    } catch {
      setSaveMessage('Error: Failed to delete profile')
    } finally {
      setIsDeleting(false)
      setShowDeleteModal(false)
    }
  }

  function handleImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => {
      setImagePreview(ev.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  function addLink() {
    setLinks([...links, { platform: 'linkedin', url: '' }])
  }

  function removeLink(index: number) {
    setLinks(links.filter((_, i) => i !== index))
  }

  function updateLink(index: number, field: keyof SocialLink, value: string) {
    setLinks(
      links.map((link, i) =>
        i === index ? { ...link, [field]: value } : link,
      ),
    )
  }

  function moveLink(index: number, direction: 'up' | 'down') {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= links.length) return
    const newLinks = [...links]
    const [moved] = newLinks.splice(index, 1)
    newLinks.splice(newIndex, 0, moved)
    setLinks(newLinks)
  }

  // Applied to the edit page itself so the surrounding UI reflects the
  // currently selected theme immediately, without saving first.
  const activeTheme = themes[theme]

  if (!isAuthenticated || !session) {
    return null
  }

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading your profile...</p>
      </main>
    )
  }

  return (
    <main className={`min-h-screen px-4 py-8 transition-colors duration-300 ${activeTheme.bg}`}>
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <h1 className={`text-2xl font-bold ${activeTheme.text}`}>Edit Your Card</h1>
          <button
            type="button"
            onClick={logout}
            className={`text-sm transition-opacity hover:opacity-80 ${activeTheme.textMuted}`}
          >
            Sign out
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Profile Picture */}
          <section aria-labelledby="photo-heading">
            <h2 id="photo-heading" className={`text-sm font-medium ${activeTheme.text}`}>
              Profile Photo
            </h2>
            <div className="mt-2 flex items-center gap-4">
              {imagePreview ? (
                <img
                  src={imagePreview}
                  alt="Profile preview"
                  className="h-20 w-20 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-200 text-gray-400">
                  <svg className="h-8 w-8" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                  </svg>
                </div>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`rounded-lg border border-current/20 px-4 py-2 text-sm transition-opacity hover:opacity-80 ${activeTheme.text}`}
              >
                {imagePreview ? 'Change photo' : 'Upload photo'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
                aria-label="Upload profile photo"
              />
            </div>
          </section>

          {/* Email (read-only) */}
          <div>
            <label className={`block text-sm font-medium ${activeTheme.text}`}>
              Email
            </label>
            <p className={`mt-1 rounded-lg border border-current/20 px-4 py-3 ${activeTheme.textMuted}`}>
              {email}
            </p>
          </div>

          {/* Display Email Toggle */}
          <div className="flex items-center justify-between">
            <label htmlFor="displayEmail" className={`text-sm font-medium ${activeTheme.text}`}>
              Display Email
            </label>
            <button
              id="displayEmail"
              type="button"
              role="switch"
              aria-checked={displayEmail}
              onClick={() => setDisplayEmail(!displayEmail)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none ${
                displayEmail ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                  displayEmail ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Display Name */}
          <div>
            <label htmlFor="displayName" className={`block text-sm font-medium ${activeTheme.text}`}>
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className={`mt-1 block w-full rounded-lg border border-current/20 bg-transparent px-4 py-3 placeholder-current/40 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none ${activeTheme.text}`}
            />
          </div>

          {/* Tagline */}
          <div>
            <label htmlFor="tagline" className={`block text-sm font-medium ${activeTheme.text}`}>
              Tagline
            </label>
            <input
              id="tagline"
              type="text"
              value={tagline}
              onChange={(e) => setTagline(e.target.value.slice(0, 100))}
              placeholder="Staff Engineer @ Acme Corp"
              maxLength={100}
              className={`mt-1 block w-full rounded-lg border border-current/20 bg-transparent px-4 py-3 placeholder-current/40 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none ${activeTheme.text}`}
            />
            <p className={`mt-1 text-right text-xs ${activeTheme.textMuted}`}>
              {tagline.length}/100
            </p>
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="phone" className={`block text-sm font-medium ${activeTheme.text}`}>
              Phone <span className={`font-normal ${activeTheme.textMuted}`}>(optional)</span>
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 123-4567"
              className={`mt-1 block w-full rounded-lg border border-current/20 bg-transparent px-4 py-3 placeholder-current/40 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none ${activeTheme.text}`}
            />
          </div>

          {/* Social Links */}
          <section aria-labelledby="links-heading">
            <h2 id="links-heading" className={`text-sm font-medium ${activeTheme.text}`}>
              Social Links
            </h2>
            <div className="mt-2 space-y-3">
              {links.map((link, index) => (
                <div key={index} className="flex items-center gap-2">
                  <select
                    value={link.platform}
                    onChange={(e) => updateLink(index, 'platform', e.target.value)}
                    className={`rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm ${activeTheme.text}`}
                    aria-label={`Platform for link ${index + 1}`}
                  >
                    {SOCIAL_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {getPlatformLabel(p)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="url"
                    value={link.url}
                    onChange={(e) => updateLink(index, 'url', e.target.value)}
                    placeholder="https://..."
                    className={`min-w-0 flex-1 rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm placeholder-current/40 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none ${activeTheme.text}`}
                    aria-label={`URL for link ${index + 1}`}
                  />
                  {link.platform === 'custom' && (
                    <input
                      type="text"
                      value={link.label ?? ''}
                      onChange={(e) => updateLink(index, 'label', e.target.value)}
                      placeholder="Label"
                      className={`w-24 rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm placeholder-current/40 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none ${activeTheme.text}`}
                      aria-label={`Label for link ${index + 1}`}
                    />
                  )}
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveLink(index, 'up')}
                      disabled={index === 0}
                      className={`rounded p-1 transition-opacity hover:opacity-80 disabled:opacity-30 ${activeTheme.textMuted}`}
                      aria-label="Move link up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveLink(index, 'down')}
                      disabled={index === links.length - 1}
                      className={`rounded p-1 transition-opacity hover:opacity-80 disabled:opacity-30 ${activeTheme.textMuted}`}
                      aria-label="Move link down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLink(index)}
                      className="rounded p-1 text-red-400 hover:text-red-600"
                      aria-label="Remove link"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addLink}
                className={`w-full rounded-lg border-2 border-dashed border-current/20 px-4 py-2 text-sm transition-opacity hover:opacity-80 ${activeTheme.textMuted}`}
              >
                + Add link
              </button>
            </div>
          </section>

          {/* Theme Picker */}
          <section aria-labelledby="theme-heading">
            <h2 id="theme-heading" className={`text-sm font-medium ${activeTheme.text}`}>
              Card Theme
            </h2>
            <div className="mt-2 grid grid-cols-5 gap-3">
              {Object.values(themes).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  className={`flex flex-col items-center gap-1 rounded-lg border-2 p-2 transition-all ${
                    theme === t.id
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  aria-label={`Select ${t.name} theme`}
                  aria-pressed={theme === t.id}
                >
                  <div className={`h-8 w-8 rounded-full ${t.bg} border border-gray-200`} />
                  <span className={`text-xs ${activeTheme.textMuted}`}>{t.name}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Save Message */}
          {saveMessage && (
            <p
              className={`text-sm ${saveMessage.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}
              role="status"
            >
              {saveMessage}
            </p>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setShowQRModal(true)}
              disabled={!profileId}
              className={`rounded-lg border border-current/20 px-4 py-3 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50 ${activeTheme.text}`}
            >
              QR Code
            </button>
            <button
              type="button"
              onClick={() => setShowPrint3DModal(true)}
              disabled={!profileId}
              className={`rounded-lg border border-current/20 px-4 py-3 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50 ${activeTheme.text}`}
            >
              3D Print
            </button>
            <button
              type="button"
              onClick={() => window.open(`/p/${profileId}`, '_blank')}
              disabled={!profileId}
              className={`rounded-lg border border-current/20 px-4 py-3 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50 ${activeTheme.text}`}
            >
              Preview
            </button>
          </div>

          {/* Danger Zone */}
          <div className="border-t border-current/10 pt-6">
            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className="text-sm text-red-500 transition-colors hover:text-red-700"
            >
              Delete my card
            </button>
          </div>
        </form>

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
          >
            <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
              <h3 id="delete-dialog-title" className="text-lg font-bold text-gray-900">
                Delete Your Card
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                This action is permanent. Type your email to confirm:
              </p>
              <input
                type="email"
                value={deleteEmail}
                onChange={(e) => setDeleteEmail(e.target.value)}
                placeholder={email}
                className="mt-3 block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-900 focus:border-red-500 focus:ring-2 focus:ring-red-200 focus:outline-none"
                autoFocus
              />
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={
                    isDeleting || deleteEmail.toLowerCase() !== email.toLowerCase()
                  }
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {isDeleting ? 'Deleting...' : 'Delete permanently'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteModal(false)
                    setDeleteEmail('')
                  }}
                  className={`rounded-lg border border-current/20 px-4 py-2 text-sm transition-opacity hover:opacity-80 ${activeTheme.text}`}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* QR Code Modal */}
        {profileId && (
          <QRModal
            profileId={profileId}
            isOpen={showQRModal}
            onClose={() => setShowQRModal(false)}
            imageUrl={imagePreview ?? undefined}
          />
        )}

        {/* 3D Print Modal — owner-only, so it lives here and not on the
            public card page's QR view. */}
        {profileId && (
          <Print3DModal
            profileId={profileId}
            isOpen={showPrint3DModal}
            onClose={() => setShowPrint3DModal(false)}
          />
        )}
      </div>
    </main>
  )
}

/**
 * Resizes an image file to max 500x500 using Canvas API.
 * Returns base64-encoded JPEG data.
 */
async function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const maxSize = 500
      let { width, height } = img

      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width)
          width = maxSize
        } else {
          width = Math.round((width * maxSize) / height)
          height = maxSize
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }

      ctx.drawImage(img, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      // Remove the data:image/jpeg;base64, prefix
      const base64 = dataUrl.split(',')[1]
      resolve(base64)
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}
