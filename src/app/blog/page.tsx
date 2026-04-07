import Link from 'next/link';
import type { Metadata } from 'next';
import LogoSuffix from '@/components/ui/LogoSuffix';
import { getAllPosts } from '@/lib/blog/posts';
import '@/styles/blog.css';

export const metadata: Metadata = {
  title: 'Blog — Our Trips',
  description:
    'Guides, tips, and tutorials on AI-powered trip planning with Claude skills. Learn how to create beautiful, shareable travel itineraries.',
  openGraph: {
    title: 'Blog — Our Trips',
    description:
      'Guides, tips, and tutorials on AI-powered trip planning with Claude skills.',
    url: 'https://ourtrips.to/blog',
    siteName: 'Our Trips',
    locale: 'en_US',
    type: 'website',
  },
};

export default function BlogIndex() {
  const posts = getAllPosts();

  return (
    <div className="blog">
      <nav className="blog-nav">
        <div className="blog-nav-inner">
          <Link href="/" className="blog-logo">Our Trips<LogoSuffix /></Link>
          <div className="blog-nav-links">
            <Link href="/demo" className="blog-nav-link">Demo</Link>
            <Link href="/login" className="blog-btn-outline">Log in</Link>
          </div>
        </div>
      </nav>

      <main className="blog-main">
        <div className="blog-content">
          <div className="blog-header">
            <div className="blog-header-badge">Blog</div>
            <h1 className="blog-header-title">AI Trip Planning Guides</h1>
            <p className="blog-header-desc">
              Learn how to use Claude skills, AI agents, and Our Trips to plan and share
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
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </main>

      <footer className="blog-footer">
        <div className="blog-footer-inner">
          <span className="blog-footer-logo">Our Trips</span>
          <span className="blog-footer-copy">Built by Thijs van Schadewijk</span>
        </div>
      </footer>
    </div>
  );
}
