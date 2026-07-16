import { parseVCard } from './vcardImport'
import { buildVCard } from './vcard'
import type { Profile } from '../types/profile'

describe('parseVCard', () => {
  it('parses FN, TEL, and URL from a generic (non-BadgeTag) vCard', () => {
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Grace Hopper',
      'N:Hopper;Grace;;;',
      'TEL;TYPE=CELL:+1 555-0199',
      'URL:https://github.com/ghopper',
      'END:VCARD',
      '',
    ].join('\r\n')

    const parsed = parseVCard(vcard)
    expect(parsed.displayName).toBe('Grace Hopper')
    expect(parsed.phone).toBe('+1 555-0199')
    expect(parsed.links).toEqual([{ platform: 'github', url: 'https://github.com/ghopper' }])
  })

  it('falls back to N when FN is absent', () => {
    const vcard = ['BEGIN:VCARD', 'VERSION:3.0', 'N:Hopper;Grace;;;', 'END:VCARD', ''].join(
      '\r\n',
    )
    const parsed = parseVCard(vcard)
    expect(parsed.displayName).toBe('Grace Hopper')
  })

  it('detects known platforms from link domains', () => {
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Test User',
      'URL:https://linkedin.com/in/test',
      'URL:https://twitter.com/test',
      'URL:https://bsky.app/profile/test',
      'URL:https://cal.com/test',
      'URL:https://example.com/blog',
      'END:VCARD',
      '',
    ].join('\r\n')

    const parsed = parseVCard(vcard)
    expect(parsed.links).toEqual([
      { platform: 'linkedin', url: 'https://linkedin.com/in/test' },
      { platform: 'twitter', url: 'https://twitter.com/test' },
      { platform: 'bluesky', url: 'https://bsky.app/profile/test' },
      { platform: 'calendar', url: 'https://cal.com/test' },
      { platform: 'website', url: 'https://example.com/blog' },
    ])
  })

  it('extracts locality/region from ADR as location', () => {
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Test User',
      'ADR:;;123 Main St;London;;SW1A 1AA;UK',
      'END:VCARD',
      '',
    ].join('\r\n')

    const parsed = parseVCard(vcard)
    expect(parsed.location).toBe('London')
  })

  it('round-trips a BadgeTag-exported vCard, recovering tagline/pronouns/location from TITLE and NOTE', () => {
    const profile: Profile = {
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      tagline: 'Countess of Computing',
      phone: '+1 555-0100',
      pronouns: 'she/her',
      location: 'London, UK',
      theme: 'light',
      displayEmail: true,
      links: [{ platform: 'github', url: 'https://github.com/ada' }],
    }
    const exported = buildVCard(profile)

    const parsed = parseVCard(exported)
    expect(parsed.displayName).toBe('Ada Lovelace')
    expect(parsed.phone).toBe('+1 555-0100')
    expect(parsed.tagline).toBe('Countess of Computing')
    expect(parsed.pronouns).toBe('she/her')
    expect(parsed.location).toBe('London, UK')
    expect(parsed.links).toEqual([{ platform: 'github', url: 'https://github.com/ada' }])
  })

  it('returns an empty result for a vCard with no recognized properties', () => {
    const vcard = ['BEGIN:VCARD', 'VERSION:3.0', 'END:VCARD', ''].join('\r\n')
    const parsed = parseVCard(vcard)
    expect(parsed).toEqual({
      displayName: undefined,
      phone: undefined,
      tagline: undefined,
      location: undefined,
      pronouns: undefined,
      links: [],
    })
  })

  it('unfolds continuation lines before parsing', () => {
    const longUrl = `https://example.com/${'a'.repeat(100)}`
    const folded = buildVCard({
      email: 'test@example.com',
      theme: 'light',
      displayEmail: false,
      links: [{ platform: 'website', url: longUrl }],
    })

    const parsed = parseVCard(folded)
    expect(parsed.links).toEqual([{ platform: 'website', url: longUrl }])
  })
})
