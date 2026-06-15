import { CHANGELOG_DATA } from '@/lib/generated/static-content';

export interface ChangelogData {
  body: string;
  latestLabel: string;
  lastUpdated: string;
}

export function getChangelog(): ChangelogData {
  return CHANGELOG_DATA;
}
