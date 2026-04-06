import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import LogoSuffix from '@/components/ui/LogoSuffix';
import '@/styles/landing.css';

export default async function Home() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) redirect('/dashboard');
  } catch {
    // Supabase not configured — show landing page
  }
  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <span className="landing-logo">Our Trips<LogoSuffix /></span>
          <div className="landing-nav-links">
            <Link href="/demo" className="landing-nav-link">Demo</Link>
            <Link href="/login" className="landing-btn-outline">Log in</Link>
          </div>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-hero-text">
            <div className="landing-hero-badge">Built for travelers who plan with AI</div>
            <h1 className="landing-hero-title">
              Get a beautifully designed itinerary in your pocket.
            </h1>
            <p className="landing-hero-subtitle">
              Plan your trip in ChatGPT or Claude, then turn it into a shareable,
              interactive itinerary with bookings, photos, and day-by-day plans.
            </p>
            <div className="landing-hero-actions">
              <Link href="/login" className="landing-btn-primary">Get started</Link>
              <Link href="/demo" className="landing-btn-secondary">See a demo</Link>
            </div>
          </div>
          <div className="landing-hero-phone">
            <div className="landing-phone-frame">
              <div className="landing-phone-screen">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=430&h=800&fit=crop&crop=center&q=80"
                  alt="New York trip preview"
                  className="landing-phone-img"
                />
                <div className="landing-phone-overlay" />
                <div className="landing-phone-content">
                  <div className="landing-phone-pill">Thijs</div>
                  <div className="landing-phone-title">New York</div>
                  <div className="landing-phone-sub">Three Days in the City That Never Sleeps</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-steps">
        <h2 className="landing-steps-heading">
          Trip planning is notes, emails, and apps everywhere.
          <span className="landing-steps-heading-accent">Not Anymore</span>
        </h2>
        <p className="landing-steps-subheading">Our Trips brings all your itinerary information together in a beautiful, pocket-friendly format.</p>
        <div className="landing-steps-inner">
          <div className="landing-step">
            <span className="landing-step-num">1</span>
            <h3 className="landing-step-title">Install this Claude skill</h3>
            <p className="landing-step-desc">Download the file and drop it into your Claude project.</p>
            <a href="/our-trips.skill" download className="landing-btn-primary landing-btn-sm" style={{ gap: '8px' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Download skill
            </a>
          </div>
          <div className="landing-step-divider" />
          <div className="landing-step">
            <span className="landing-step-num">2</span>
            <h3 className="landing-step-title">Talk about your itinerary</h3>
            <p className="landing-step-desc">Plan your trip with Claude in a co-work session like you normally would.</p>
          </div>
          <div className="landing-step-divider" />
          <div className="landing-step">
            <span className="landing-step-num">3</span>
            <h3 className="landing-step-title">Say &ldquo;Send it to Our Trips&rdquo;</h3>
            <p className="landing-step-desc">That&apos;s it. Your trip gets a shareable link — experience the magic.</p>
          </div>
        </div>
        <Link href="/guide" className="landing-tell-more">
          How does this work?
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </Link>
      </section>

      <section className="landing-cta">
        <div className="landing-cta-inner">
          <h2 className="landing-cta-title">Start sharing your trips</h2>
          <p className="landing-cta-desc">Free to use. Set up in under a minute.</p>
          <Link href="/login" className="landing-btn-primary">Create your account</Link>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span className="landing-footer-logo">Our Trips</span>
          <span className="landing-footer-copy">Built by Thijs van Schadewijk</span>
        </div>
      </footer>
    </div>
  );
}
