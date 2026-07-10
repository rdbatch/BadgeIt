/** Supported social platforms with dedicated icons */
export type SocialPlatform =
  | 'linkedin'
  | 'github'
  | 'twitter'
  | 'instagram'
  | 'youtube'
  | 'mastodon'
  | 'bluesky'
  | 'website'
  | 'custom'

/** A single social link entry */
export interface SocialLink {
  platform: SocialPlatform
  url: string
  /** User-provided label for custom links */
  label?: string
}

/** Available preset theme identifiers */
export type ThemeId =
  | 'light'
  | 'dark'
  | 'ocean'
  | 'sunset'
  | 'forest'
  | 'lavender'
  | 'slate'
  | 'rose'
  | 'mint'
  | 'amber'

/** Theme color configuration */
export interface ThemeConfig {
  id: ThemeId
  name: string
  /** Background color (Tailwind class or hex) */
  bg: string
  /** Primary text color */
  text: string
  /** Secondary/muted text color */
  textMuted: string
  /** Accent color for links and interactive elements */
  accent: string
}

/** Complete user profile */
export interface Profile {
  email: string
  displayName?: string
  tagline?: string
  phone?: string
  imageUrl?: string
  theme: ThemeId
  /** Whether the email address is shown on the public card. Defaults to true. */
  displayEmail: boolean
  links: SocialLink[]
}
