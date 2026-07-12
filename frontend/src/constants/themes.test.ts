import { getTheme, getCustomThemeStyle, themes } from './themes'

describe('getTheme', () => {
  it('returns the custom theme entry referencing CSS custom properties', () => {
    const custom = getTheme('custom')
    expect(custom.bg).toBe('[background-color:var(--badgeit-bg)]')
    expect(custom.text).toBe('[color:var(--badgeit-text)]')
    expect(custom.textMuted).toBe('[color:var(--badgeit-text-muted)]')
    expect(custom.accent).toBe('[color:var(--badgeit-accent)]')
  })

  it('no longer has an amber preset', () => {
    expect(Object.keys(themes)).not.toContain('amber')
    expect(Object.keys(themes)).toContain('custom')
  })
})

describe('getCustomThemeStyle', () => {
  it('returns undefined for a non-custom theme', () => {
    expect(getCustomThemeStyle({ theme: 'light', customTheme: undefined })).toBeUndefined()
  })

  it('returns undefined for the custom theme with no colors set', () => {
    expect(getCustomThemeStyle({ theme: 'custom', customTheme: undefined })).toBeUndefined()
  })

  it('builds CSS custom properties from the custom theme colors', () => {
    const style = getCustomThemeStyle({
      theme: 'custom',
      customTheme: { bg: '#111111', text: '#222222', textMuted: '#333333', accent: '#444444' },
    })
    expect(style).toEqual({
      '--badgeit-bg': '#111111',
      '--badgeit-text': '#222222',
      '--badgeit-text-muted': '#333333',
      '--badgeit-accent': '#444444',
    })
  })
})
