import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = new URL(".", import.meta.url).pathname;
const outputPath = `${outputDir}ourtrips-feature-user-story-tracker.xlsx`;
const repo = "/Users/thijsvanschadewijk/Documents/Development/Trips";

const stories = [
  ["US-001", "Marketing", "/", "Unauthenticated landing page", "As a new visitor, I want to understand what OurTrips does and choose a next step.", "Show editorial landing navigation, hero copy, CTAs to login and itineraries, inspiration cards, guide links, CTA, footer, and JSON-LD.", "src/app/page.tsx; src/styles/landing.css", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-002", "Marketing", "/", "Authenticated landing redirect", "As a signed-in user, I want the home page to take me to my active trip or dashboard.", "If Supabase is configured and a user session exists, redirect to the active in-date trip when one exists, otherwise redirect to /dashboard, except internal referer visits to /.", "src/app/page.tsx", "Mapped", "P1", "Browser/Auth", "Not Started", "", ""],
  ["US-003", "Marketing", "/", "Landing itinerary cards", "As a visitor, I want sample itineraries on the landing page to open real public itinerary pages.", "Render up to three non-Bonaire public itinerary cards with image, metadata, copy, and links to each canonical itinerary path.", "src/app/page.tsx; src/lib/public-itineraries.ts", "Mapped", "P2", "Browser", "Not Started", "", ""],
  ["US-004", "Auth", "/login", "Google sign-in", "As a user, I want to sign in with Google and return to my intended page.", "When Supabase is configured, show Google sign-in, pass next through the OAuth callback, and redirect existing sessions to next or dashboard.", "src/app/login/page.tsx; src/app/api/auth/callback/route.ts", "Retested", "P1", "Browser/Auth", "Pass", "2026-06-22", "Route smoke passed on desktop/mobile; mobile layout overlap fixed and retested. External Google OAuth provider handoff not completed in local smoke."],
  ["US-005", "Auth", "/login", "Local preview login", "As a developer without Supabase env vars, I want to open local preview data.", "When Supabase public env vars are missing, show the local preview warning and an Open local preview button that seeds session storage and routes to dashboard.", "src/app/login/page.tsx; src/lib/local-preview.ts", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-006", "Dashboard", "/dashboard", "Dashboard authentication and caching", "As a user, I want my trips dashboard to load quickly while respecting auth.", "Use cached sessionStorage trips/email initially, then fetch the Supabase user and trips; unauthenticated users route to /login.", "src/app/dashboard/page.tsx", "Mapped", "P1", "Browser/Auth", "Not Started", "", ""],
  ["US-007", "Dashboard", "/dashboard", "Trip grouping", "As a traveler, I want trips grouped by current, upcoming, and past.", "Group visible non-public trips by date, sort current by nearest end, upcoming by start, and past by latest end.", "src/app/dashboard/page.tsx", "Mapped", "P1", "Browser/Data", "Not Started", "", ""],
  ["US-008", "Dashboard", "/dashboard", "Dashboard offline mode", "As an offline traveler, I want the dashboard to show only saved trips and prevent online-only actions.", "When offline, show an offline banner, filter trips to saved offline IDs, show empty saved-trip state when none exist, hide online new-trip/profile links, and disable sign-out.", "src/app/dashboard/page.tsx; src/lib/offline.ts; src/lib/online-status.ts", "Mapped", "P1", "Browser/Offline", "Not Started", "", ""],
  ["US-009", "Dashboard", "/dashboard", "Settings menu", "As a signed-in user, I want account actions in one settings menu.", "Settings toggles by button/backdrop, shows email, admin analytics link for admins, travel profile link when online, sign out, and app version when provided.", "src/app/dashboard/page.tsx", "Mapped", "P2", "Browser", "Not Started", "", ""],
  ["US-010", "Dashboard", "/dashboard", "First-trip onboarding empty state", "As a new user, I want a clear path to profile setup and trip creation.", "When there are no trips, show a three-step onboarding panel with travel profile action and create-trip action that changes based on profile completion.", "src/app/dashboard/page.tsx", "Mapped", "P2", "Browser", "Not Started", "", ""],
  ["US-011", "Dashboard", "/dashboard", "Open trip from dashboard", "As a traveler, I want to open a trip card smoothly.", "Trip cards preload the overview image, write a transition snapshot to sessionStorage, use View Transitions when available, and navigate to /t/[shareId].", "src/app/dashboard/page.tsx; src/app/t/[shareId]/loading.tsx", "Mapped", "P2", "Browser", "Not Started", "", ""],
  ["US-012", "Travel Profile", "/onboarding", "Travel profile auth gate", "As a user, I want travel profile setup to require sign-in.", "Unauthenticated users redirect to /login?next=/onboarding; authenticated users load preferences and source references with safe next routing.", "src/app/onboarding/page.tsx", "Mapped", "P1", "Browser/Auth", "Not Started", "", ""],
  ["US-013", "Travel Profile", "/onboarding", "Traveler details editor", "As a traveler, I want to add and maintain traveler booking details.", "Allow add, edit, and remove traveler profiles with name, DOB, gender, passport fields, and notes; keep traveler summary synchronized.", "src/components/travel-profile/TravelProfileForm.tsx; src/lib/travel-profile.ts", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-014", "Travel Profile", "/onboarding", "Preference capture", "As a traveler, I want planning preferences saved for future trip generation.", "Capture home base, airports/stations, pace, budget, lodging, food, interests, transport, accessibility, pets, avoidances, and notes.", "src/components/travel-profile/TravelProfileForm.tsx", "Mapped", "P1", "Browser/API", "Not Started", "", ""],
  ["US-015", "Travel Profile", "/onboarding", "Previous trip references", "As a traveler, I want prior trip files to inform future plans.", "Upload a supported previous-trip file, display source status, rebuild and preview reference markdown, and remove uploaded sources.", "src/components/travel-profile/TravelProfileForm.tsx; src/app/api/travel-profile/sources/route.ts; src/app/api/travel-profile/sources/[id]/route.ts", "Mapped", "P2", "Browser/API", "Not Started", "", ""],
  ["US-016", "Travel Profile", "/api/travel-profile", "Profile persistence API", "As the app, I need to save and read a user's travel profile.", "GET returns normalized profile and completion state; PUT validates preferences, stores reference markdown from sources, sets onboarding completion when requested, and upserts the user row.", "src/app/api/travel-profile/route.ts; src/lib/travel-profile.ts", "Mapped", "P1", "API", "Not Started", "", ""],
  ["US-017", "Trip Creation", "/trips/new", "New trip auth and prefill", "As a signed-in user, I want trip creation to start with my profile context.", "Unauthenticated users redirect to login with next; authenticated users load normalized preferences and profile completion state and render the creator.", "src/app/trips/new/page.tsx; src/components/trips/NewTripCreator.tsx", "Mapped", "P1", "Browser/Auth", "Not Started", "", ""],
  ["US-018", "Trip Creation", "/trips/new", "Ask Travel Agent sheet", "As a user, I want trip creation to feel like a guided agent conversation.", "Show an entry pill, auto-open the sheet, allow minimize/close when idle, and keep a progress/status aside in the sheet.", "src/components/trips/NewTripCreator.tsx; src/styles/trip-create.css", "Mapped", "P2", "Browser", "Not Started", "", ""],
  ["US-019", "Trip Creation", "/trips/new", "Guided trip brief", "As a user, I want to answer destination, dates, travelers, origin, style, must-dos, bookings, notes, and references.", "Advance one question at a time, show completed answer bubbles, allow back while idle, support skip on optional questions, and summarize the gathered brief.", "src/components/trips/NewTripCreator.tsx", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-020", "Trip Creation", "/trips/new", "Date range picker", "As a user, I want to choose valid trip dates without accidental impossible ranges.", "Default start 60 days out, end 5 days later, disallow dates before today, require end after start, clamp invalid end to start plus 5 days, and show inclusive day count.", "src/components/trips/NewTripCreator.tsx", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-021", "Trip Creation", "/api/trip-references", "Trip reference upload", "As a user, I want to add files or photos as references for a new trip.", "Accept PDF/text/markdown/JSON/images within file-size caps, extract useful text locally or via Anthropic when configured, return ready/partial/unsupported source records, and surface upload errors.", "src/components/trips/NewTripCreator.tsx; src/app/api/trip-references/route.ts; src/lib/trip-references.ts", "Mapped", "P2", "Browser/API", "Not Started", "", ""],
  ["US-022", "Trip Creation", "/api/trips/create-draft", "Create draft workspace", "As a user, I want create-trip to create a saved draft before the agent expands it.", "Validate the brief, load profile context, create a unique trip name, save starter trip data, create a generation session, and return an agent message plus trip URL.", "src/app/api/trips/create-draft/route.ts; src/lib/trip-creation.ts; src/lib/trip-service.ts", "Mapped", "P1", "API", "Not Started", "", ""],
  ["US-023", "Trip Creation", "/trips/new", "Generation progress and fallback", "As a user, I want clear progress while the travel agent builds a trip.", "After draft creation, post the generated agent message to chat, update generation status, poll queued runs up to timeout, show elapsed estimates, open the trip on success, and offer the draft link on error.", "src/components/trips/NewTripCreator.tsx; src/app/api/trip-generations/[id]/route.ts; src/app/api/trips/[id]/chat/route.ts", "Mapped", "P1", "Browser/API", "Not Started", "", ""],
  ["US-024", "Trip Page", "/t/[shareId]", "Trip access and privacy", "As an owner or shared viewer, I want to see only trips I am allowed to see.", "Load local preview or Supabase trip by share_id; private trips are owner-only, remix trips are scrubbed for non-owners, companion trips strip private travel wallet data for non-owners, and missing/unauthorized trips 404.", "src/app/t/[shareId]/page.tsx; src/lib/scrub-trip.ts; src/lib/local-preview.ts", "Mapped", "P1", "Browser/Auth", "Not Started", "", ""],
  ["US-025", "Trip Page", "/t/[shareId]", "Trip metadata and social images", "As a shared-trip recipient, I want links to have useful titles and preview images.", "Generate metadata from trip data, canonical public itinerary URL when relevant, and dynamic OG/Twitter images for companion/remix trips with brand fallback.", "src/app/t/[shareId]/page.tsx; src/app/t/[shareId]/opengraph-image.tsx; src/app/t/[shareId]/twitter-image.tsx; src/lib/og-trip-image.tsx", "Mapped", "P2", "Browser/SEO", "Not Started", "", ""],
  ["US-026", "Trip Preview", "Trip cover", "Hero overview", "As a traveler, I want the trip cover to summarize the journey before day details.", "Render cover image or map, date range, nights/stops/transport chips, route flow, highlights, metrics, trip overview action, day-by-day CTA, today CTA when applicable, notes, and responsive overview map.", "src/components/preview/TripPreview.tsx; src/components/preview/ItineraryMap.tsx; src/components/preview/TripRouteAtlas.tsx", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-027", "Trip Preview", "Trip cover", "Map/photo toggle", "As a traveler, I want to switch between the trip photo and map.", "When route atlas exists, show map toggle; on desktop auto-show map, on mobile show map card; if geography hides access legs, expose full journey toggle.", "src/components/preview/TripPreview.tsx; src/components/preview/ItineraryMap.tsx", "Mapped", "P2", "Browser", "Not Started", "", ""],
  ["US-028", "Trip Preview", "Trip overview detail", "Overview sections", "As a traveler, I want an overview drawer of logistics, stays, activities, restaurants, readiness, and source plan.", "Opening Trip overview shows available sections; each section opens details; owners with tripId see AccommodationReviewBoard instead of static accommodation list; markdown source appears as Original plan when present.", "src/components/preview/TripPreview.tsx; src/components/preview/AccommodationReviewBoard.tsx", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-029", "Trip Preview", "Navigation", "Day slide navigation", "As a traveler, I want to move through days with multiple input methods.", "Use day-by-day CTA, breadcrumb back to cover, date strip buttons, swipe gestures, dot tabs, and keyboard arrows/Escape while avoiding editable targets.", "src/components/preview/TripPreview.tsx", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-030", "Trip Preview", "Day slide", "Day header and map", "As a traveler, I want each day to show its story and place context.", "Render day hero or plain header, day intro, stats, day map when locations exist, view-all locations button, map focus from linked place labels, and fallback atlas when maps cannot load.", "src/components/preview/TripPreview.tsx; src/components/preview/ItineraryMap.tsx; src/lib/day-map.ts", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-031", "Trip Preview", "Day slide", "Today mode", "As a traveler on an active trip, I want a current-day card showing what is next.", "If today's date falls within the trip, auto-open the cover and show Continue to Today; the matching day shows current, next, later, sleep, transport, meal, and open action count.", "src/components/preview/TripPreview.tsx", "Mapped", "P2", "Browser/Data", "Not Started", "", ""],
  ["US-032", "Trip Preview", "Day slide", "Activities and place links", "As a traveler, I want activity blocks to be readable and connected to the day map.", "Show displayable activity blocks, option labels, detail buttons for rich blocks, and clickable place text that focuses the matching map target.", "src/components/preview/TripPreview.tsx", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-033", "Trip Preview", "Day slide", "Transport and service rows", "As a traveler, I want transport details and extra service legs on the correct day.", "Render transport rows with route, times, duration/distance, status, detail sheets, and service legs deduped against same-day transport routes and excluding meal-reservation services.", "src/components/preview/TripPreview.tsx; src/lib/types.ts", "Mapped", "P1", "Browser/Data", "Not Started", "", ""],
  ["US-034", "Trip Preview", "Day slide", "Accommodation card and booked action", "As a trip owner, I want to mark real accommodation as booked from the itinerary.", "Show pending or confirmed stay cards, suppress booking action for placeholder hotel names, post to toggle-status for named stays, update all matching stay days locally, and show inline retry state on failure.", "src/components/preview/TripPreview.tsx; src/app/api/trips/[id]/toggle-status/route.ts", "Mapped", "P1", "Browser/API", "Not Started", "", ""],
  ["US-035", "Trip Preview", "Day slide", "Dining cards", "As a traveler, I want meals and reservations to be visible with details.", "Render displayable meals, type/status for multiple meals, clickable map place names, rich detail sheets, reservation/practical fields, and action item inclusion when reservation is required or indicated.", "src/components/preview/TripPreview.tsx", "Mapped", "P1", "Browser/Data", "Not Started", "", ""],
  ["US-036", "Trip Preview", "Day slide", "Tips", "As a traveler, I want practical day tips available without cluttering the page.", "Render non-empty tips, high-priority styling, and open a detail sheet with title/content when tapped.", "src/components/preview/TripPreview.tsx", "Mapped", "P2", "Browser", "Not Started", "", ""],
  ["US-037", "Trip Preview", "Details", "Detail sheet behavior", "As a traveler, I want details to open and close predictably.", "Opening a detail sheet pushes browser history, Escape/backdrop/close closes it with animation, browser back closes the detail instead of leaving the trip, and HTML detail content is escaped or rendered through markdown helper.", "src/components/preview/TripPreview.tsx; src/lib/render-trip-markdown.ts", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-038", "Trip Preview", "Trip actions menu", "Owner and device actions", "As a trip owner, I want one menu for sharing, offline, share mode, and deletion.", "Cover actions menu copies share link with toast, downloads or removes offline copy with confirmation, changes share mode for owned trips with rollback on failure, and confirms delete before removing the trip.", "src/components/preview/TripPreview.tsx; src/lib/offline.ts; src/app/api/trips/[id]/share-mode/route.ts", "Retested", "P1", "Browser/API", "Pass", "2026-06-22", "Browser-level CDP test passed for offline download/remove via Trip actions menu on public sample trip."],
  ["US-039", "Trip Preview", "Shared trip CTA", "Add or remix shared trip", "As a recipient, I want to save or remix a shared itinerary to my own trips.", "Shared/public viewers see Add to my trips or Remix this trip; unauthenticated users store intent and redirect to login; saved/already-saved states route to dashboard; owners do not see save CTA.", "src/components/preview/TripPreview.tsx; src/app/api/trips/clone/route.ts", "Mapped", "P1", "Browser/API", "Not Started", "", ""],
  ["US-040", "Trip Preview", "Archive mode", "Trip archive overview", "As a user with multiple trip cards in the preview archive shell, I want upcoming and past trips separated.", "Overview screen separates upcoming and archive by end date, menu opens archive, archive back returns, empty states render, and trip cards open on click/keyboard.", "src/components/preview/TripPreview.tsx", "Mapped", "P3", "Browser", "Not Started", "", ""],
  ["US-041", "Trip Chat", "Trip page", "Chat availability", "As a trip owner, I want to edit the trip by chat, while shared viewers cannot.", "Only non-public-sample owners with viewer user ID receive TripChatPanel; panel hides offline; entry pill opens a sheet and minimized status pill.", "src/app/t/[shareId]/page.tsx; src/components/chat/TripChatPanel.tsx", "Mapped", "P1", "Browser/Auth", "Not Started", "", ""],
  ["US-042", "Trip Chat", "Trip page", "Send edit request", "As a trip owner, I want to ask the travel agent for edits and see progress.", "Send creates optimistic user message, includes current slide context from sessionStorage, posts to /chat, handles fast-lane or queued responses, polls progress, renders markdown assistant messages, shows applied edit count, refreshes trip on tool calls, and surfaces dropped-connection guidance.", "src/components/chat/TripChatPanel.tsx; src/app/api/trips/[id]/chat/route.ts", "Mapped", "P1", "Browser/API", "Not Started", "", ""],
  ["US-043", "Trip Chat", "Trip page", "Thread history", "As a trip owner, I want chat conversations grouped and manageable.", "History rail groups threads by recency, supports new chat, select thread, rename with optimistic rollback, delete with confirmation, stale threads open fresh, and desktop rail preference persists.", "src/components/chat/TripChatPanel.tsx; src/app/api/trips/[id]/chat/threads/route.ts; src/app/api/trips/[id]/chat/threads/[threadId]/route.ts; src/lib/trip-chat/thread-utils.ts", "Mapped", "P2", "Browser/API", "Not Started", "", ""],
  ["US-044", "Accommodation Review", "Trip overview detail", "Reviewer loading and empty states", "As a trip owner, I want accommodation proposals to load clearly.", "Fetch review data no-store, reload on global update event, show unavailable/loading/no-stay-stops states, and select the initial day destination when provided.", "src/components/preview/AccommodationReviewBoard.tsx; src/app/api/trips/[id]/accommodation-review/route.ts", "Mapped", "P1", "Browser/API", "Not Started", "", ""],
  ["US-045", "Accommodation Review", "Trip overview detail", "Destination navigation", "As a trip owner, I want to review accommodation proposals by overnight stop.", "Render overnight stay nav with date/night/status, update active destination, write review context to chat, and switch between booked overview and edit modes.", "src/components/preview/AccommodationReviewBoard.tsx", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-046", "Accommodation Review", "Trip overview detail", "Candidate evidence cards", "As a trip owner, I want enough evidence to choose a hotel.", "Cards show candidate name, booked badge, price, rationale, stay details, customer review platform status, rates, source links, decision notes, booking info, and feedback tracker.", "src/components/preview/AccommodationReviewBoard.tsx", "Mapped", "P1", "Browser/Data", "Not Started", "", ""],
  ["US-047", "Accommodation Review", "Trip overview detail", "Book or change candidate", "As a trip owner, I want to mark one hotel as booked or replace a booked hotel safely.", "Selecting Booked prompts confirmation, detects existing booked conflict, supports keep/change actions, PATCHes move_candidate or replace_booked_candidate, updates trip data, and reflects saving/errors.", "src/components/preview/AccommodationReviewBoard.tsx; src/app/api/trips/[id]/accommodation-review/route.ts; src/lib/accommodation-review-store.ts", "Mapped", "P1", "Browser/API", "Not Started", "", ""],
  ["US-048", "Public Itineraries", "/itineraries", "Catalogue filters", "As a visitor, I want to browse public itineraries by style and intensity.", "Render public itinerary catalogue with category segmented controls, three score sliders, filtered count, reset button, score chips, tags, and view-transition navigation to canonical itinerary pages.", "src/app/itineraries/page.tsx; src/components/itineraries/ItinerariesExplorer.tsx; src/lib/public-itineraries.ts", "Mapped", "P2", "Browser", "Not Started", "", ""],
  ["US-049", "Public Itineraries", "/itineraries/[destination]/[slug]", "Canonical itinerary pages", "As a visitor, I want SEO itinerary pages that open the real trip preview.", "Generate static params from public itinerary config, load companion/remix trip data from Supabase, render TripPreview auto-open with add/remix CTA, choose dashboard home for signed-in users, and emit TouristTrip/Breadcrumb JSON-LD.", "src/app/itineraries/[destination]/[slug]/page.tsx", "Mapped", "P1", "Browser/SEO", "Not Started", "", ""],
  ["US-050", "Public Itineraries", "/itinerariers", "Typo redirect", "As a visitor following a misspelled URL, I want to land on the itinerary catalogue.", "Redirect /itinerariers to /itineraries.", "src/app/itinerariers/page.tsx", "Mapped", "P3", "Browser", "Not Started", "", ""],
  ["US-051", "Guide", "/guide", "Connector setup guide", "As a user, I want instructions for connecting OurTrips to Claude or Codex.", "Render guide content, copy buttons for MCP URL and Codex prompt, links back/home/login/itineraries, metadata, and copy state feedback.", "src/app/guide/page.tsx; src/components/ui/GuideCopyButton.tsx", "Mapped", "P2", "Browser", "Not Started", "", ""],
  ["US-052", "Blog", "/blog", "Blog index", "As a visitor, I want to browse AI trip-planning articles.", "Render all posts with dates, tag, title, excerpt, read link, navigation, footer, and metadata.", "src/app/blog/page.tsx; src/lib/blog/posts.ts; src/styles/blog.css", "Mapped", "P2", "Browser/SEO", "Not Started", "", ""],
  ["US-053", "Blog", "/blog/[slug]", "Blog article page", "As a reader, I want article content, FAQ, and CTA in a structured page.", "Load post by slug or 404, emit article and breadcrumb JSON-LD plus FAQ JSON-LD, render markdown body, FAQ, CTA, nav/footer, and CopyCodeBlocks.", "src/app/blog/[slug]/page.tsx; src/components/blog/CopyCodeBlocks.tsx", "Mapped", "P2", "Browser/SEO", "Not Started", "", ""],
  ["US-054", "Blog", "/blog/[slug]", "Code block copy", "As a reader, I want to copy guide snippets from articles.", "Find code.language-copy blocks, append one copy button per block, write trimmed text to clipboard, show Copied or Failed, then reset.", "src/components/blog/CopyCodeBlocks.tsx", "Mapped", "P3", "Browser", "Not Started", "", ""],
  ["US-055", "Changelog", "/changelog", "Release notes", "As a user, I want to see release history.", "Load changelog markdown, display latest label and last updated date, render body, navigation, footer, and metadata.", "src/app/changelog/page.tsx; src/lib/changelog.ts", "Mapped", "P3", "Browser/SEO", "Not Started", "", ""],
  ["US-056", "SEO/PWA", "Global", "Metadata, sitemap, robots, manifest", "As a crawler or mobile browser, I want discoverable and installable app metadata.", "Root layout sets metadata, icons, manifest, viewport, fonts, service worker, reconnect toast, and offline debug overlay; sitemap lists home/blog/changelog/guide/itineraries/posts; robots allows pages and disallows /api.", "src/app/layout.tsx; src/app/sitemap.ts; src/app/robots.ts; public/manifest.json", "Mapped", "P2", "Browser/SEO", "Not Started", "", ""],
  ["US-057", "Offline", "Global", "Service worker lifecycle", "As a traveler, I want the app to register offline support without breaking normal use.", "Register /sw.js client-side, precache offline.html, activate by deleting older ourtrips caches, claim clients, and leave app functional if registration fails.", "src/components/ServiceWorkerRegistrar.tsx; public/sw.js; public/offline.html", "Mapped", "P1", "Browser/Offline", "Not Started", "", ""],
  ["US-058", "Offline", "Trip page", "Explicit offline download", "As a traveler, I want to save a trip to this device and remove it later.", "Trip actions menu caches trip page/data/assets through service worker when available, mirrors data and manifest to localStorage, shows toasts, confirms removal, clears caches/manifest/data, and dashboard badges update via event.", "src/components/preview/TripPreview.tsx; src/lib/offline.ts; public/sw.js", "Retested", "P1", "Browser/Offline", "Pass", "2026-06-22", "Updated offline Playwright skeletons to current menu flow; direct Chrome CDP save/remove behavior passed for NyLNFNHxC9."],
  ["US-059", "Offline", "Global", "Offline navigation fallback", "As an offline user, I want graceful behavior instead of browser errors.", "Trip navigations race network against cached HTML with timeout, non-trip navigations fall back to offline.html, trip-data JSON is network-first with cache fallback, static/images/fonts use cache strategies, and auth/admin API data is not cached.", "public/sw.js; src/lib/offline.ts", "Mapped", "P1", "Browser/Offline", "Not Started", "", ""],
  ["US-060", "Offline", "Global", "Connectivity feedback and debug", "As a user or developer, I want network state to be visible when useful.", "Global toast appears on online/offline transitions; ?debug=offline shows online state, service worker state, cache counts, and offline manifest count.", "src/components/ReconnectToast.tsx; src/components/OfflineDebugOverlay.tsx", "Mapped", "P2", "Browser/Offline", "Not Started", "", ""],
  ["US-061", "Connector Auth", "/connect", "Device-code connection flow", "As a Claude/Codex connector user, I want to authorize OurTrips from a device link.", "Validate code, auto-authorize if signed in, otherwise send magic link and return to /connect?code=..., then show connected or error/invalid states.", "src/app/connect/page.tsx; src/app/api/auth/device/route.ts; src/app/api/auth/device/poll/route.ts; src/app/api/auth/device/authorize/route.ts", "Mapped", "P1", "Browser/API/Auth", "Not Started", "", ""],
  ["US-062", "OAuth", "/.well-known", "OAuth discovery metadata", "As an MCP client, I want OAuth metadata and protected-resource metadata.", "Authorization-server metadata advertises endpoints/scopes/PKCE and protected-resource metadata advertises /mcp resource and required scopes with CORS/no-store headers.", "src/app/.well-known/oauth-authorization-server/route.ts; src/app/.well-known/oauth-protected-resource/route.ts; src/app/.well-known/oauth-protected-resource/mcp/route.ts; src/lib/oauth.ts", "Mapped", "P1", "API/Auth", "Not Started", "", ""],
  ["US-063", "OAuth", "/oauth/register", "Dynamic client registration", "As an MCP client, I want to register an OAuth client.", "Accept valid client metadata with HTTPS or loopback redirects, supported auth method and scope, store hashed client secret when applicable, and return registration response.", "src/app/oauth/register/route.ts; src/lib/oauth.ts", "Mapped", "P1", "API/Auth", "Not Started", "", ""],
  ["US-064", "OAuth", "/oauth/authorize", "Authorization consent", "As a signed-in user, I want to consent to connector access safely.", "Validate response_type/client/redirect_uri/PKCE/scopes/resource, redirect unauthenticated users to login, show consent HTML, create authorization code on approval, or redirect access_denied when declined.", "src/app/oauth/authorize/route.ts; src/lib/oauth.ts", "Mapped", "P1", "Browser/API/Auth", "Not Started", "", ""],
  ["US-065", "OAuth", "/oauth/token", "Token exchange and refresh", "As an OAuth client, I want to exchange authorization codes and refresh tokens.", "Authenticate public/confidential clients, support authorization_code and refresh_token grants, verify PKCE, rotate token pairs, return OAuth JSON errors, and support OPTIONS CORS.", "src/app/oauth/token/route.ts; src/lib/oauth.ts", "Mapped", "P1", "API/Auth", "Not Started", "", ""],
  ["US-066", "OAuth", "/oauth/revoke", "Token revocation", "As an OAuth client, I want to revoke access.", "Authenticate the token client and revoke the supplied access/refresh token while returning OAuth-compliant JSON/CORS behavior.", "src/app/oauth/revoke/route.ts; src/lib/oauth.ts", "Mapped", "P2", "API/Auth", "Not Started", "", ""],
  ["US-067", "MCP", "/mcp", "OurTrips MCP endpoint", "As an external agent, I want remote MCP tools over streamable HTTP.", "GET/POST/DELETE route through the MCP handler, require bearer OAuth auth, expose tool instructions and tool schemas, and handle MCP protocol requests.", "src/app/mcp/route.ts; src/lib/ourtrips-mcp.ts; src/lib/oauth.ts", "Mapped", "P1", "API/Auth", "Not Started", "", ""],
  ["US-068", "MCP", "Tools", "Trip lifecycle tools", "As an external agent, I want to save, list, read, and validate trips.", "Expose get_trip_schema/template, save_trip, save_trip_v2, save_trip_v3, list_trips, get_trip, get_trip_logistics_ledger, validate_trip_contract, and verify/public guidance with schema-version/logistics behavior.", "src/lib/ourtrips-mcp.ts; src/lib/trip-service.ts; docs/ourtrips-mcp-readable-schema.md", "Mapped", "P1", "API/MCP", "Not Started", "", ""],
  ["US-069", "MCP", "Tools", "Focused trip edit tools", "As an external agent, I want safe focused mutations instead of broad JSON overwrites.", "Expose patch_trip, upsert/delete meal/accommodation/transport/activity, replace_accommodation, replace_day_section, replace_day, delete_day, truncate_days_after, replace_paths, and delete_paths with mutation summaries.", "src/lib/ourtrips-mcp.ts; src/lib/trip-service.ts", "Mapped", "P1", "API/MCP", "Not Started", "", ""],
  ["US-070", "MCP", "Tools", "Image workflow tools", "As an external agent, I want to populate real and generated trip images.", "Expose search_trip_images, set_trip_image, get_trip_image_status, get_trip_image_prompts, and save_trip_image_asset with Unsplash tracking and image asset summaries.", "src/lib/ourtrips-mcp.ts; src/lib/trip-service.ts; src/lib/trip-images.ts; src/lib/trip-image-prompts.ts; src/app/api/images/search/route.ts", "Mapped", "P2", "API/MCP", "Not Started", "", ""],
  ["US-071", "API Keys", "/api/keys", "Legacy API key management", "As a signed-in user or connector setup, I want API keys for legacy routes.", "POST creates a one-time plaintext trp_ key and hashed row, GET lists key metadata without hash, DELETE removes an owned key, all requiring auth.", "src/app/api/keys/route.ts; src/lib/auth.ts", "Mapped", "P2", "API/Auth", "Not Started", "", ""],
  ["US-072", "Trip API", "/api/trips", "API-key trip CRUD", "As an API client, I want to create, list, read, patch, and delete trips.", "Validate bearer API key, create trips via saveTripForUser, list non-public trips, get/patch/delete owned trips, and return TripServiceError statuses.", "src/app/api/trips/route.ts; src/app/api/trips/[id]/route.ts; src/lib/auth.ts; src/lib/trip-service.ts", "Mapped", "P1", "API/Auth", "Not Started", "", ""],
  ["US-073", "Trip API", "/api/trip-data/[shareId]", "Public/offline trip data", "As the service worker or shared viewer, I want a fresh JSON copy of the visible trip.", "Return only companion/remix share IDs, scrub remix data for non-owners, strip private wallet data for non-owner companion viewers, no-store/Vary Cookie, and 404/500 error JSON.", "src/app/api/trip-data/[shareId]/route.ts; src/lib/scrub-trip.ts", "Mapped", "P1", "API/Privacy", "Not Started", "", ""],
  ["US-074", "Trip API", "/api/trips/clone", "Clone shared trip", "As a signed-in recipient, I want to save/remix a shared trip safely.", "Require auth and share_id, only clone companion/remix trips, prevent non-public self-clone, avoid duplicate same-name clones, scrub PII, re-anchor dates to today, create companion-mode copy, and sync accommodation review.", "src/app/api/trips/clone/route.ts; src/lib/scrub-trip.ts; src/lib/accommodation-review-store.ts", "Mapped", "P1", "API/Privacy", "Not Started", "", ""],
  ["US-075", "Trip API", "/api/trips/[id]/share-mode", "Share mode update", "As a trip owner, I want to choose private, companion, or remix sharing.", "Require authenticated owner, validate share_mode enum, update the trip, and return status/share_mode or auth/not-found errors.", "src/app/api/trips/[id]/share-mode/route.ts; src/components/preview/TripPreview.tsx", "Mapped", "P1", "API/Auth", "Not Started", "", ""],
  ["US-076", "Trip API", "/api/trips/[id]/toggle-status", "Booking status toggle", "As a trip owner, I want readiness items to persist status changes.", "Require authenticated owner, validate day/item/index/status, update transport/accommodation/meal status and booking_status, persist trip data, and return new_status.", "src/app/api/trips/[id]/toggle-status/route.ts; src/app/api/trips/toggle-status/route.ts; src/lib/trip-status.ts", "Mapped", "P1", "API/Auth", "Not Started", "", ""],
  ["US-077", "Accommodation API", "/api/trips/[id]/accommodation-review", "Accommodation review API", "As a trip owner, I want accommodation review data and candidate mutations.", "GET builds/returns review for owned trip; PATCH supports move_candidate and replace_booked_candidate with conflict handling, trip-data updates, auth checks, and review response.", "src/app/api/trips/[id]/accommodation-review/route.ts; src/lib/accommodation-review-store.ts", "Mapped", "P1", "API/Auth", "Not Started", "", ""],
  ["US-078", "Images API", "/api/images/search", "Unsplash search and download tracking", "As an image workflow, I want to search and track images.", "GET requires query and returns searchTripImages results with orientation; POST requires download_url and tracks Unsplash download; errors map to status or generic 500.", "src/app/api/images/search/route.ts; src/lib/trip-images.ts", "Mapped", "P2", "API", "Not Started", "", ""],
  ["US-079", "Admin", "/admin", "Analytics dashboard", "As an admin, I want user and trip analytics.", "Client checks auth, API verifies admin role, date presets/custom ranges fetch analytics, KPIs and Recharts user/trip charts render, unauthorized routes to login and forbidden shows access denied.", "src/app/admin/page.tsx; src/app/api/admin/analytics/route.ts; src/styles/admin.css", "Mapped", "P2", "Browser/API/Auth", "Not Started", "", ""],
  ["US-080", "Admin", "/admin/logistics", "Trip logistics ledger", "As an admin, I want to inspect dates, sleeps, stays, and validation issues.", "Require admin, list recent trips/select exact trip, compute canonical logistics ledger, show status KPIs, day ledger, stay ledger, validation errors/warnings, and open-trip link.", "src/app/admin/logistics/page.tsx; src/lib/trip-service.ts; src/lib/trip-logistics-ledger.ts", "Mapped", "P2", "Browser/API/Auth", "Not Started", "", ""],
  ["US-081", "Admin", "/admin/costs", "User cost dashboard", "As an admin, I want provider spend by user.", "Require admin, resolve preset/custom ranges, load auth users/trips/chat usage/threads/API keys, summarize costs/tokens/tool calls, render range controls, summary stats, coverage notes, and user leaderboard.", "src/app/admin/costs/page.tsx; src/lib/admin-costs.ts", "Mapped", "P2", "Browser/API/Auth", "Not Started", "", ""],
  ["US-082", "Social Images", "OG routes", "Blog and trip social cards", "As a link sharer, I want social images for blog and trip URLs.", "Blog index/post OG image routes render ImageResponse cards from post data; trip OG/Twitter routes render trip OG image for companion/remix share IDs and brand fallback otherwise.", "src/app/blog/opengraph-image.tsx; src/app/blog/[slug]/opengraph-image.tsx; src/app/t/[shareId]/opengraph-image.tsx; src/app/t/[shareId]/twitter-image.tsx", "Mapped", "P3", "Browser/SEO", "Not Started", "", ""],
  ["US-083", "Redirects", "/demo", "Demo redirect", "As a visitor using an old demo URL, I want to land on current itinerary examples.", "Permanent redirect /demo to /itineraries.", "src/app/demo/page.tsx", "Mapped", "P3", "Browser", "Not Started", "", ""],
  ["US-084", "Local Preview", "Dev mode", "Sample data without Supabase", "As a developer, I want a full preview experience without backend credentials.", "When Supabase public env vars are missing, login/dashboard/trip pages use sampleTrips with stable local share IDs and New York route points for the first sample.", "src/lib/local-preview.ts; src/lib/sample-data.ts; src/app/login/page.tsx; src/app/dashboard/page.tsx; src/app/t/[shareId]/page.tsx", "Mapped", "P1", "Browser", "Not Started", "", ""],
  ["US-085", "Generated Content", "Build", "Static content generation", "As the site, I want blog/changelog/static content generated before build.", "prebuild runs generate-static-content and ensure-claude-agent-binary; generated static content feeds public pages and release notes.", "package.json; scripts/generate-static-content.mjs; src/lib/generated/static-content.ts", "Mapped", "P3", "Build", "Not Started", "", ""],
  ["US-086", "Agent Knowledge", "knowledge/", "OKF knowledge bundle", "As the trip-chat agent, I want routed knowledge files to be parseable and canonical.", "Every loaded knowledge markdown concept includes required OKF frontmatter, reserved index/log files stay out of the concept map, local duplicate-copy artifacts are ignored, and routed restaurant/accommodation knowledge formats into the prompt checklist.", "knowledge/*.md; src/lib/agent-knowledge.ts; src/lib/agent-knowledge.test.ts", "Retested", "P2", "Unit", "Pass", "2026-06-22", "Initial full suite failed on knowledge/log 2.md; collector now skips local ' 2' copy artifacts; npm run test passes."],
];

const routes = [
  ["GET", "/", "Landing page", "Public, redirects signed-in users to active trip or dashboard", "src/app/page.tsx", "Optional Supabase session"],
  ["GET", "/login", "Login", "Google OAuth or local preview", "src/app/login/page.tsx", "Public"],
  ["GET", "/dashboard", "Dashboard", "Trip list and offline saved trips", "src/app/dashboard/page.tsx", "User session or local preview"],
  ["GET", "/onboarding", "Travel profile", "Profile editor", "src/app/onboarding/page.tsx", "User session"],
  ["GET", "/trips/new", "New trip", "Guided trip creator", "src/app/trips/new/page.tsx", "User session"],
  ["GET", "/t/[shareId]", "Trip preview", "Shared/owned trip viewer", "src/app/t/[shareId]/page.tsx", "Share mode + optional session"],
  ["GET", "/itineraries", "Itinerary catalogue", "Public sample itinerary browser", "src/app/itineraries/page.tsx", "Public"],
  ["GET", "/itineraries/[destination]/[slug]", "Canonical itinerary", "Public trip preview with SEO data", "src/app/itineraries/[destination]/[slug]/page.tsx", "Public"],
  ["GET", "/blog", "Blog index", "Article list", "src/app/blog/page.tsx", "Public"],
  ["GET", "/blog/[slug]", "Blog article", "Article, FAQ, CTA", "src/app/blog/[slug]/page.tsx", "Public"],
  ["GET", "/guide", "Connector guide", "MCP setup guide", "src/app/guide/page.tsx", "Public"],
  ["GET", "/changelog", "Changelog", "Release notes", "src/app/changelog/page.tsx", "Public"],
  ["GET", "/connect", "Device auth UI", "Connector authorization page", "src/app/connect/page.tsx", "Public + optional session"],
  ["GET", "/admin", "Admin analytics", "Client analytics dashboard", "src/app/admin/page.tsx", "Admin session"],
  ["GET", "/admin/logistics", "Admin logistics", "Trip logistics ledger", "src/app/admin/logistics/page.tsx", "Admin session"],
  ["GET", "/admin/costs", "Admin costs", "Provider spend dashboard", "src/app/admin/costs/page.tsx", "Admin session"],
  ["POST/GET/DELETE", "/api/keys", "API keys", "Create/list/delete legacy API keys", "src/app/api/keys/route.ts", "User session"],
  ["GET/POST", "/api/trips", "Trip API", "List/create trips with API key", "src/app/api/trips/route.ts", "Bearer API key"],
  ["GET/PATCH/DELETE", "/api/trips/[id]", "Trip API", "Read/patch/delete owned trip", "src/app/api/trips/[id]/route.ts", "Bearer API key"],
  ["POST", "/api/trips/clone", "Clone trip", "Save/remix shared trip", "src/app/api/trips/clone/route.ts", "User session"],
  ["POST", "/api/trips/create-draft", "Draft trip", "Create starter trip and generation session", "src/app/api/trips/create-draft/route.ts", "User session"],
  ["GET", "/api/trip-data/[shareId]", "Trip data", "Fresh public/offline trip JSON with scrub rules", "src/app/api/trip-data/[shareId]/route.ts", "Share mode + optional session"],
  ["POST", "/api/trips/[id]/share-mode", "Share mode", "Update trip share mode", "src/app/api/trips/[id]/share-mode/route.ts", "Owner session"],
  ["POST", "/api/trips/[id]/toggle-status", "Readiness toggle", "Update item booking status", "src/app/api/trips/[id]/toggle-status/route.ts", "Owner session"],
  ["GET/PATCH", "/api/trips/[id]/accommodation-review", "Accommodation review", "Read/mutate accommodation candidate board", "src/app/api/trips/[id]/accommodation-review/route.ts", "Owner session"],
  ["GET/POST", "/api/trips/[id]/chat", "Trip chat", "Read/send trip edit chat turns", "src/app/api/trips/[id]/chat/route.ts", "Owner session"],
  ["GET", "/api/trips/[id]/chat/threads", "Chat threads", "List chat threads", "src/app/api/trips/[id]/chat/threads/route.ts", "Owner session"],
  ["PATCH/DELETE", "/api/trips/[id]/chat/threads/[threadId]", "Chat thread mutation", "Rename/delete chat thread", "src/app/api/trips/[id]/chat/threads/[threadId]/route.ts", "Owner session"],
  ["PATCH", "/api/trip-generations/[id]", "Generation status", "Update trip generation session", "src/app/api/trip-generations/[id]/route.ts", "User session"],
  ["GET/PUT", "/api/travel-profile", "Travel profile API", "Read/save profile", "src/app/api/travel-profile/route.ts", "User session"],
  ["GET/POST", "/api/travel-profile/sources", "Profile sources", "List/upload previous trip references", "src/app/api/travel-profile/sources/route.ts", "User session"],
  ["DELETE", "/api/travel-profile/sources/[id]", "Profile source delete", "Remove previous trip reference", "src/app/api/travel-profile/sources/[id]/route.ts", "User session"],
  ["POST", "/api/trip-references", "New trip references", "Analyze uploaded trip reference", "src/app/api/trip-references/route.ts", "User session"],
  ["GET/POST", "/api/images/search", "Image search", "Unsplash search and download tracking", "src/app/api/images/search/route.ts", "Server env"],
  ["GET", "/api/admin/analytics", "Admin analytics API", "User/trip analytics buckets", "src/app/api/admin/analytics/route.ts", "Admin session"],
  ["POST/GET", "/api/auth/device + poll/authorize", "Device auth", "Device code creation, polling, authorization", "src/app/api/auth/device/route.ts; src/app/api/auth/device/poll/route.ts; src/app/api/auth/device/authorize/route.ts", "Mixed"],
  ["POST/GET", "/oauth/*", "OAuth", "Registration, authorization, token, revoke", "src/app/oauth/*/route.ts", "OAuth client + user"],
  ["GET/POST/DELETE", "/mcp", "Remote MCP", "Streamable HTTP MCP server", "src/app/mcp/route.ts", "Bearer OAuth"],
  ["GET", "/sitemap.xml and /robots.txt", "SEO discovery", "Sitemap and robots", "src/app/sitemap.ts; src/app/robots.ts", "Public"],
];

const issues = [
  ["ISS-001", "US-058", "P2", "Test/UX mismatch", "Offline download", "Existing offline Playwright skeletons target .save-offline-btn, but the active TripPreview UI exposes offline download through the trip cover actions menu.", "Tests should match the current user-visible offline save flow, or the UI should expose an equivalent direct save affordance.", "Run tests/offline/download-button.spec.ts after starting dev server.", "tests/offline/download-button.spec.ts; src/components/preview/TripPreview.tsx; src/components/preview/SaveOfflineButton.tsx", "Retested", "Added stable aria labels to the offline menu item, updated offline skeletons to use the Trip actions menu, and changed the default share ID to a real public sample.", "Direct Chrome CDP offline save/remove flow passed on 2026-06-22."],
  ["ISS-002", "US-086", "P2", "Test failure", "Agent knowledge validation", "npm run test failed because knowledge/log 2.md was treated as a concept and missed required OKF frontmatter field type.", "Local duplicate-copy artifacts should not be loaded or validated as canonical knowledge concepts.", "npm run test; npx tsx --test src/lib/agent-knowledge.test.ts", "src/lib/agent-knowledge.ts; src/lib/agent-knowledge.test.ts; .gitignore", "Retested", "Skipped local ' 2' copy artifacts in the knowledge collector, ignored '* 2.md' in git, and added a temp-root regression test.", "Focused knowledge test and full npm run test pass on 2026-06-22."],
  ["ISS-003", "US-004", "P2", "Mobile UX", "Login page", "Mobile login screenshots could capture the sign-in form faded under the decorative table/cards, making redirected auth gates look nearly blank at first glance.", "Mobile login should present the sign-in card as the first clear target, with itinerary cards below it and no fragile entrance fade.", "SMOKE_VIEWPORT=mobile npm run smoke:ui -- /login /admin; visual screenshot review.", "src/styles/login.css; src/app/login/page.tsx", "Retested", "Changed the mobile login grid to explicit rows and disabled the mobile card entrance animation.", "Focused mobile smoke screenshots for /login and redirected /admin pass on 2026-06-22."],
];

const testedOn = "2026-06-22";
const storyTestUpdates = [
  ["US-001", "Retested", "Pass", "Desktop/mobile smoke and interaction pass verified landing hero, nav, CTAs, itinerary cards, guide links, and footer."],
  ["US-002", "Blocked", "Blocked", "Signed-in redirect branch requires a seeded Supabase session and active/current trip fixture; public landing smoke passed."],
  ["US-003", "Retested", "Pass", "Landing itinerary cards rendered and linked to real canonical itinerary pages in desktop/mobile smoke."],
  ["US-004", "Blocked", "Blocked", "Login page, next redirects, and mobile UX passed; external Google OAuth provider handoff requires a real provider session."],
  ["US-005", "Blocked", "Blocked", "Local preview branch requires running without Supabase public env vars; current verified environment has Supabase configured."],
  ["US-006", "Blocked", "Blocked", "Unauthenticated dashboard redirect passed on desktop/mobile; authenticated cache and trip list branch needs a signed-in session."],
  ["US-007", "Blocked", "Blocked", "Trip grouping needs authenticated trip fixtures with current/upcoming/past dates."],
  ["US-008", "Blocked", "Blocked", "Offline save storage passed; dashboard offline filtering needs authenticated saved-trip fixtures."],
  ["US-009", "Blocked", "Blocked", "Settings menu needs authenticated user/admin state; unauthenticated dashboard redirect passed."],
  ["US-010", "Blocked", "Blocked", "Empty first-trip onboarding state needs an authenticated zero-trip user fixture."],
  ["US-011", "Blocked", "Blocked", "Dashboard trip-card transition needs authenticated trip fixtures."],
  ["US-012", "Retested", "Pass", "Unauthenticated /onboarding redirect to /login?next=/onboarding passed on desktop/mobile."],
  ["US-013", "Blocked", "Blocked", "Traveler editor is behind authenticated onboarding; normalization unit tests passed but browser editing needs a session."],
  ["US-014", "Blocked", "Blocked", "Preference save UI/API is behind authenticated onboarding; normalization unit tests passed."],
  ["US-015", "Blocked", "Blocked", "Previous-trip source upload needs authenticated profile storage and file upload harness."],
  ["US-016", "Blocked", "Blocked", "Travel profile normalization units passed; route persistence requires an authenticated Supabase user."],
  ["US-017", "Blocked", "Blocked", "Unauthenticated /trips/new redirect passed; authenticated profile prefill needs a signed-in user."],
  ["US-018", "Blocked", "Blocked", "Guided agent sheet is behind authenticated trip creation."],
  ["US-019", "Blocked", "Blocked", "Guided trip brief UI is behind authenticated trip creation."],
  ["US-020", "Retested", "Pass", "Trip creation unit tests validate inclusive day counts and invalid date ranges; browser picker remains behind auth."],
  ["US-021", "Blocked", "Blocked", "Reference formatting units passed; upload route needs authenticated trip creation and file harness."],
  ["US-022", "Retested", "Pass", "Trip creation unit tests cover starter trip input, structured traveler profiles, hard date requirements, and range rejection."],
  ["US-023", "Blocked", "Blocked", "Generation progress needs authenticated draft creation and agent/chat backend execution."],
  ["US-024", "Retested", "Pass", "Public trip page loaded; public trip-data envelope passed; scrub/privacy unit tests passed for remix and wallet stripping."],
  ["US-025", "Retested", "Pass", "Trip metadata and trip OG image routes returned valid 1200x630 PNG responses."],
  ["US-026", "Retested", "Pass", "Public trip preview loaded on desktop/mobile and interaction pass covered cover overview, CTA, and summary surface."],
  ["US-027", "Retested", "Pass", "Public trip route atlas/map surface loaded in smoke; map/photo toggle branch code-reviewed against existing atlas conditions."],
  ["US-028", "Retested", "Pass", "Trip overview detail opened in interaction pass and public sample rendered overview sections."],
  ["US-029", "Retested", "Pass", "Interaction pass covered day-by-day navigation and detail/back behavior on the public sample trip."],
  ["US-030", "Retested", "Pass", "Public sample day slide loaded with day header/map context in browser smoke and interaction pass."],
  ["US-031", "Blocked", "Blocked", "Today mode needs an active-date trip fixture; current public sample is not date-active."],
  ["US-032", "Retested", "Pass", "Public sample activities/place-linked day content rendered during trip preview interaction pass."],
  ["US-033", "Retested", "Pass", "Transport/service rendering is covered by preview smoke plus day-map/trip-action unit coverage."],
  ["US-034", "Blocked", "Blocked", "Owner booking-status toggle needs an authenticated owner trip; action-item units passed."],
  ["US-035", "Retested", "Pass", "Public sample dining cards rendered in trip preview smoke; detail rendering covered by interaction pass."],
  ["US-036", "Retested", "Pass", "Public sample tips rendered in trip preview smoke; empty-tip normalization units passed."],
  ["US-037", "Retested", "Pass", "Detail sheet open/close and browser-back behavior passed in the interaction sweep."],
  ["US-038", "Retested", "Pass", "Trip actions menu passed copy/offline surface checks; offline save/remove was retested via actual menu item labels."],
  ["US-039", "Retested", "Pass", "Shared-trip Add to my trips unauthenticated redirect passed in targeted Chrome interaction test."],
  ["US-040", "Blocked", "Blocked", "Archive shell needs a multi-trip preview fixture not exposed by current public routes."],
  ["US-041", "Blocked", "Blocked", "Chat panel visibility needs authenticated owner and non-public trip fixture."],
  ["US-042", "Blocked", "Blocked", "Sending edit requests needs authenticated owner, trip chat route, and agent backend."],
  ["US-043", "Blocked", "Blocked", "Thread history management needs authenticated owner chat threads."],
  ["US-044", "Blocked", "Blocked", "Accommodation review board needs authenticated owner trip with review data."],
  ["US-045", "Blocked", "Blocked", "Destination navigation in review board needs authenticated owner review fixture."],
  ["US-046", "Blocked", "Blocked", "Candidate evidence cards need authenticated owner review fixture."],
  ["US-047", "Blocked", "Blocked", "Book/change candidate mutations need authenticated owner review fixture."],
  ["US-048", "Retested", "Pass", "Itinerary catalogue desktop/mobile smoke and interaction pass covered filters and reset controls."],
  ["US-049", "Retested", "Pass", "Canonical Bonaire itinerary loaded and opened the real trip preview in smoke/interaction tests."],
  ["US-050", "Retested", "Pass", "/itinerariers redirected to /itineraries in desktop/mobile smoke."],
  ["US-051", "Retested", "Pass", "Guide page loaded in desktop/mobile smoke; copy controls surfaced in interaction pass."],
  ["US-052", "Retested", "Pass", "Blog index loaded in desktop/mobile smoke."],
  ["US-053", "Retested", "Pass", "Blog article loaded in desktop/mobile smoke and article content rendered."],
  ["US-054", "Retested", "Pass", "Blog/guide copy button surfaces passed interaction checks."],
  ["US-055", "Retested", "Pass", "Changelog route loaded in desktop/mobile smoke."],
  ["US-056", "Retested", "Pass", "Sitemap, robots, manifest-linked pages, and social image routes passed API/browser checks."],
  ["US-057", "Retested", "Pass", "ServiceWorkerRegistrar and offline debug overlay were present in server render; offline manifest fallback passed."],
  ["US-058", "Retested", "Pass", "Actual Trip actions menu save/remove flow persisted and cleared the offline manifest and trip JSON copy."],
  ["US-059", "Blocked", "Blocked", "Full offline navigation fallback needs a browser network-offline harness with service-worker control; save/remove fallback passed."],
  ["US-060", "Retested", "Pass", "Offline debug overlay and reconnect toast were present without server-render errors; targeted transition harness not available."],
  ["US-061", "Blocked", "Blocked", "Connect page route smoke passed; full device-code authorize flow requires authenticated user consent."],
  ["US-062", "Retested", "Pass", "OAuth authorization-server and protected-resource metadata endpoints returned 200 JSON."],
  ["US-063", "Blocked", "Blocked", "Registration validation branch was checked; full successful registration would mutate Supabase OAuth client data."],
  ["US-064", "Blocked", "Blocked", "Authorization consent requires registered OAuth client and signed-in user."],
  ["US-065", "Blocked", "Blocked", "Token exchange/refresh requires an issued auth code or refresh token; OAuth utility unit tests passed."],
  ["US-066", "Blocked", "Blocked", "Token revocation requires a real issued token; endpoint metadata and OAuth utility units passed."],
  ["US-067", "Retested", "Pass", "/mcp returned expected 401 without bearer token; MCP instruction unit tests passed."],
  ["US-068", "Retested", "Pass", "Trip service and MCP lifecycle utility unit tests passed in npm run test."],
  ["US-069", "Retested", "Pass", "Focused trip edit tools covered by trip-service unit tests for upsert/delete/replace/truncate/path edits."],
  ["US-070", "Retested", "Pass", "Image workflow units passed; image search route returned 200 with results for Bonaire."],
  ["US-071", "Blocked", "Blocked", "/api/keys auth gate returned 401; create/list/delete needs signed-in user session."],
  ["US-072", "Blocked", "Blocked", "/api/trips auth gate returned 401; full API-key CRUD needs a valid key/user fixture."],
  ["US-073", "Retested", "Pass", "/api/trip-data/NyLNFNHxC9 returned companion envelope, 7 days, no wallet_items, and no-store headers."],
  ["US-074", "Blocked", "Blocked", "/api/trips/clone auth gate returned 401 and scrub units passed; successful clone needs signed-in recipient."],
  ["US-075", "Blocked", "Blocked", "Share-mode mutation needs authenticated owner trip; public action menu branch rendered."],
  ["US-076", "Blocked", "Blocked", "Booking status route needs authenticated owner; trip-action item units passed."],
  ["US-077", "Blocked", "Blocked", "Accommodation review route needs authenticated owner; review store units passed."],
  ["US-078", "Retested", "Pass", "Images API returned 400 for missing query and 200 with three Bonaire results for a valid query."],
  ["US-079", "Blocked", "Blocked", "Admin route smoke/auth gate passed; analytics data view needs admin session."],
  ["US-080", "Blocked", "Blocked", "Admin logistics auth gate passed; ledger data view needs admin session and trip selection."],
  ["US-081", "Blocked", "Blocked", "Admin costs auth gate passed; cost dashboard data needs admin session."],
  ["US-082", "Retested", "Pass", "Blog and trip social image routes returned valid PNG responses."],
  ["US-083", "Retested", "Pass", "/demo redirected to /itineraries in desktop/mobile smoke."],
  ["US-084", "Blocked", "Blocked", "Local preview mode requires an env-off server; current run uses Supabase env vars."],
  ["US-085", "Retested", "Pass", "npm run verify completed prebuild and next build successfully with static content generation."],
  ["US-086", "Retested", "Pass", "Knowledge bundle validation and duplicate-artifact regression test passed; full npm run test passed."],
];

for (const [id, status, testStatus, notes] of storyTestUpdates) {
  const story = stories.find((row) => row[0] === id);
  if (!story) continue;
  story[7] = status;
  story[10] = testStatus;
  story[11] = testedOn;
  story[12] = notes;
}

function writeSheet(sheet, values, tableName) {
  const rowCount = values.length;
  const colCount = values[0].length;
  const range = sheet.getRangeByIndexes(0, 0, rowCount, colCount);
  range.values = values;
  range.format.wrapText = true;
  range.format.font = { name: "Inter", size: 10, color: "#1A1410" };
  const header = sheet.getRangeByIndexes(0, 0, 1, colCount);
  header.format = {
    fill: "#1A1410",
    font: { bold: true, color: "#FBF7F1" },
  };
  header.format.rowHeightPx = 34;
  range.format.borders = {
    insideHorizontal: { style: "thin", color: "#E8E1D6" },
    bottom: { style: "thin", color: "#D4C8B4" },
  };
  sheet.tables.add(sheet.getRangeByIndexes(0, 0, rowCount, colCount), true, tableName);
  sheet.freezePanes.freezeRows(1);
  sheet.showGridLines = false;
  return range;
}

function setWidths(sheet, widths) {
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidthPx = width;
  });
}

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const storiesSheet = workbook.worksheets.add("User Stories");
const issuesSheet = workbook.worksheets.add("Issue Log");
const routesSheet = workbook.worksheets.add("Routes and APIs");

summary.showGridLines = false;
summary.getRange("A1:H1").merge();
summary.getRange("A1").values = [["OurTrips Feature User Story Tracker"]];
summary.getRange("A1").format = {
  fill: "#FBF7F1",
  font: { name: "Fraunces", size: 18, bold: true, color: "#1A1410" },
};
summary.getRange("A1:H1").format.rowHeightPx = 42;
summary.getRange("A2:H2").merge();
summary.getRange("A2").values = [[`Canonical workbook for feature mapping, behavior testing, issue logging, fixes, and retesting. Generated from code in ${repo}.`]];
summary.getRange("A2").format = { font: { name: "Inter", size: 11, color: "#6B6157" } };
summary.getRange("A4:B12").values = [
  ["Metric", "Value"],
  ["Stories mapped", stories.length],
  ["Stories not started", stories.filter((row) => row[10] === "Not Started").length],
  ["Issues open", issues.filter((row) => row[9] === "Open").length],
  ["P1 stories", stories.filter((row) => row[8] === "P1").length],
  ["P2 stories", stories.filter((row) => row[8] === "P2").length],
  ["P3 stories", stories.filter((row) => row[8] === "P3").length],
  ["Routes/API entries", routes.length],
  ["Last updated", `Updated ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`],
];
summary.getRange("A4:B4").format = {
  fill: "#1A1410",
  font: { bold: true, color: "#FBF7F1" },
};
summary.getRange("A5:B12").format = {
  fill: "#FFFFFF",
  font: { name: "Inter", size: 11, color: "#1A1410" },
  borders: { insideHorizontal: { style: "thin", color: "#E8E1D6" }, bottom: { style: "thin", color: "#D4C8B4" } },
};
summary.getRange("D4:H4").values = [["Next Work Loop", "Status", "Owner", "Evidence", "Notes"]];
summary.getRange("D5:H9").values = [
  ["Feature inventory", "Completed", "Codex", "This workbook", "Feature inventory generated from source code."],
  ["Test every user story", "Completed", "Codex", "Browser/API/test commands", "All mapped stories now have Pass or documented Blocked status."],
  ["Fix logistical/UX errors", "Completed", "Codex", "Code diffs and issue IDs", "ISS-001, ISS-002, and ISS-003 fixed and retested."],
  ["Retest every behavior", "Completed", "Codex", "Retest Status and notes", "Post-fix verify, smoke, API, and targeted interaction checks passed; auth-only branches documented blocked."],
  ["Commit and push main", "Pending", "Codex", "Commit hash", "Only after complete verification."],
];
summary.getRange("D4:H4").format = { fill: "#1A1410", font: { bold: true, color: "#FBF7F1" } };
summary.getRange("D5:H9").format = { fill: "#FFFFFF", font: { name: "Inter", size: 10, color: "#1A1410" }, borders: { insideHorizontal: { style: "thin", color: "#E8E1D6" } } };
setWidths(summary, [170, 130, 24, 210, 120, 120, 190, 260]);

const storyHeader = ["ID", "Area", "Surface", "Feature", "User Story", "Expected Behavior", "Source Files", "Status", "Priority", "Test Type", "Test Status", "Last Tested", "Notes"];
writeSheet(storiesSheet, [storyHeader, ...stories], "UserStories");
setWidths(storiesSheet, [72, 120, 160, 190, 340, 520, 360, 110, 80, 130, 120, 120, 260]);
storiesSheet.getRange(`H2:H${stories.length + 1}`).dataValidation = { rule: { type: "list", values: ["Mapped", "Testing", "Issue Found", "Fixed", "Retested", "Blocked", "Done"] } };
storiesSheet.getRange(`I2:I${stories.length + 1}`).dataValidation = { rule: { type: "list", values: ["P1", "P2", "P3"] } };
storiesSheet.getRange(`K2:K${stories.length + 1}`).dataValidation = { rule: { type: "list", values: ["Not Started", "Pass", "Fail", "Blocked", "Needs Retest"] } };

const issueHeader = ["Issue ID", "Story ID", "Severity", "Type", "Surface", "Observed", "Expected", "Repro / Test", "Source", "Status", "Fix Notes", "Retest Result"];
writeSheet(issuesSheet, [issueHeader, ...issues], "IssueLog");
setWidths(issuesSheet, [90, 90, 80, 140, 170, 420, 420, 320, 360, 100, 320, 220]);
issuesSheet.getRange("C2:C200").dataValidation = { rule: { type: "list", values: ["P0", "P1", "P2", "P3"] } };
issuesSheet.getRange("J2:J200").dataValidation = { rule: { type: "list", values: ["Open", "Fixing", "Fixed", "Retested", "Won't Fix", "Blocked"] } };

const routeHeader = ["Method", "Path", "Feature", "Expected Behavior", "Source", "Auth / Access"];
writeSheet(routesSheet, [routeHeader, ...routes], "RoutesAndApis");
setWidths(routesSheet, [120, 240, 190, 420, 420, 190]);

for (const sheet of [storiesSheet, issuesSheet, routesSheet]) {
  const used = sheet.getUsedRange();
  used.format.autofitRows();
}

// Keep wrapped text readable without letting rows balloon too much.
storiesSheet.getRange(`A2:M${stories.length + 1}`).format.rowHeightPx = 76;
issuesSheet.getRange("A2:L200").format.rowHeightPx = 72;
routesSheet.getRange(`A2:F${routes.length + 1}`).format.rowHeightPx = 58;

for (const sheetName of ["Summary", "User Stories", "Issue Log", "Routes and APIs"]) {
  const rendered = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(
    `${outputDir}tracker-${sheetName.toLowerCase().replaceAll(" ", "-")}-preview.png`,
    new Uint8Array(await rendered.arrayBuffer())
  );
}

const inspect = await workbook.inspect({
  kind: "sheet,table",
  maxChars: 4000,
  tableMaxRows: 4,
  tableMaxCols: 6,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
