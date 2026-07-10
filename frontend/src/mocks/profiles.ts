import type { Profile } from '../types/profile'

/** Full mock profile with all fields populated */
export const mockProfileFull: Profile = {
  email: 'ryan@example.com',
  displayName: 'Ryan Batchelder',
  tagline: 'Staff Engineer @ Acme Corp',
  phone: '+1 (555) 123-4567',
  imageUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ryan',
  theme: 'light',
  displayEmail: true,
  links: [
    { platform: 'linkedin', url: 'https://linkedin.com/in/ryanbatch' },
    { platform: 'github', url: 'https://github.com/ryanbatch' },
    { platform: 'twitter', url: 'https://x.com/ryanbatch' },
    { platform: 'website', url: 'https://ryanbatch.dev' },
    { platform: 'custom', url: 'https://blog.ryanbatch.dev', label: 'My Blog' },
  ],
}

/** Minimal mock profile with only required fields */
export const mockProfileMinimal: Profile = {
  email: 'minimal@example.com',
  theme: 'light',
  displayEmail: true,
  links: [],
}

/** Mock profile with dark theme */
export const mockProfileDark: Profile = {
  email: 'dark@example.com',
  displayName: 'Night Owl',
  tagline: 'Working in the dark so you can see the light',
  theme: 'dark',
  displayEmail: true,
  links: [
    { platform: 'github', url: 'https://github.com/nightowl' },
    { platform: 'mastodon', url: 'https://mastodon.social/@nightowl' },
  ],
}

/** Mock profile with ocean theme */
export const mockProfileOcean: Profile = {
  email: 'ocean@example.com',
  displayName: 'Marina Wave',
  tagline: 'DevOps engineer riding the cloud',
  phone: '+1 (555) 987-6543',
  theme: 'ocean',
  displayEmail: true,
  links: [
    { platform: 'linkedin', url: 'https://linkedin.com/in/marinawave' },
    { platform: 'bluesky', url: 'https://bsky.app/profile/marina.wave' },
    { platform: 'youtube', url: 'https://youtube.com/@marinawave' },
  ],
}
