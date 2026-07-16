import type { Profile } from '../types/profile'

/** Maximum characters per vCard content line before folding (per RFC 6350). */
const FOLD_WIDTH = 75

/**
 * Escapes a vCard property value per RFC 6350: backslashes, commas,
 * semicolons, and newlines must be backslash-escaped.
 */
function escapeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/** Folds a content line to FOLD_WIDTH characters, continuation lines lead with a space. */
function foldLine(line: string): string {
  if (line.length <= FOLD_WIDTH) return line

  const chunks = [line.slice(0, FOLD_WIDTH)]
  let rest = line.slice(FOLD_WIDTH)
  while (rest.length > 0) {
    chunks.push(rest.slice(0, FOLD_WIDTH - 1))
    rest = rest.slice(FOLD_WIDTH - 1)
  }
  return chunks.join('\r\n ')
}

/**
 * Splits a display name into vCard N (family;given) components using the
 * common last-word-is-family heuristic, since profiles only store a single
 * free-text name field rather than separate first/last inputs.
 */
function splitName(displayName: string): { family: string; given: string } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) {
    return { family: parts[0] ?? '', given: '' }
  }
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') }
}

export interface VCardPhoto {
  /** Base64-encoded image data, without the data: URL prefix. */
  base64: string
  /** vCard PHOTO TYPE parameter, e.g. "JPEG" or "PNG". */
  type: string
}

/**
 * Builds an RFC 6350 vCard 3.0 document from a public profile, so a viewer
 * can save the card owner directly to their phone's contacts.
 */
export function buildVCard(profile: Profile, photo?: VCardPhoto): string {
  const name = profile.displayName?.trim() || 'BadgeTag Contact'
  const { family, given } = splitName(name)

  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0']

  lines.push(`FN:${escapeValue(name)}`)
  lines.push(`N:${escapeValue(family)};${escapeValue(given)};;;`)

  if (profile.tagline) {
    lines.push(`TITLE:${escapeValue(profile.tagline)}`)
  }

  const noteLines: string[] = []
  if (profile.pronouns) noteLines.push(`Pronouns: ${profile.pronouns}`)
  if (profile.location) noteLines.push(`Location: ${profile.location}`)
  if (noteLines.length > 0) {
    lines.push(`NOTE:${escapeValue(noteLines.join('\n'))}`)
  }
  if (profile.displayEmail && profile.email) {
    lines.push(`EMAIL;TYPE=INTERNET:${escapeValue(profile.email)}`)
  }
  if (profile.phone) {
    lines.push(`TEL;TYPE=CELL:${escapeValue(profile.phone)}`)
  }
  for (const link of profile.links) {
    lines.push(`URL:${escapeValue(link.url)}`)
  }
  if (photo) {
    lines.push(`PHOTO;ENCODING=b;TYPE=${photo.type}:${photo.base64}`)
  }

  lines.push('END:VCARD')

  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/**
 * Fetches a same-origin profile image and base64-encodes it for embedding
 * as a vCard PHOTO property. Returns null on any failure so the caller can
 * fall back to a photo-less vCard rather than blocking the download.
 */
export async function fetchImageAsVCardPhoto(imageUrl: string): Promise<VCardPhoto | null> {
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) return null

    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    const type = contentType.split('/')[1]?.toUpperCase() ?? 'JPEG'

    const blob = await res.blob()
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(',')[1] ?? '')
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })

    return { base64, type }
  } catch {
    return null
  }
}

/** Triggers a browser download of the given vCard text as a .vcf file. */
export function downloadVCardFile(vcard: string, filename: string): void {
  const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
