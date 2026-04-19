import { blogPromptRules } from './blog';
import { linkedinPromptRules } from './linkedin';
import { mediumPromptRules } from './medium';
import { newsletterPromptRules } from './newsletter';
import { twitterPromptRules } from './twitter';

export type PlatformPromptKey = 'linkedin' | 'twitter' | 'medium' | 'newsletter' | 'blog';

const PLATFORM_PROMPTS: Record<PlatformPromptKey, string> = {
  linkedin: linkedinPromptRules,
  twitter: twitterPromptRules,
  medium: mediumPromptRules,
  newsletter: newsletterPromptRules,
  blog: blogPromptRules,
};

export function getPromptRulesForPlatform(platform: PlatformPromptKey): string {
  return PLATFORM_PROMPTS[platform];
}

export function isPlatformPromptKey(value: string): value is PlatformPromptKey {
  return Object.prototype.hasOwnProperty.call(PLATFORM_PROMPTS, value);
}
