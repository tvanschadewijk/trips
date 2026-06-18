import { BLOG_POSTS } from '@/lib/generated/static-content';

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

const posts = BLOG_POSTS satisfies BlogPost[];

export function getPost(slug: string): BlogPost | undefined {
  return posts.find((post) => post.slug === slug);
}

export function getAllPosts(): BlogPost[] {
  return [...posts];
}
