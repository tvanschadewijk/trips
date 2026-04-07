import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';

export interface BlogPost {
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  tag: string;
  date: string;
  readingTime: string;
  body: string; // rendered HTML
}

const contentDir = path.join(process.cwd(), 'src/content/blog');

function parsePost(filename: string): BlogPost {
  const slug = filename.replace(/\.md$/, '');
  const raw = fs.readFileSync(path.join(contentDir, filename), 'utf-8');
  const { data, content } = matter(raw);
  const body = marked.parse(content, { async: false }) as string;

  return {
    slug,
    title: data.title,
    subtitle: data.subtitle ?? '',
    excerpt: data.excerpt ?? '',
    tag: data.tag ?? '',
    date: typeof data.date === 'string' ? data.date : new Date(data.date).toISOString().slice(0, 10),
    readingTime: data.readingTime ?? '',
    body,
  };
}

export function getPost(slug: string): BlogPost | undefined {
  const filename = `${slug}.md`;
  const filepath = path.join(contentDir, filename);
  if (!fs.existsSync(filepath)) return undefined;
  return parsePost(filename);
}

export function getAllPosts(): BlogPost[] {
  const files = fs.readdirSync(contentDir).filter((f) => f.endsWith('.md'));
  return files.map(parsePost).sort((a, b) => b.date.localeCompare(a.date));
}
