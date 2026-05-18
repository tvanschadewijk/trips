import Link from 'next/link';
import type { Metadata } from 'next';
import LogoSuffix from '@/components/ui/LogoSuffix';
import { getChangelog } from '@/lib/changelog';
import '@/styles/blog.css';

export const metadata: Metadata = {
  title: 'Changelog — OurTrips',
  description: 'Product releases, fixes, and rollout notes for OurTrips.',
  alternates: {
    canonical: 'https://ourtrips.to/changelog',
  },
  openGraph: {
    title: 'Changelog — OurTrips',
    description: 'Product releases, fixes, and rollout notes for OurTrips.',
    url: 'https://ourtrips.to/changelog',
    siteName: 'OurTrips',
    locale: 'en_US',
    type: 'website',
  },
};

export default function ChangelogPage() {
  const changelog = getChangelog();

  return (
    <div className="blog">
      <nav className="blog-nav">
        <div className="blog-nav-inner">
          <Link href="/" className="blog-logo">OurTrips<LogoSuffix /></Link>
          <div className="blog-nav-links">
            <Link href="/itineraries" className="blog-nav-link">Itineraries</Link>
            <Link href="/changelog" className="blog-nav-link">Changelog</Link>
            <Link href="/blog" className="blog-nav-link">Journal</Link>
            <Link href="/login" className="blog-btn-outline">Log in</Link>
          </div>
        </div>
      </nav>

      <main className="blog-main">
        <div className="blog-content">
          <div className="blog-header">
            <div className="blog-header-badge">Changelog</div>
            <h1 className="blog-header-title">Shipping notes, without the guesswork.</h1>
            <p className="blog-header-desc">
              Release history for OurTrips, grounded in the repo and updated with each meaningful change.
            </p>
          </div>

          <div className="blog-article-meta">
            <span className="blog-article-date">Latest release: {changelog.latestVersion}</span>
            <span className="blog-article-updated">
              Updated {new Date(changelog.lastUpdated).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>

          <div
            className="blog-article-body blog-changelog-body"
            dangerouslySetInnerHTML={{ __html: changelog.body }}
          />
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
