import type { ThemeConfig, ThemeId } from '../types/profile'

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
  amber: {
    id: 'amber',
    name: 'Amber',
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    textMuted: 'text-amber-700',
    accent: 'text-amber-800',
  },
}

export function getTheme(id: ThemeId): ThemeConfig {
  return themes[id]
}
