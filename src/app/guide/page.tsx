import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import GuideCopyButton from '@/components/ui/GuideCopyButton';
import LogoSuffix from '@/components/ui/LogoSuffix';
import '@/styles/guide.css';

export const metadata: Metadata = {
  title: 'How to Connect OurTrips to Claude or Codex',
  description:
    'Connect the OurTrips remote MCP server to Claude or Codex and turn AI travel planning conversations into shareable itineraries.',
  alternates: {
    canonical: 'https://ourtrips.to/guide',
  },
  openGraph: {
    title: 'How to Connect OurTrips to Claude or Codex',
    description:
      'Connect the OurTrips remote MCP server to Claude or Codex and turn AI travel planning conversations into shareable itineraries.',
    url: 'https://ourtrips.to/guide',
    siteName: 'OurTrips',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'How to Connect OurTrips to Claude or Codex',
    description:
      'Connect the OurTrips remote MCP server to Claude or Codex and turn AI travel planning conversations into shareable itineraries.',
  },
};

export default function GuidePage() {
  const mcpServerUrl = 'https://ourtrips.to/mcp';
  const codexPrompt = `Install the connector to the MCP server: ${mcpServerUrl}`;

  return (
    <div className="guide">
      <nav className="guide-nav">
        <div className="guide-nav-inner">
          <Link href="/" className="guide-logo">OurTrips<LogoSuffix /></Link>
          <Link href="/login" className="guide-btn-outline">Log in</Link>
        </div>
      </nav>

      <main className="guide-main">
        <div className="guide-content">
          <Link href="/" className="guide-back">
            <ArrowLeft size={16} strokeWidth={2.5} aria-hidden="true" />
            Back
          </Link>

          <h1 className="guide-title">Connect OurTrips to your agent</h1>
          <p className="guide-intro">
            The recommended setup is a remote MCP connector. It gives Claude or Codex a direct,
            OAuth-secured OurTrips tool, so your itinerary can be saved without fighting agent
            sandbox networking.
          </p>

          <div className="guide-divider" />

          <section className="guide-section">
            <div className="guide-section-header">
              <span className="guide-section-badge">Recommended</span>
              <span className="guide-section-tag">Remote MCP</span>
            </div>
            <h2 className="guide-section-title">Connect the OurTrips MCP server</h2>
            <p className="guide-section-desc">
              Add this server URL as a custom MCP connector, then sign in with your OurTrips
              account when your agent asks for authorization.
            </p>
            <div className="guide-code-block">
              <code>{mcpServerUrl}</code>
              <GuideCopyButton value={mcpServerUrl} />
            </div>
            <p className="guide-section-note">
              The connector exposes trip save/edit tools, schema templates, Unsplash image search,
              and generated cover assets. It uses OAuth, so you do not need to paste API keys into chats.
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

          <div className="guide-divider" />

          <section className="guide-section">
            <div className="guide-section-header">
              <span className="guide-section-badge">Why this helps</span>
              <span className="guide-section-tag">No sandbox curl</span>
            </div>
            <h2 className="guide-section-title">The connector keeps API calls on OurTrips</h2>
            <p className="guide-section-desc">
              The remote MCP connector gives Claude or Codex a signed-in OurTrips tool surface.
              The server handles saving, patching, image search, and generated image assets for the
              signed-in user, so the setup does not depend on separate skill instructions.
            </p>
            <p className="guide-section-note">
              That means the user setup is just: add connector, sign in, ask the agent to send the
              trip to OurTrips.
            </p>
          </section>

          <div className="guide-divider" />

          <section className="guide-section">
            <h2 className="guide-section-title">What happens next?</h2>
            <p className="guide-section-desc">
              Once OurTrips is connected, just plan your trip with Claude or Codex like you normally would.
              When you&apos;re happy with the itinerary, say something like
              <strong> &ldquo;Send it to OurTrips&rdquo;</strong> and your agent will create a shareable,
              interactive itinerary you can pull up on your phone while traveling.
            </p>
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
