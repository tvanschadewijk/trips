import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import GuideCopyButton from '@/components/ui/GuideCopyButton';
import AppTopBar from '@/components/ui/AppTopBar';
import '@/styles/guide.css';

export const metadata: Metadata = {
  title: 'How to Start a Trip in OurTrips',
  description:
    'Start a trip in OurTrips, collect bookings and notes, and let the built-in travel agent create a portable day-by-day guide.',
  alternates: {
    canonical: 'https://ourtrips.to/guide',
  },
  openGraph: {
    title: 'How to Start a Trip in OurTrips',
    description:
      'Start a trip in OurTrips, collect bookings and notes, and let the built-in travel agent create a portable day-by-day guide.',
    url: 'https://ourtrips.to/guide',
    siteName: 'OurTrips',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'How to Start a Trip in OurTrips',
    description:
      'Start a trip in OurTrips, collect bookings and notes, and let the built-in travel agent create a portable day-by-day guide.',
  },
};

export default function GuidePage() {
  const mcpServerUrl = 'https://ourtrips.to/mcp';
  const codexPrompt = `Install the connector to the MCP server: ${mcpServerUrl}`;

  return (
    <div className="guide">
      <AppTopBar
        suffix="Start a trip"
        actions={<Link href="/login?next=/dashboard%3Fagent%3Dnew" className="guide-btn-outline">Start</Link>}
      />

      <main className="guide-main">
        <div className="guide-content">
          <Link href="/" className="guide-back">
            <ArrowLeft size={16} strokeWidth={2.5} aria-hidden="true" />
            Back
          </Link>

          <h1 className="guide-title">Start with the messy trip pile.</h1>
          <p className="guide-intro">
            OurTrips now creates the trip from the beginning. Bring the bookings, notes,
            questions, preferences, and reference material you already have; the travel agent
            turns them into a portable guide you can keep refining.
          </p>

          <div className="guide-divider" />

          <section className="guide-section">
            <div className="guide-section-header">
              <span className="guide-section-badge">Recommended</span>
              <span className="guide-section-tag">In OurTrips</span>
            </div>
            <h2 className="guide-section-title">Create the trip inside OurTrips</h2>
            <p className="guide-section-desc">
              Start with a short travel-agent intake, then add the context that makes the trip real:
              dates, travelers, origin, budget, pace, must-dos, existing bookings, notes, PDFs,
              and open decisions.
            </p>

            <div className="guide-network-grid">
              <article className="guide-network-card">
                <h3 className="guide-network-title">1. Collect the material</h3>
                <ol className="guide-network-list">
                  <li>Tell OurTrips where you are going and when.</li>
                  <li>Add travelers, pace, budget, interests, and constraints.</li>
                  <li>Paste notes or upload references so real details are not lost.</li>
                </ol>
              </article>

              <article className="guide-network-card">
                <h3 className="guide-network-title">2. Let the guide take shape</h3>
                <ol className="guide-network-list">
                  <li>The agent drafts a day-by-day plan from your material.</li>
                  <li>It checks logistics, route points, stays, meals, and practical tips.</li>
                  <li>You open the trip, share it, save it offline, and keep editing.</li>
                </ol>
              </article>
            </div>

            <div className="guide-cta">
              <Link href="/login?next=/dashboard%3Fagent%3Dnew" className="guide-cta-link">
                Start a trip in OurTrips
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </section>

          <div className="guide-divider" />

          <section className="guide-section">
            <div className="guide-section-header">
              <span className="guide-section-badge">What it produces</span>
              <span className="guide-section-tag">Portable guide</span>
            </div>
            <h2 className="guide-section-title">A day-by-day trip you can actually use</h2>
            <p className="guide-section-desc">
              The finished trip is organized around the day you are in: plan, stays, transport,
              restaurants, maps, reservation notes, tips, and the open decisions that still need attention.
            </p>
            <p className="guide-section-note">
              This is the core change: OurTrips is no longer just a destination for an outside
              planning conversation. It is the place where the trip starts, grows, and travels with you.
            </p>
          </section>

          <div className="guide-divider" />

          <section className="guide-section">
            <div className="guide-section-header">
              <span className="guide-section-badge">Optional</span>
              <span className="guide-section-tag">External agents</span>
            </div>
            <h2 className="guide-section-title">Connect an outside planning conversation</h2>
            <p className="guide-section-desc">
              If you already plan in Claude, Codex, or another agent with remote MCP support,
              you can still add the OurTrips connector and send that work into the same trip guide.
              This is useful for continuing an existing agent thread, but it is no longer required.
            </p>

            <div className="guide-code-block">
              <code>{mcpServerUrl}</code>
              <GuideCopyButton value={mcpServerUrl} />
            </div>
            <p className="guide-section-note">
              Add this server URL as a custom MCP connector, sign in when prompted, then ask the agent
              to send or update the trip in OurTrips.
            </p>

            <div className="guide-network-grid">
              <article className="guide-network-card">
                <h3 className="guide-network-title">Claude</h3>
                <ol className="guide-network-list">
                  <li>Open <strong>Customize</strong>, then <strong>Connectors</strong>.</li>
                  <li>Choose <strong>Add custom connector</strong> or <strong>Custom Web</strong>.</li>
                  <li>Paste <strong>{mcpServerUrl}</strong> as the remote MCP server URL.</li>
                  <li>Click <strong>Connect</strong>, sign in, and enable OurTrips in your chat.</li>
                </ol>
              </article>

              <article className="guide-network-card">
                <h3 className="guide-network-title">Codex</h3>
                <p className="guide-step-desc">
                  Ask Codex to install the connector, then paste the server URL:
                </p>
                <div className="guide-code-block guide-code-block-small">
                  <code>{codexPrompt}</code>
                  <GuideCopyButton value={codexPrompt} />
                </div>
              </article>
            </div>
          </section>

          <div className="guide-cta">
            <Link href="/itineraries" className="guide-cta-link">
              See what a finished trip looks like
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </main>

      <footer className="guide-footer">
        <div className="guide-footer-inner">
          <span className="guide-footer-logo">OurTrips</span>
          <span className="guide-footer-copy">Built by Thijs van Schadewijk</span>
        </div>
      </footer>
    </div>
  );
}
