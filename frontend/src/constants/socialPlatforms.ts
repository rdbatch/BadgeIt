import type { SocialPlatform } from '../types/profile'
import {
  LinkedInIcon,
  GitHubIcon,
  TwitterIcon,
  InstagramIcon,
  YouTubeIcon,
  MastodonIcon,
  BlueskyIcon,
  PersonIcon,
  CalendarIcon,
  GlobeIcon,
  type IconProps,
} from '../components/SocialIcons'

const platformIcons: Record<SocialPlatform, React.ComponentType<IconProps>> = {
  linkedin: LinkedInIcon,
  github: GitHubIcon,
  twitter: TwitterIcon,
  instagram: InstagramIcon,
  youtube: YouTubeIcon,
  mastodon: MastodonIcon,
  bluesky: BlueskyIcon,
  website: PersonIcon,
  calendar: CalendarIcon,
  custom: GlobeIcon,
}

const platformLabels: Record<SocialPlatform, string> = {
  linkedin: 'LinkedIn',
  github: 'GitHub',
  twitter: 'X (Twitter)',
  instagram: 'Instagram',
  youtube: 'YouTube',
  mastodon: 'Mastodon',
  bluesky: 'Bluesky',
  website: 'Personal Website',
  calendar: 'Calendar',
  custom: 'Link',
}

export function getPlatformIcon(platform: SocialPlatform): React.ComponentType<IconProps> {
  return platformIcons[platform]
}

export function getPlatformLabel(platform: SocialPlatform): string {
  return platformLabels[platform]
}
