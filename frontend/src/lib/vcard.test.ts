import { buildVCard, downloadVCardFile, fetchImageAsVCardPhoto } from './vcard'
import type { Profile } from '../types/profile'

const baseProfile: Profile = {
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  tagline: 'Countess of Computing',
  phone: '+1 555-0100',
  theme: 'light',
  displayEmail: true,
  links: [
    { platform: 'linkedin', url: 'https://linkedin.com/in/ada' },
    { platform: 'github', url: 'https://github.com/ada' },
  ],
}

describe('buildVCard', () => {
  it('includes core vCard structure and version', () => {
    const vcard = buildVCard(baseProfile)
    expect(vcard).toContain('BEGIN:VCARD')
    expect(vcard).toContain('VERSION:3.0')
    expect(vcard).toContain('END:VCARD')
  })

  it('splits the display name into family/given for the N property', () => {
    const vcard = buildVCard(baseProfile)
    expect(vcard).toContain('FN:Ada Lovelace')
    expect(vcard).toContain('N:Lovelace;Ada;;;')
  })

  it('treats a single-word name as family only', () => {
    const vcard = buildVCard({ ...baseProfile, displayName: 'Cher' })
    expect(vcard).toContain('FN:Cher')
    expect(vcard).toContain('N:Cher;;;;')
  })

  it('falls back to a generic name when displayName is missing', () => {
    const vcard = buildVCard({ ...baseProfile, displayName: undefined })
    expect(vcard).toContain('FN:BadgeIt Contact')
  })

  it('includes email only when displayEmail is true', () => {
    const shown = buildVCard(baseProfile)
    expect(shown).toContain('EMAIL;TYPE=INTERNET:ada@example.com')

    const hidden = buildVCard({ ...baseProfile, displayEmail: false })
    expect(hidden).not.toContain('EMAIL')
  })

  it('includes phone, tagline, and all links', () => {
    const vcard = buildVCard(baseProfile)
    expect(vcard).toContain('TEL;TYPE=CELL:+1 555-0100')
    expect(vcard).toContain('TITLE:Countess of Computing')
    expect(vcard).toContain('URL:https://linkedin.com/in/ada')
    expect(vcard).toContain('URL:https://github.com/ada')
  })

  it('appends pronouns and location to the NOTE field when present', () => {
    const vcard = buildVCard({ ...baseProfile, pronouns: 'she/her', location: 'London, UK' })
    expect(vcard).toContain('TITLE:Countess of Computing')
    expect(vcard).toContain('NOTE:Pronouns: she/her\\nLocation: London\\, UK')
  })

  it('omits location and pronouns lines when absent', () => {
    const vcard = buildVCard({ ...baseProfile, pronouns: undefined, location: undefined })
    expect(vcard).not.toContain('Pronouns:')
    expect(vcard).not.toContain('Location:')
  })

  it('omits optional fields that are absent', () => {
    const minimal: Profile = {
      email: 'min@example.com',
      theme: 'light',
      displayEmail: false,
      links: [],
    }
    const vcard = buildVCard(minimal)
    expect(vcard).not.toContain('TEL')
    expect(vcard).not.toContain('NOTE')
    expect(vcard).not.toContain('URL:')
    expect(vcard).not.toContain('EMAIL')
  })

  it('escapes commas, semicolons, and backslashes in values', () => {
    const vcard = buildVCard({
      ...baseProfile,
      tagline: 'Loves math; physics, and C:\\Windows',
    })
    expect(vcard).toContain('TITLE:Loves math\\; physics\\, and C:\\\\Windows')
  })

  it('embeds a PHOTO property when photo data is provided', () => {
    const vcard = buildVCard(baseProfile, { base64: 'ZmFrZWRhdGE=', type: 'JPEG' })
    expect(vcard).toContain('PHOTO;ENCODING=b;TYPE=JPEG:ZmFrZWRhdGE=')
  })

  it('uses CRLF line endings terminated by a trailing CRLF', () => {
    const vcard = buildVCard(baseProfile)
    expect(vcard.endsWith('\r\n')).toBe(true)
    expect(vcard).toContain('\r\n')
  })

  it('folds lines longer than 75 characters with a leading space continuation', () => {
    const longUrl = `https://example.com/${'a'.repeat(100)}`
    const vcard = buildVCard({ ...baseProfile, links: [{ platform: 'website', url: longUrl }] })
    const lines = vcard.split('\r\n')
    const urlLineIndex = lines.findIndex((l) => l.startsWith('URL:'))
    expect(urlLineIndex).toBeGreaterThan(-1)
    expect(lines[urlLineIndex].length).toBeLessThanOrEqual(75)
    expect(lines[urlLineIndex + 1].startsWith(' ')).toBe(true)
  })
})

describe('fetchImageAsVCardPhoto', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when the fetch response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const result = await fetchImageAsVCardPhoto('https://example.com/photo.jpg')
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const result = await fetchImageAsVCardPhoto('https://example.com/photo.jpg')
    expect(result).toBeNull()
  })

  it('resolves base64 data and uppercased type from a successful fetch', async () => {
    const blob = new Blob(['fake-image-bytes'], { type: 'image/png' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/png' },
        blob: () => Promise.resolve(blob),
      }),
    )

    const result = await fetchImageAsVCardPhoto('https://example.com/photo.png')
    expect(result).not.toBeNull()
    expect(result?.type).toBe('PNG')
    expect(typeof result?.base64).toBe('string')
    expect(result?.base64.length).toBeGreaterThan(0)
  })
})

describe('downloadVCardFile', () => {
  it('creates an object URL, triggers an anchor download, and revokes the URL', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    const clickSpy = vi.fn()
    const anchor = document.createElement('a')
    vi.spyOn(anchor, 'click').mockImplementation(clickSpy)
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    downloadVCardFile('BEGIN:VCARD\r\nEND:VCARD\r\n', 'test.vcf')

    expect(createObjectURL).toHaveBeenCalled()
    expect(anchor.href).toBe('blob:mock-url')
    expect(anchor.download).toBe('test.vcf')
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')

    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
})
