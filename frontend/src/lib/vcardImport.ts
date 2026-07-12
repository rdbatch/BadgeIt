import type { SocialLink, SocialPlatform } from '../types/profile'

export interface ParsedVCardProfile {
  displayName?: string
  phone?: string
  tagline?: string
  location?: string
  pronouns?: string
  links: SocialLink[]
}

/** Reverses vCard value escaping: \n, \,, \;, and \\ back to their literal characters. */
function unescapeValue(value: string): string {
  let result = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1]
      if (next === 'n' || next === 'N') {
        result += '\n'
        i++
        continue
      }
      if (next === ',' || next === ';' || next === '\\') {
        result += next
        i++
        continue
      }
    }
    result += value[i]
  }
  return result
}

/** Joins folded continuation lines (leading space/tab) back into one line per property. */
function unfoldLines(text: string): string[] {
  const rawLines = text.split(/\r\n|\n|\r/)
  const lines: string[] = []
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else if (line.trim() !== '') {
      lines.push(line)
    }
  }
  return lines
}

/** Extracts the bare property name (group and parameters stripped) and raw value. */
function parseLine(line: string): { name: string; value: string } | null {
  const colonIdx = line.indexOf(':')
  if (colonIdx === -1) return null

  const rawName = line.slice(0, colonIdx)
  const value = line.slice(colonIdx + 1)
  const nameWithoutGroup = rawName.includes('.') ? rawName.slice(rawName.lastIndexOf('.') + 1) : rawName
  const name = nameWithoutGroup.split(';')[0].toUpperCase()

  return { name, value }
}

/** Guesses a SocialPlatform from a URL's domain; falls back to "website". */
function detectPlatform(url: string): SocialPlatform {
  const lower = url.toLowerCase()
  if (lower.includes('linkedin.com')) return 'linkedin'
  if (lower.includes('github.com')) return 'github'
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter'
  if (lower.includes('instagram.com')) return 'instagram'
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube'
  if (lower.includes('mastodon')) return 'mastodon'
  if (lower.includes('bsky.app')) return 'bluesky'
  if (lower.includes('cal.com') || lower.includes('calendly.com')) return 'calendar'
  return 'website'
}

/**
 * Parses an RFC 6350 vCard 3.0 into the subset of fields the edit form can
 * prefill. Recognizes our convention where tagline is in TITLE and
 * pronouns/location are in NOTE as "Pronouns: x" / "Location: y" lines.
 * Degrades gracefully for vCards from other apps that only set FN/N/TEL/URL/ADR.
 */
export function parseVCard(text: string): ParsedVCardProfile {
  const lines = unfoldLines(text)

  let displayName: string | undefined
  let family: string | undefined
  let given: string | undefined
  let phone: string | undefined
  let tagline: string | undefined
  let pronouns: string | undefined
  let noteRaw: string | undefined
  let location: string | undefined
  const links: SocialLink[] = []

  for (const rawLine of lines) {
    const parsed = parseLine(rawLine)
    if (!parsed) continue
    const { name, value } = parsed
    const unescaped = unescapeValue(value)
    if (!unescaped) continue

    switch (name) {
      case 'FN':
        displayName = unescaped
        break
      case 'N': {
        const parts = unescaped.split(';')
        family = parts[0]?.trim() || undefined
        given = parts[1]?.trim() || undefined
        break
      }
      case 'TEL':
        if (!phone) phone = unescaped
        break
      case 'TITLE':
        tagline = unescaped
        break
      case 'NOTE':
        noteRaw = unescaped
        break
      case 'URL':
        links.push({ platform: detectPlatform(unescaped), url: unescaped })
        break
      case 'ADR': {
        // ADR:pobox;ext;street;locality;region;postalcode;country
        const parts = unescaped.split(';')
        const composed = [parts[3]?.trim(), parts[4]?.trim()].filter(Boolean).join(', ')
        if (composed) location = composed
        break
      }
      default:
        break
    }
  }

  if (!displayName && (family || given)) {
    displayName = [given, family].filter(Boolean).join(' ').trim() || undefined
  }

  if (noteRaw) {
    for (const noteLine of noteRaw.split('\n')) {
      const pronounsMatch = /^Pronouns:\s*(.+)$/i.exec(noteLine)
      const locationMatch = /^Location:\s*(.+)$/i.exec(noteLine)
      if (pronounsMatch) {
        pronouns = pronounsMatch[1].trim()
      } else if (locationMatch) {
        location ??= locationMatch[1].trim()
      }
    }
  }

  return { displayName, phone, tagline, location, pronouns, links }
}
