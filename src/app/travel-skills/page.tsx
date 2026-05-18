/* eslint-disable @next/next/no-img-element */

import type { Metadata } from 'next';
import Link from 'next/link';
import LogoSuffix from '@/components/ui/LogoSuffix';
import '@/styles/travel-skills.css';

export const metadata: Metadata = {
  title: 'Other Useful Travel Skills - OurTrips',
  description:
    'Download extra travel skills for OurTrips, including Accommodation Reviewer: a local review board for comparing stays before adding the final choice to your itinerary.',
  alternates: {
    canonical: 'https://ourtrips.to/travel-skills',
  },
  openGraph: {
    title: 'Other Useful Travel Skills - OurTrips',
    description:
      'Extra travel skills that make AI trip planning easier before your finished itinerary goes to OurTrips.',
    url: 'https://ourtrips.to/travel-skills',
    siteName: 'OurTrips',
    locale: 'en_US',
    type: 'website',
  },
};

export default function TravelSkillsPage() {
  return (
    <div className="travel-skills-page">
      <nav className="travel-skills-nav">
        <div className="travel-skills-nav-inner">
          <Link href="/" className="travel-skills-logo">
            OurTrips<LogoSuffix />
          </Link>
          <div className="travel-skills-nav-links">
            <Link href="/itineraries" className="travel-skills-nav-link">Itineraries</Link>
            <Link href="/travel-skills" className="travel-skills-nav-link">Travel Skills</Link>
            <Link href="/blog" className="travel-skills-nav-link">Journal</Link>
            <Link href="/login" className="travel-skills-btn-outline">Log in</Link>
          </div>
        </div>
      </nav>

      <main>
        <section className="travel-skills-hero">
          <div className="travel-skills-hero-inner">
            <div className="travel-skills-hero-copy">
              <div className="travel-skills-kicker">Travel skill ecosystem</div>
              <h1>Other Useful Travel Skills.</h1>
              <p>
                OurTrips turns a finished plan into a beautiful itinerary. These extra skills
                handle the messy work around it: reviewing choices, collecting feedback, and
                keeping decisions tidy before they become part of the trip.
              </p>
            </div>
            <figure className="travel-skills-hero-figure">
              <img
                src="https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1200&h=900&fit=crop&crop=center&q=85"
                alt="Travel planning notes, a map, and a camera on a table"
              />
              <figcaption>Planning tools before the final itinerary</figcaption>
            </figure>
          </div>
        </section>

        <section className="travel-skills-list" aria-labelledby="skills-heading">
          <div className="travel-skills-list-header">
            <div>
              <div className="travel-skills-kicker">Available now</div>
              <h2 id="skills-heading">First add-on skill</h2>
            </div>
            <p>
              Accommodation decisions deserve their own workspace. A trip page should show the
              final answer; this skill helps you get to that answer faster.
            </p>
          </div>

          <article className="travel-skill-card">
            <div className="travel-skill-card-main">
              <div className="travel-skill-meta">
                <span>Skill download</span>
                <span>Version 1</span>
              </div>
              <h3>Accommodation Reviewer</h3>
              <p className="travel-skill-lede">
                A local review board for comparing hotels, villas, apartments, lodges, camps,
                and other stays before the winner goes into OurTrips.
              </p>

              <div className="travel-skill-actions">
                <a href="/accommodation-reviewer.skill" download className="travel-skills-btn-primary">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download skill
                </a>
                <a href="/accommodation-reviewer-version.json" className="travel-skills-text-link">
                  Version file
                </a>
              </div>
            </div>

            <div className="travel-skill-card-aside">
              <section>
                <h4>Why we created it</h4>
                <p>
                  Accommodation planning gets noisy: price comparisons, direct hotel replies,
                  cancellation rules, parking, room trade-offs, and traveler preferences all live
                  in different places. We created this skill so those decisions do not disappear
                  inside a long chat thread.
                </p>
              </section>

              <section>
                <h4>What it does</h4>
                <p>
                  The skill turns a shortlist into a self-contained HTML review board. Every stay
                  gets its own card, status, links, blockers, next action, and feedback box. Your
                  feedback autosaves locally and can be copied back to Codex or Claude when you are
                  ready for the next pass.
                </p>
              </section>

              <section>
                <h4>How it adds to OurTrips</h4>
                <p>
                  Accommodation Reviewer is the decision cockpit; OurTrips is the finished
                  itinerary. Use the reviewer while you are comparing options, then use the
                  OurTrips skill to publish the chosen or booked stay inside the shareable trip.
                </p>
              </section>
            </div>
          </article>
        </section>

        <section className="travel-skills-install">
          <div className="travel-skills-install-inner">
            <div>
              <div className="travel-skills-kicker">Install prompt</div>
              <h2>Let your agent fetch the latest version.</h2>
            </div>
            <div className="travel-skills-code">
              <code>Fetch https://ourtrips.to/accommodation-reviewer.skill and add it to my skills.</code>
            </div>
            <p>
              The skill checks <code>https://ourtrips.to/accommodation-reviewer-version.json</code> on first
              use, so people get nudged to update when a newer version is available.
            </p>
          </div>
        </section>
      </main>

      <footer className="travel-skills-footer">
        <div className="travel-skills-footer-inner">
          <span className="travel-skills-footer-logo">OurTrips</span>
          <span className="travel-skills-footer-copy">Built by Thijs van Schadewijk</span>
        </div>
      </footer>
    </div>
  );
}
