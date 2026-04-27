import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import LogoSuffix from '@/components/ui/LogoSuffix';
import '@/styles/landing.css';

export default async function Home() {
  try {
    const hdrs = await headers();
    const referer = hdrs.get('referer');
    const host = hdrs.get('host');
    let fromInternal = false;
    if (referer && host) {
      try {
        const url = new URL(referer);
        fromInternal = url.host === host && url.pathname !== '/';
      } catch {}
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user && !fromInternal) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: trips } = await supabase
        .from('trips')
        .select('share_id, data')
        .eq('user_id', user.id);
      const active = trips?.find(t => {
        const start = t.data?.trip?.dates?.start;
        const end = t.data?.trip?.dates?.end;
        return start && end && start <= today && today <= end;
      });
      if (active) redirect(`/t/${active.share_id}`);
      redirect('/dashboard');
    }
  } catch (err) {
    // redirect() throws to signal navigation — re-throw so Next.js handles it
    if (err && typeof err === 'object' && 'digest' in err && typeof (err as { digest: unknown }).digest === 'string' && (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')) {
      throw err;
    }
    // Supabase not configured — show landing page
  }
  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <Link href="/" className="landing-logo">OurTrips<LogoSuffix /></Link>
          <div className="landing-nav-links">
            <Link href="/demo" className="landing-nav-link">Demo</Link>
            <Link href="/blog" className="landing-nav-link">Journal</Link>
            <Link href="/login" className="landing-btn-outline">Log in</Link>
          </div>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-hero-text">
            <div className="landing-hero-badge">An Itinerary, Rediscovered</div>
            <h1 className="landing-hero-title">
              Your next trip, <em>beautifully</em> written.
            </h1>
            <p className="landing-hero-subtitle">
              Built for agentic AI — Claude CoWork, Codex, and other agents that run skills.
              Talk your trip through, then say the word: OurTrips turns the conversation into
              a shareable, day-by-day itinerary — photographs, bookings, addresses, all in
              one place.
            </p>
            <div className="landing-hero-actions">
              <Link href="/login" className="landing-btn-primary">Start a trip</Link>
              <Link href="/demo" className="landing-btn-secondary">See an itinerary</Link>
            </div>
          </div>

          <figure className="landing-hero-figure">
            <div className="landing-hero-image-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.unsplash.com/photo-1528127269322-539801943592?w=1400&h=1750&fit=crop&crop=center&q=85"
                alt="A quiet Paris street at golden hour"
                className="landing-hero-image"
                loading="eager"
              />
            </div>
            <figcaption className="landing-hero-caption">
              <span className="place">Paris, VII<sup>e</sup></span>
              <span className="meta">from an OurTrips itinerary, 2026</span>
            </figcaption>
          </figure>
        </div>
      </section>

      <div className="landing-rule"><hr /></div>

      <section className="landing-steps">
        <div className="landing-steps-header">
          <div>
            <div className="landing-steps-eyebrow">How it works</div>
            <h2 className="landing-steps-heading">
              Plans live everywhere. <span className="landing-steps-heading-accent">OurTrips gathers them.</span>
            </h2>
          </div>
          <p className="landing-steps-subheading">
            Three steps between a sprawling chat thread and a pocket-sized trip you can actually share.
          </p>
        </div>

        <div className="landing-steps-inner">
          <div className="landing-step">
            <span className="landing-step-num">1</span>
            <h3 className="landing-step-title">Install the Claude skill</h3>
            <p className="landing-step-desc">
              A small file that teaches Claude about OurTrips. Drop it into your project — thirty seconds.
            </p>
            <a href="/our-trips.skill" download className="landing-btn-primary landing-btn-sm" style={{ gap: '8px' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Download skill
            </a>
          </div>
          <div className="landing-step">
            <span className="landing-step-num">2</span>
            <h3 className="landing-step-title">Plan out loud</h3>
            <p className="landing-step-desc">
              Talk your trip through with Claude. Flights, stays, food, detours — whatever you&apos;d naturally type.
            </p>
          </div>
          <div className="landing-step">
            <span className="landing-step-num">3</span>
            <h3 className="landing-step-title">Send it to OurTrips</h3>
            <p className="landing-step-desc">
              Say the words. Your trip gets a link you can share with everyone travelling with you.
            </p>
          </div>
        </div>

        <div className="landing-tell-more-wrap">
          <Link href="/guide" className="landing-tell-more">
            Read the full guide
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </Link>
        </div>
      </section>

      <section className="landing-cta">
        <div className="landing-cta-inner">
          <span className="landing-cta-eyebrow">Begin</span>
          <h2 className="landing-cta-title">
            Somewhere new is <em>closer</em> than it looks.
          </h2>
          <p className="landing-cta-desc">Free to use. Set up in under a minute.</p>
          <Link href="/login" className="landing-btn-primary">Create your account</Link>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span className="landing-footer-logo">OurTrips</span>
          <span className="landing-footer-copy">Built by Thijs van Schadewijk · 2026</span>
        </div>
      </footer>
    </div>
  );
}
