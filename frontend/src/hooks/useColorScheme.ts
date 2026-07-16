import { useState } from 'react'

const COLOR_SCHEME_KEY = 'badgetag-color-scheme'

export type ColorScheme = 'light' | 'dark'

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

function getInitialColorScheme(): ColorScheme {
  const stored = localStorage.getItem(COLOR_SCHEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return systemPrefersDark() ? 'dark' : 'light'
}

/**
 * Manual light/dark toggle for signed-out pages (landing, about). Defaults
 * to the system's `prefers-color-scheme` and is persisted in localStorage,
 * so the choice is remembered across pages and visits until the user signs
 * in, at which point their own profile theme takes over instead.
 */
export function useColorScheme() {
  const [colorScheme, setColorScheme] = useState<ColorScheme>(getInitialColorScheme)

  function toggleColorScheme() {
    setColorScheme((prev) => {
      const next: ColorScheme = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem(COLOR_SCHEME_KEY, next)
      return next
    })
  }

  return { colorScheme, toggleColorScheme }
}
