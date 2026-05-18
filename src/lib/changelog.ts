import fs from 'fs';
import path from 'path';
import { marked } from 'marked';

export interface ChangelogData {
  body: string;
  latestLabel: string;
  lastUpdated: string;
}

const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');

function stripUnreleasedSection(raw: string): string {
  const match = raw.match(/^## Unreleased\n[\s\S]*?(?=^## |\Z)/m);
  if (!match) return raw;

  const withoutSection = raw.replace(match[0], '').replace(/\n{3,}/g, '\n\n').trim();
  return `${withoutSection}\n`;
}

export function getChangelog(): ChangelogData {
  const raw = fs.readFileSync(changelogPath, 'utf-8');
  const publishedOnly = stripUnreleasedSection(raw);
  const body = marked.parse(publishedOnly, { async: false }) as string;
  const match = publishedOnly.match(/^## ([^\n]+)/m);
  const dateMatch = match?.[1].match(/^(\d{4}-\d{2}-\d{2})/);

  return {
    body,
    latestLabel: match?.[1] ?? 'No published updates yet',
    lastUpdated: dateMatch?.[1] ?? new Date().toISOString().slice(0, 10),
  };
}
