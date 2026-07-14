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
  DiscordIcon,
  TwitchIcon,
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
  discord: DiscordIcon,
  twitch: TwitchIcon,
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
  discord: 'Discord',
  twitch: 'Twitch',
  custom: 'Link',
}

const platformPlaceholders: Record<SocialPlatform, string> = {
  linkedin: 'linkedin.com/in/you',
  github: 'github.com/you',
  twitter: 'x.com/you',
  instagram: 'instagram.com/you',
  youtube: 'youtube.com/@you',
  mastodon: 'mastodon.social/@you',
  bluesky: 'you.bsky.social',
  website: 'yoursite.com',
  calendar: 'cal.com/you',
  discord: 'yourusername or discord.gg/yourinvite',
  twitch: 'twitch.tv/you',
  custom: 'example.com',
}

export function getPlatformIcon(platform: SocialPlatform): React.ComponentType<IconProps> {
  return platformIcons[platform]
}

export function getPlatformLabel(platform: SocialPlatform): string {
  return platformLabels[platform]
}

export function getPlatformPlaceholder(platform: SocialPlatform): string {
  return platformPlaceholders[platform]
}
