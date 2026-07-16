import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth'
import { getRuntimeConfig } from '../config/runtimeConfig'
import {
  themes,
  getCustomThemeStyle,
  themeBgColors,
  getCachedProfileTheme,
  setCachedProfileTheme,
} from '../constants/themes'
import { useColorScheme } from '../hooks/useColorScheme'
import { ArrowLeftIcon } from '../components/SocialIcons'
import { ColorSchemeToggle } from '../components/ColorSchemeToggle'
import logo from '../assets/logo.svg'
import type { CustomThemeColors, ThemeId } from '../types/profile'

/**
 * Static "what is BadgeTag" page. Content below is intentionally simple
 * prose — free to rewrite without touching AboutPage.test.tsx, which only
 * covers the back button's behavior and the theme-switching functionality.
 */
export function AboutPage() {
  const navigate = useNavigate()
  const { session, isAuthenticated } = useAuth()

  // Signed-in visitors see their own card's theme, so the about page feels
  // like part of the same product rather than a generic marketing page.
  // Seeded from the last-known cached theme (rather than a hardcoded
  // 'light') so switching screens doesn't flash light before the profile
  // fetch below resolves.
  const [ownTheme, setOwnTheme] = useState<ThemeId>(() => getCachedProfileTheme()?.theme ?? 'light')
  const [ownCustomTheme, setOwnCustomTheme] = useState<CustomThemeColors | undefined>(
    () => getCachedProfileTheme()?.customTheme,
  )

  // Signed-out visitors get a manual light/dark toggle instead, defaulting
  // to the system's preference and persisted across visits.
  const { colorScheme, toggleColorScheme } = useColorScheme()

  useEffect(() => {
    if (!isAuthenticated || !session?.idToken) return

    fetch(`${getRuntimeConfig().apiBase}/api/profile/me`, {
      headers: { Authorization: `Bearer ${session.idToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            theme?: ThemeId
            custom_theme?: { bg: string; text: string; text_muted: string; accent: string }
          } | null,
        ) => {
          if (!data || !data.theme) return
          const customTheme = data.custom_theme
            ? {
                bg: data.custom_theme.bg,
                text: data.custom_theme.text,
                textMuted: data.custom_theme.text_muted,
                accent: data.custom_theme.accent,
              }
            : undefined
          setOwnTheme(data.theme)
          setOwnCustomTheme(customTheme)
          setCachedProfileTheme(data.theme, customTheme)
        },
      )
      .catch(() => {
        // Non-fatal — page just falls back to the light theme.
      })
  }, [isAuthenticated, session?.idToken])

  const activeThemeId: ThemeId = isAuthenticated ? ownTheme : colorScheme
  const activeTheme = themes[activeThemeId]
  const customThemeStyle = isAuthenticated
    ? getCustomThemeStyle({ theme: ownTheme, customTheme: ownCustomTheme })
    : undefined

  useEffect(() => {
    const color =
      activeThemeId === 'custom' ? (ownCustomTheme?.bg ?? '') : (themeBgColors[activeThemeId] ?? '')
    document.documentElement.style.backgroundColor = color
    return () => {
      document.documentElement.style.backgroundColor = ''
    }
  }, [activeThemeId, ownCustomTheme])

  return (
    <main
      className={`relative min-h-screen px-4 py-8 transition-colors duration-300 ${activeTheme.bg}`}
      style={customThemeStyle}
      data-testid="about-page"
    >
      {!isAuthenticated && (
        <div className="absolute top-4 right-4">
          <ColorSchemeToggle
            colorScheme={colorScheme}
            onToggle={toggleColorScheme}
            className={activeTheme.textMuted}
          />
        </div>
      )}

      <div className="mx-auto max-w-lg">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className={`flex items-center gap-2 text-sm transition-opacity hover:opacity-80 ${activeTheme.textMuted}`}
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back
        </button>

        <h1 className={`mt-6 text-2xl font-bold ${activeTheme.text}`}>About BadgeTag</h1>

        <div className="mt-4 flex justify-center">
          <img src={logo} alt="BadgeTag logo" width={120} height={120} />
        </div>

        <div className={`mt-4 space-y-4 ${activeTheme.textMuted}`}>
          <p>
            BadgeTag was created after fumbling around with trying to connect on social platforms or take pictures of badges at a conference.
            It is a lightweight digital business card that makes it easy to make scannable codes to keep with your conference badge so that next connection is just a scan away.
            Create a profile with your name, contact details, and social links, then share it instantly
            — no app required for the person you're sharing it with.
          </p>
          <p>
            When you meet someone in person who's also using BadgeTag, you can quickly save their card as a connection so you never lose
            track of who you talked to, what you discussed, or which event you met them at.
          </p>
          <p>
            Built by{' '}
            <a
              href="https://badgetag.me/@rdbatch"
              className={`underline underline-offset-2 transition-opacity hover:opacity-80 ${activeTheme.accent}`}
            >
              Ryan Batchelder
            </a>
            , who spent way more time trying to figure out how to generate a QR code in a popular professional social network app than he'd like to admit.
            With BadgeTag, he hopes no one ever has to worry about that again.
          </p>
        </div>
      </div>
    </main>
  )
}
