import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LogoSuffix from '@/components/ui/LogoSuffix';
import { getPost, getAllPosts } from '@/lib/blog/posts';
import '@/styles/blog.css';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return {
    title: `${post.title} — Our Trips Blog`,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      url: `https://ourtrips.to/blog/${post.slug}`,
      siteName: 'Our Trips',
      locale: 'en_US',
      type: 'article',
      publishedTime: post.date,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: {
      '@type': 'Person',
      name: 'Thijs van Schadewijk',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Our Trips',
      url: 'https://ourtrips.to',
    },
    mainEntityOfPage: `https://ourtrips.to/blog/${post.slug}`,
  };

  return (
    <div className="blog">
      <nav className="blog-nav">
        <div className="blog-nav-inner">
          <Link href="/" className="blog-logo">Our Trips<LogoSuffix /></Link>
          <div className="blog-nav-links">
            <Link href="/blog" className="blog-nav-link">Blog</Link>
            <Link href="/login" className="blog-btn-outline">Log in</Link>
          </div>
        </div>
      </nav>

      <main className="blog-main">
        <div className="blog-content">
          <Link href="/blog" className="blog-back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            All posts
          </Link>

          <div className="blog-article-meta">
            <span className="blog-article-date">
              {new Date(post.date).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
            <span className="blog-article-tag">{post.tag}</span>
          </div>

          <h1 className="blog-article-title">{post.title}</h1>
          <p className="blog-article-subtitle">{post.subtitle}</p>

          <div
            className="blog-article-body"
            dangerouslySetInnerHTML={{ __html: post.body }}
          />

          <div className="blog-article-cta">
            <div className="blog-article-cta-title">Ready to try it?</div>
            <p className="blog-article-cta-desc">
              Install the Our Trips skill and turn your next Claude conversation into a shareable itinerary.
            </p>
            <Link href="/guide" className="blog-article-cta-btn">
              Get started
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </Link>
          </div>
        </div>
      </main>

      <footer className="blog-footer">
        <div className="blog-footer-inner">
          <span className="blog-footer-logo">Our Trips</span>
          <span className="blog-footer-copy">Built by Thijs van Schadewijk</span>
        </div>
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
