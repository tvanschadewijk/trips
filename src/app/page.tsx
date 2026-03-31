import Link from 'next/link';
import '@/styles/landing.css';

export default function Home() {
  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <span className="landing-logo">trips</span>
          <div className="landing-nav-links">
            <Link href="/demo" className="landing-nav-link">Demo</Link>
            <Link href="/dashboard" className="landing-btn-outline">Log in</Link>
          </div>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-hero-badge">Built for travelers who plan with AI</div>
          <h1 className="landing-hero-title">
            Your trips,<br />beautifully presented.
          </h1>
          <p className="landing-hero-subtitle">
            Push trip data from Claude or any AI assistant and get back a shareable,
            interactive itinerary — complete with maps, bookings, and day-by-day details.
          </p>
          <div className="landing-hero-actions">
            <Link href="/dashboard" className="landing-btn-primary">Get started</Link>
            <Link href="/demo" className="landing-btn-secondary">See a demo</Link>
          </div>
        </div>
      </section>

      <section className="landing-features">
        <div className="landing-features-inner">
          <div className="landing-feature">
            <div className="landing-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            </div>
            <h3 className="landing-feature-title">Push from AI</h3>
            <p className="landing-feature-desc">
              Your Claude skill or API call sends trip JSON. We store it and give you a URL.
            </p>
          </div>
          <div className="landing-feature">
            <div className="landing-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            </div>
            <h3 className="landing-feature-title">Share a link</h3>
            <p className="landing-feature-desc">
              Every trip gets a short, permanent URL. Share it with travel companions — no login required to view.
            </p>
          </div>
          <div className="landing-feature">
            <div className="landing-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            </div>
            <h3 className="landing-feature-title">Always up to date</h3>
            <p className="landing-feature-desc">
              Update trip data anytime. The URL stays the same — the preview reflects the latest version instantly.
            </p>
          </div>
        </div>
      </section>

      <section className="landing-preview">
        <div className="landing-preview-inner">
          <div className="landing-preview-label">How it looks</div>
          <div className="landing-phone-frame">
            <div className="landing-phone-screen">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.unsplash.com/photo-1732045133230-1a670eef8620?w=430&h=800&fit=crop&q=80"
                alt="Scotland trip preview"
                className="landing-phone-img"
              />
              <div className="landing-phone-overlay" />
              <div className="landing-phone-content">
                <div className="landing-phone-pill">Thijs & Alexli</div>
                <div className="landing-phone-title">Scotland</div>
                <div className="landing-phone-sub">West Highland Way & Oban Coast</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-cta">
        <div className="landing-cta-inner">
          <h2 className="landing-cta-title">Start sharing your trips</h2>
          <p className="landing-cta-desc">Free to use. Set up in under a minute.</p>
          <Link href="/dashboard" className="landing-btn-primary">Create your account</Link>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span className="landing-footer-logo">trips</span>
          <span className="landing-footer-copy">Built by Thijs van Schadewijk</span>
        </div>
      </footer>
    </div>
  );
}
