import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';

export interface FaqItem {
  question: string;
  answer: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  tag: string;
  date: string;
  lastUpdated: string;
  readingTime: string;
  body: string; // rendered HTML
  faq: FaqItem[];
}

const contentDir = path.join(process.cwd(), 'src/content/blog');

/**
 * Parse FAQ from a separate faq.md file.
 * Each FAQ item is an h2 heading (question) followed by paragraph text (answer).
 */
function parseFaqFile(faqPath: string): FaqItem[] {
  if (!fs.existsSync(faqPath)) return [];
  const raw = fs.readFileSync(faqPath, 'utf-8').trim();
  if (!raw) return [];

  const items: FaqItem[] = [];
  const sections = raw.split(/^## /m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split('\n');
    const question = lines[0].trim();
    const answer = lines
      .slice(1)
      .join('\n')
      .trim();
    if (question && answer) {
      items.push({ question, answer });
    }
  }

  return items;
}

function parsePost(slug: string): BlogPost {
  const dirPath = path.join(contentDir, slug);
  const indexPath = path.join(dirPath, 'index.md');
  const faqPath = path.join(dirPath, 'faq.md');

  const raw = fs.readFileSync(indexPath, 'utf-8');
  const { data, content } = matter(raw);
  const body = marked.parse(content, { async: false }) as string;

  const date =
    typeof data.date === 'string'
      ? data.date
      : new Date(data.date).toISOString().slice(0, 10);
  const lastUpdated = data.lastUpdated
    ? typeof data.lastUpdated === 'string'
      ? data.lastUpdated
      : new Date(data.lastUpdated).toISOString().slice(0, 10)
    : date;

  const faq = parseFaqFile(faqPath);

  return {
    slug,
    title: data.title,
    subtitle: data.subtitle ?? '',
    excerpt: data.excerpt ?? '',
    tag: data.tag ?? '',
    date,
    lastUpdated,
    readingTime: data.readingTime ?? '',
    body,
    faq,
  };
}

export function getPost(slug: string): BlogPost | undefined {
  const dirPath = path.join(contentDir, slug);
  const indexPath = path.join(dirPath, 'index.md');
  if (!fs.existsSync(indexPath)) return undefined;
  return parsePost(slug);
}

export function getAllPosts(): BlogPost[] {
  const entries = fs.readdirSync(contentDir, { withFileTypes: true });
  const slugs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(contentDir, name, 'index.md')));
  return slugs.map(parsePost).sort((a, b) => b.date.localeCompare(a.date));
}
