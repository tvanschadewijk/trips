import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import AppTopBar from '@/components/ui/AppTopBar';
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
    title: `${post.title} - OurTrips Journal`,
    description: post.excerpt,
    alternates: {
      canonical: `https://ourtrips.to/blog/${post.slug}`,
    },
    openGraph: {
      title: post.title,
      description: post.excerpt,
      url: `https://ourtrips.to/blog/${post.slug}`,
      siteName: 'OurTrips',
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
        name: 'OurTrips',
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
          name: 'Journal',
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
      <AppTopBar
        suffix="Journal"
        actions={
          <div className="blog-nav-links">
            <Link href="/changelog" className="blog-nav-link">Changelog</Link>
            <Link href="/blog" className="blog-nav-link">Journal</Link>
            <Link href="/login" className="blog-btn-outline">Log in</Link>
          </div>
        }
      />

      <main className="blog-main">
        <div className="blog-content">
          <Link href="/blog" className="blog-back">
            <ArrowLeft size={16} strokeWidth={2.5} aria-hidden="true" />
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
              Start in OurTrips, bring the messy planning material with you, and turn it into a day-by-day guide.
            </p>
            <Link href="/login?next=/dashboard%3Fagent%3Dnew" className="blog-article-cta-btn">
              Start a trip
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </main>

      <footer className="blog-footer">
        <div className="blog-footer-inner">
          <span className="blog-footer-logo">OurTrips</span>
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
