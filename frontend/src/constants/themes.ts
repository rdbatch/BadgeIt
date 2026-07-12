import type { CSSProperties } from 'react'
import type { CustomThemeColors, Profile, ThemeConfig, ThemeId } from '../types/profile'

export const themes: Record<ThemeId, ThemeConfig> = {
  light: {
    id: 'light',
    name: 'Light',
    bg: 'bg-white',
    text: 'text-gray-900',
    textMuted: 'text-gray-600',
    accent: 'text-blue-600',
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    bg: 'bg-gray-900',
    text: 'text-gray-100',
    textMuted: 'text-gray-400',
    accent: 'text-blue-400',
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    bg: 'bg-slate-800',
    text: 'text-sky-100',
    textMuted: 'text-sky-300',
    accent: 'text-cyan-400',
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset',
    bg: 'bg-orange-50',
    text: 'text-orange-900',
    textMuted: 'text-orange-700',
    accent: 'text-rose-600',
  },
  forest: {
    id: 'forest',
    name: 'Forest',
    bg: 'bg-emerald-950',
    text: 'text-emerald-100',
    textMuted: 'text-emerald-300',
    accent: 'text-lime-400',
  },
  lavender: {
    id: 'lavender',
    name: 'Lavender',
    bg: 'bg-purple-50',
    text: 'text-purple-900',
    textMuted: 'text-purple-600',
    accent: 'text-violet-600',
  },
  slate: {
    id: 'slate',
    name: 'Slate',
    bg: 'bg-slate-100',
    text: 'text-slate-900',
    textMuted: 'text-slate-600',
    accent: 'text-indigo-600',
  },
  rose: {
    id: 'rose',
    name: 'Rose',
    bg: 'bg-rose-50',
    text: 'text-rose-900',
    textMuted: 'text-rose-600',
    accent: 'text-pink-600',
  },
  mint: {
    id: 'mint',
    name: 'Mint',
    bg: 'bg-teal-50',
    text: 'text-teal-900',
    textMuted: 'text-teal-600',
    accent: 'text-teal-700',
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    // These reference CSS custom properties rather than fixed Tailwind
    // colors — the actual hex values are supplied at runtime via an inline
    // `style` on a shared ancestor (see getCustomThemeStyle), since
    // Tailwind can't generate classes for colors only known at runtime.
    bg: '[background-color:var(--badgeit-bg)]',
    text: '[color:var(--badgeit-text)]',
    textMuted: '[color:var(--badgeit-text-muted)]',
    accent: '[color:var(--badgeit-accent)]',
  },
}

// Actual CSS color values for each theme's background, used to set
// document.documentElement.style.backgroundColor so the overscroll area on
// mobile matches the card background (no white gap at top/bottom).
export const themeBgColors: Partial<Record<ThemeId, string>> = {
  light: '#ffffff',
  dark: '#111827',
  ocean: '#1e293b',
  sunset: '#fff7ed',
  forest: '#022c22',
  lavender: '#faf5ff',
  slate: '#f1f5f9',
  rose: '#fff1f2',
  mint: '#f0fdfa',
}

export function getTheme(id: ThemeId): ThemeConfig {
  return themes[id]
}

const CACHED_PROFILE_THEME_KEY = 'badgeit-last-theme'

interface CachedProfileTheme {
  theme: ThemeId
  customTheme?: CustomThemeColors
}

/**
 * Last-known theme for a signed-in user's own profile, cached in
 * localStorage so authenticated pages (edit, connections, about) can render
 * the right theme on first paint instead of defaulting to light while the
 * `/api/profile/me` fetch is in flight.
 */
export function getCachedProfileTheme(): CachedProfileTheme | null {
  try {
    const raw = localStorage.getItem(CACHED_PROFILE_THEME_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedProfileTheme>
    if (!parsed.theme || !(parsed.theme in themes)) return null
    return { theme: parsed.theme, customTheme: parsed.customTheme }
  } catch {
    return null
  }
}

export function setCachedProfileTheme(theme: ThemeId, customTheme?: CustomThemeColors): void {
  localStorage.setItem(CACHED_PROFILE_THEME_KEY, JSON.stringify({ theme, customTheme }))
}

/**
 * Builds the inline style carrying the custom theme's CSS custom
 * properties. Apply to a shared ancestor of every element using the
 * `custom` theme's classes (e.g. the page's outermost element) — undefined
 * for any other theme, since those use fixed Tailwind classes directly.
 */
export function getCustomThemeStyle(
  profile: Pick<Profile, 'theme' | 'customTheme'>,
): CSSProperties | undefined {
  if (profile.theme !== 'custom' || !profile.customTheme) return undefined

  const colors: CustomThemeColors = profile.customTheme
  return {
    '--badgeit-bg': colors.bg,
    '--badgeit-text': colors.text,
    '--badgeit-text-muted': colors.textMuted,
    '--badgeit-accent': colors.accent,
  } as CSSProperties
}
