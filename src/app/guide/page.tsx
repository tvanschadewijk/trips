import type { Metadata } from 'next';
import Link from 'next/link';
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
  const codexCliCommand = `codex mcp add ourtrips --url ${mcpServerUrl}
codex mcp login ourtrips`;
  const codexToml = `[mcp_servers.ourtrips]
url = "${mcpServerUrl}"`;
  const skillInstallPrompt = 'Fetch https://ourtrips.to/our-trips.skill and add it to my skills. After installing it, remind me to set network access to All domains before I send trips to OurTrips.';

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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
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
              The connector exposes save_trip, list_trips, get_trip, and patch_trip. It uses OAuth,
              so you do not need to paste API keys into chats.
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
                  Run this in your terminal:
                </p>
                <div className="guide-code-block guide-code-block-small">
                  <code>{codexCliCommand}</code>
                  <GuideCopyButton value={codexCliCommand} />
                </div>
              </article>
            </div>

            <p className="guide-section-desc">
              Prefer manual Codex config? Add this to <code>~/.codex/config.toml</code>, restart
              Codex, then run <code>codex mcp login ourtrips</code>.
            </p>
            <div className="guide-code-block guide-code-block-small">
              <code>{codexToml}</code>
              <GuideCopyButton value={codexToml} />
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
              The old skill asks the agent sandbox to call the OurTrips API directly. Some agent
              sandboxes block that network path, even after users adjust allowed domains. With the
              remote MCP connector, Claude or Codex talks to <code>{mcpServerUrl}</code>, and the
              OurTrips server saves the itinerary internally for the signed-in user.
            </p>
            <p className="guide-section-note">
              That means the user setup is just: add connector, sign in, ask the agent to send the
              trip to OurTrips.
            </p>
          </section>

          <div className="guide-divider" />

          <section className="guide-section">
            <div className="guide-section-header">
              <span className="guide-section-badge">Fallback</span>
              <span className="guide-section-tag">Legacy skill</span>
            </div>
            <h2 className="guide-section-title">Use the skill only when MCP is unavailable</h2>
            <p className="guide-section-desc">
              If your agent does not support remote MCP yet, the OurTrips skill is still available.
              This path can still depend on sandbox network access, so use the connector above
              whenever you can.
            </p>
            <div className="guide-code-block">
              <code>{skillInstallPrompt}</code>
              <GuideCopyButton value={skillInstallPrompt} />
            </div>

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
                  <div className="guide-step-title">Add the skill file</div>
                  <p className="guide-step-desc">
                    Open your agent customization settings, find <strong>Skills</strong>, click
                    <strong> Add skill</strong>, and select the downloaded file.
                  </p>
                </div>
              </div>

              <div className="guide-step">
                <div className="guide-step-num">3</div>
                <div className="guide-step-body">
                  <div className="guide-step-title">Allow network access</div>
                  <p className="guide-step-desc">
                    If the skill reports sandbox network errors, allow <strong>All domains</strong>
                    or at least <strong>ourtrips.to</strong>, then start a fresh agent session.
                  </p>
                </div>
              </div>
            </div>
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
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
