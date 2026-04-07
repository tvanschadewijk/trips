export interface BlogPost {
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  tag: string;
  date: string;           // ISO date
  readingTime: string;
  body: string;           // HTML string
}

export const posts: BlogPost[] = [
  {
    slug: 'how-to-use-claude-skills-to-plan-a-trip',
    title: 'How to Use Claude Skills to Plan a Trip',
    subtitle: 'Turn any Claude conversation into a shareable, interactive travel itinerary in under a minute.',
    excerpt: 'Claude skills are small files that give Claude new abilities. The Our Trips skill turns any travel conversation into a beautiful, pocket-friendly itinerary you can share with anyone.',
    tag: 'Guide',
    date: '2026-04-07',
    readingTime: '6 min read',
    body: `
<p>If you've ever planned a trip by chatting with Claude, you know the drill: you end up with a great itinerary buried in a conversation thread. Copying it into a doc, formatting it, making it shareable — that's the annoying part. <strong>Claude skills fix this.</strong></p>

<p>A skill is a small file you add to Claude that teaches it a new capability. The <strong>Our Trips skill</strong> lets Claude take any travel conversation and turn it into a beautifully designed, interactive itinerary with a shareable link — complete with day-by-day plans, bookings, photos, and tips.</p>

<p>Here's how to set it up and use it, step by step.</p>

<h2>What is a Claude skill?</h2>

<p>Think of a skill as a plugin for Claude. It's a file (ending in <code>.skill</code>) that you drop into a Claude CoWork session or Codex environment. Once installed, Claude gains new abilities — in this case, the ability to format your travel plans and send them to <a href="https://ourtrips.to">ourtrips.to</a>, where they become an interactive mobile-friendly itinerary.</p>

<p>Skills are part of Claude's agent ecosystem. They work in <strong>Claude CoWork</strong> (Anthropic's collaborative workspace) and <strong>Codex</strong> (the coding environment). If you've used MCP servers or custom instructions before, skills are the next evolution — they're portable, shareable, and purpose-built.</p>

<h2>Step 1: Install the Our Trips skill</h2>

<p>You have two options, both take about 30 seconds.</p>

<h3>Option A: Ask Claude to fetch it (easiest)</h3>

<p>If your CoWork session has internet access, just paste this into your chat:</p>

<pre><code>Fetch https://ourtrips.to/our-trips.skill and add it to my skills.</code></pre>

<p>Claude will download and install the skill automatically. Done.</p>

<h3>Option B: Upload it manually</h3>

<ol>
<li><strong>Download</strong> the skill file from <a href="https://ourtrips.to/our-trips.skill">ourtrips.to/our-trips.skill</a></li>
<li>Open the <strong>Customize</strong> menu in your CoWork session</li>
<li>Find <strong>Skills</strong>, click <strong>Add skill</strong>, and select the file</li>
</ol>

<p>That's it. The skill is now active for the rest of your session.</p>

<h2>Step 2: Plan your trip with Claude</h2>

<p>Now just talk to Claude like you normally would. Tell it where you're going, how long you'll be there, what you're interested in, your budget — anything that helps shape the trip. For example:</p>

<blockquote><p>I'm planning a 5-day trip to Tokyo in May with my partner. We love street food, hidden temples, and vinyl record shops. Budget is moderate — we'll splurge on one nice dinner but keep the rest casual. We're staying in Shimokitazawa.</p></blockquote>

<p>Claude will research, suggest activities, organize days, recommend restaurants, and build out a full itinerary through the conversation. This is the part you already know and love.</p>

<p>A few tips for better results:</p>

<ul>
<li><strong>Enable web search</strong> so Claude can pull current opening hours, reviews, and prices</li>
<li><strong>Turn on Extended Thinking</strong> for more detailed, well-organized itineraries</li>
<li><strong>Be specific</strong> about your travel style — "we walk a lot" or "we need downtime after lunch" makes a huge difference</li>
<li><strong>Iterate</strong> — ask Claude to swap activities, adjust timing, or add backup options</li>
</ul>

<h2>Step 3: Say "Send it to Our Trips"</h2>

<p>When you're happy with the itinerary, just tell Claude:</p>

<blockquote><p>Send it to Our Trips</p></blockquote>

<p>Claude will format your entire trip into a structured itinerary and send it to ourtrips.to. You'll get back a <strong>shareable link</strong> that you can open on any device.</p>

<p>The itinerary includes:</p>

<ul>
<li><strong>Day-by-day schedule</strong> with timings and descriptions</li>
<li><strong>Accommodation details</strong> — check-in/out, booking platform, cancellation policy</li>
<li><strong>Transport info</strong> — flights, trains, walking directions</li>
<li><strong>Restaurant picks</strong> with reservation notes</li>
<li><strong>Tips and notes</strong> for each day</li>
<li><strong>A hero image</strong> that captures the destination</li>
</ul>

<p>The result is a beautiful, mobile-optimized page you can pull up on your phone while traveling — no app download required.</p>

<h2>Why not just use a Google Doc?</h2>

<p>You could. But here's what you'd miss:</p>

<ul>
<li><strong>Design.</strong> Our Trips itineraries are designed for mobile. They look great in your pocket — not like a wall of text on a spreadsheet.</li>
<li><strong>Shareability.</strong> Send one link. Anyone can view it, no account needed.</li>
<li><strong>Structure.</strong> Days are navigable. Swipe between them. Tap for details on any activity, hotel, or flight.</li>
<li><strong>Speed.</strong> One sentence to Claude and it's done. No copying, no formatting, no fiddling.</li>
</ul>

<h2>Does this work with ChatGPT?</h2>

<p>Currently, the Our Trips skill is built for <strong>Claude CoWork and Codex</strong>. Support for ChatGPT (via Custom GPTs) is on the roadmap — the underlying API already supports it, so stay tuned.</p>

<p>If you're using Claude for trip planning already, this is the missing piece. Your conversations become real, shareable itineraries that actually work when you're on the ground.</p>

<h2>Get started in 30 seconds</h2>

<p>Ready to try it? Here's the quick version:</p>

<ol>
<li>Tell Claude: <code>Fetch https://ourtrips.to/our-trips.skill and add it to my skills.</code></li>
<li>Plan your trip through conversation</li>
<li>Say <strong>"Send it to Our Trips"</strong></li>
<li>Open your shareable link on any device</li>
</ol>

<p>That's it. Your next trip is one conversation away.</p>
`,
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return posts.find((p) => p.slug === slug);
}

export function getAllPosts(): BlogPost[] {
  return [...posts].sort((a, b) => b.date.localeCompare(a.date));
}
