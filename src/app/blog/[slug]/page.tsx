import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LogoSuffix from '@/components/ui/LogoSuffix';
import CopyCodeBlocks from '@/components/blog/CopyCodeBlocks';
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
    alternates: {
      canonical: `https://ourtrips.to/blog/${post.slug}`,
    },
    openGraph: {
      title: post.title,
      description: post.excerpt,
      url: `https://ourtrips.to/blog/${post.slug}`,
      siteName: 'Our Trips',
      locale: 'en_US',
      type: 'article',
      publishedTime: post.date,
      modifiedTime: post.lastUpdated,
      authors: ['Thijs van Schadewijk'],
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

  const jsonLd: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.excerpt,
      datePublished: post.date,
      dateModified: post.lastUpdated,
      author: {
        '@type': 'Person',
        name: 'Thijs van Schadewijk',
        url: 'https://ourtrips.to',
      },
      publisher: {
        '@type': 'Organization',
        name: 'Our Trips',
        url: 'https://ourtrips.to',
        logo: {
          '@type': 'ImageObject',
          url: 'https://ourtrips.to/icons/icon-192.png',
        },
      },
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': `https://ourtrips.to/blog/${post.slug}`,
      },
      image: `https://ourtrips.to/blog/${post.slug}/opengraph-image`,
      articleSection: post.tag,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: 'https://ourtrips.to',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Blog',
          item: 'https://ourtrips.to/blog',
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: post.title,
          item: `https://ourtrips.to/blog/${post.slug}`,
        },
      ],
    },
  ];

  if (post.faq.length > 0) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: post.faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    });
  }

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
            {post.lastUpdated !== post.date && (
              <span className="blog-article-updated">
                Updated {new Date(post.lastUpdated).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            )}
            <span className="blog-article-tag">{post.tag}</span>
          </div>

          <h1 className="blog-article-title">{post.title}</h1>
          <p className="blog-article-subtitle">{post.subtitle}</p>

          <div className="blog-article-author">
            <span className="blog-article-author-name">By Thijs van Schadewijk</span>
            <span className="blog-article-author-sep">&middot;</span>
            <span className="blog-article-author-time">{post.readingTime}</span>
          </div>

          <div
            className="blog-article-body"
            dangerouslySetInnerHTML={{ __html: post.body }}
          />
          <CopyCodeBlocks />

          {post.faq.length > 0 && (
            <div className="blog-faq">
              <h2 className="blog-faq-title">Frequently Asked Questions</h2>
              <div className="blog-faq-list">
                {post.faq.map((item, i) => (
                  <div key={i} className="blog-faq-item">
                    <h3 className="blog-faq-question">{item.question}</h3>
                    <p className="blog-faq-answer">{item.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

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
