import Link from 'next/link';
import '@/styles/guide.css';

export default function GuidePage() {
  return (
    <div className="guide">
      <nav className="guide-nav">
        <div className="guide-nav-inner">
          <Link href="/" className="guide-logo">Our Trips</Link>
          <Link href="/login" className="guide-btn-outline">Log in</Link>
        </div>
      </nav>

      <main className="guide-main">
        <div className="guide-content">
          <Link href="/" className="guide-back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            Back
          </Link>

          <h1 className="guide-title">How to install the Our Trips skill</h1>
          <p className="guide-intro">
            A skill is a small file that teaches Claude new tricks. Once you add the Our Trips skill
            to your CoWork session, Claude will know how to turn your travel plans into a
            beautiful, shareable itinerary. It takes about 30 seconds.
          </p>

          <div className="guide-divider" />

          <section className="guide-section">
            <div className="guide-section-header">
              <span className="guide-section-badge">Option A</span>
              <span className="guide-section-tag">Easiest</span>
            </div>
            <h2 className="guide-section-title">Ask Claude to grab it</h2>
            <p className="guide-section-desc">
              If your CoWork session has internet access, you don&apos;t need to download anything.
              Just paste this into your chat:
            </p>
            <div className="guide-code-block">
              <code>Fetch https://ourtrips.to/our-trips.skill and add it to my skills.</code>
              <button className="guide-copy-btn" onClick={undefined} aria-label="Copy to clipboard">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
            <p className="guide-section-note">
              Claude will fetch the skill file from Our Trips and install it for you. Done!
            </p>
          </section>

          <div className="guide-or">
            <span>or</span>
          </div>

          <section className="guide-section">
            <div className="guide-section-header">
              <span className="guide-section-badge">Option B</span>
              <span className="guide-section-tag">Manual</span>
            </div>
            <h2 className="guide-section-title">Upload it yourself</h2>
            <p className="guide-section-desc">
              Prefer to do it by hand? Three quick steps:
            </p>

            <div className="guide-steps">
              <div className="guide-step">
                <div className="guide-step-num">1</div>
                <div className="guide-step-body">
                  <div className="guide-step-title">Download the skill file</div>
                  <p className="guide-step-desc">
                    Click the button below to save <strong>our-trips.skill</strong> to your computer.
                  </p>
                  <a href="/our-trips.skill" download className="guide-download-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    Download our-trips.skill
                  </a>
                </div>
              </div>

              <div className="guide-step">
                <div className="guide-step-num">2</div>
                <div className="guide-step-body">
                  <div className="guide-step-title">Open the Customize menu</div>
                  <p className="guide-step-desc">
                    In your CoWork session, look for the <strong>Customize</strong> button
                    (usually in the sidebar or top bar). Click it to open the settings panel.
                  </p>
                </div>
              </div>

              <div className="guide-step">
                <div className="guide-step-num">3</div>
                <div className="guide-step-body">
                  <div className="guide-step-title">Add the skill file</div>
                  <p className="guide-step-desc">
                    Find the <strong>Skills</strong> section, click <strong>Add skill</strong>,
                    and select the <strong>our-trips.skill</strong> file you just downloaded.
                    That&apos;s it &mdash; the skill is now active.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <div className="guide-divider" />

          <section className="guide-section">
            <h2 className="guide-section-title">What happens next?</h2>
            <p className="guide-section-desc">
              Once the skill is installed, just plan your trip with Claude like you normally would.
              When you&apos;re happy with the itinerary, say something like
              <strong> &ldquo;Send it to Our Trips&rdquo;</strong> and Claude will create a shareable,
              interactive itinerary you can pull up on your phone while traveling.
            </p>
          </section>

          <div className="guide-cta">
            <Link href="/demo" className="guide-cta-link">
              See what a finished trip looks like
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </Link>
          </div>
        </div>
      </main>

      <footer className="guide-footer">
        <div className="guide-footer-inner">
          <span className="guide-footer-logo">Our Trips</span>
          <span className="guide-footer-copy">Built by Thijs van Schadewijk</span>
        </div>
      </footer>
    </div>
  );
}
