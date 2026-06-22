import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import AppTopBar from '@/components/ui/AppTopBar';
import { getAllPosts } from '@/lib/blog/posts';
import '@/styles/blog.css';

export const metadata: Metadata = {
  title: 'Blog — OurTrips',
  description:
    'Guides, tips, and tutorials on AI-powered trip planning with remote MCP connectors. Learn how to create beautiful, shareable travel itineraries.',
  alternates: {
    canonical: 'https://ourtrips.to/blog',
  },
  openGraph: {
    title: 'Blog — OurTrips',
    description:
      'Guides, tips, and tutorials on AI-powered trip planning with remote MCP connectors.',
    url: 'https://ourtrips.to/blog',
    siteName: 'OurTrips',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Blog — OurTrips',
    description:
      'Guides, tips, and tutorials on AI-powered trip planning with remote MCP connectors.',
  },
};

export default function BlogIndex() {
  const posts = getAllPosts();

  return (
    <div className="blog">
      <AppTopBar
        suffix="Journal"
        actions={
          <div className="blog-nav-links">
            <Link href="/changelog" className="blog-nav-link">Changelog</Link>
            <Link href="/itineraries" className="blog-nav-link">Itineraries</Link>
            <Link href="/login" className="blog-btn-outline">Log in</Link>
          </div>
        }
      />

      <main className="blog-main">
        <div className="blog-content">
          <div className="blog-header">
            <div className="blog-header-badge">Blog</div>
            <h1 className="blog-header-title">AI Trip Planning Guides</h1>
            <p className="blog-header-desc">
              Learn how to use remote connectors, AI agents, and OurTrips to plan and share
              beautiful travel itineraries.
            </p>
          </div>

          <div className="blog-posts">
            {posts.map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="blog-post-card">
                <div className="blog-post-meta">
                  <span className="blog-post-date">
                    {new Date(post.date).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                  <span className="blog-post-tag">{post.tag}</span>
                </div>
                <h2 className="blog-post-title">{post.title}</h2>
                <p className="blog-post-excerpt">{post.excerpt}</p>
                <span className="blog-post-read">
                  Read article
                  <ArrowRight size={14} aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </main>

      <footer className="blog-footer">
        <div className="blog-footer-inner">
          <span className="blog-footer-logo">OurTrips</span>
          <span className="blog-footer-copy">Built by Thijs van Schadewijk</span>
        </div>
      </footer>
    </div>
  );
}
