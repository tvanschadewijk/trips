import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import AppTopBar from '@/components/ui/AppTopBar';
import { getAllPosts } from '@/lib/blog/posts';
import '@/styles/blog.css';

export const metadata: Metadata = {
  title: 'Journal - OurTrips',
  description:
    'Field notes on collecting messy travel information, planning better trips, and carrying a day-by-day guide with you on the road.',
  alternates: {
    canonical: 'https://ourtrips.to/blog',
  },
  openGraph: {
    title: 'Journal - OurTrips',
    description:
      'Field notes on collecting messy travel information, planning better trips, and carrying a day-by-day guide.',
    url: 'https://ourtrips.to/blog',
    siteName: 'OurTrips',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Journal - OurTrips',
    description:
      'Field notes on collecting messy travel information, planning better trips, and carrying a day-by-day guide.',
  },
};

export default function BlogIndex() {
  const posts = getAllPosts();
  const focusAreas = [
    {
      label: 'Collect',
      title: 'Make sense of the pile',
      text: 'Bookings, notes, links, traveler preferences, PDFs, and half-decisions all need one place to land.',
    },
    {
      label: 'Plan',
      title: 'Enjoy the anticipation',
      text: 'A good trip plan should feel like the journey has started, with room to refine, debate, and imagine.',
    },
    {
      label: 'Carry',
      title: 'Use the day you are in',
      text: 'When you are traveling, the guide should open to what matters today instead of making you hunt.',
    },
  ];

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
            <div className="blog-header-badge">Journal</div>
            <h1 className="blog-header-title">Travel planning is messy. That is the point.</h1>
            <p className="blog-header-desc">
              Notes on collecting scattered trip information, shaping it into something worth
              looking forward to, and carrying the right day with you when you leave.
            </p>
          </div>

          <div className="blog-focus-grid" aria-label="OurTrips journal themes">
            {focusAreas.map((area) => (
              <article className="blog-focus-card" key={area.label}>
                <span>{area.label}</span>
                <h2>{area.title}</h2>
                <p>{area.text}</p>
              </article>
            ))}
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
