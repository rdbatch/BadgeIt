/**
 * Taglines rotated under the "BadgeIt" header on the landing page. Index 0
 * is pulled out by name as the guaranteed first-shown tagline (FIRST_TAGLINE
 * below) — don't rely on array order elsewhere.
 */
export const TAGLINES: readonly string[] = [
  'Badge + Widget = BadgeIt',
  'The conference badge widget that connects people',
  'Your lightweight digital business card',
  'Business cards are so 2005',
  "The last business card you'll ever need",
  "Say goodbye to 'let me find a pen'",
  'Networking without the paper cuts',
  'Your digital handshake',
  'The badge (widget) that does the talking',
  "Making 'connect with me' effortless",
  'Built for booths, meetups, and everywhere between',
  "The QR code that helps you make friends",
  'Your elevator pitch, hands-free',
  "No more 'wait, what was your name again?'",
  "Stop filling your camera roll with other people's badges",
  "Remembers who you met so you don't have to",
  'The business card for people who lose business cards',
  'Less fumbling with apps, more connecting with people',
  "Your conference badge's better half",
  "'What if I could 3D print my profile QR code' as a Service"
]

/**
 * Always the first tagline shown on page load. Remains eligible to reappear
 * later in the randomized rotation.
 */
export const FIRST_TAGLINE = TAGLINES[0]
