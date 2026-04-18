# OurTrips Design System — Editorial Travel

Inspired by the approach of [awesome-design-md](https://github.com/VoltAgent/awesome-design-md): a single coherent design doc that gives agents and humans the same rails. This replaces the previous dark-product-clone aesthetic with something that matches what the product actually is — travel, memory, place.

## 1. Visual Theme & Atmosphere

OurTrips is an editorial travel publication that happens to be software. The canvas is **warm paper** (`#FBF7F1`), not dark glass. Ink is almost-black with a warm cast (`#1A1410`). Type has a distinct magazine voice: serif headlines in **Fraunces** paired with **Inter** for everything else. Accent color is a single **terracotta** (`#C14F2A`) used sparingly — on links, CTAs, and marks that matter. No gradients, no glows, no animated text shaders. Confidence instead of spectacle.

Photography leads. Long-form horizontal images, wide cinematic ratios, sparse captions in small caps. Interface chrome recedes so places can breathe. Borders are hair-thin warm lines (`#E8E1D6`) — never grey — and elevation is communicated through paper stacking (subtle shadow + off-white layering), not neon outlines.

**Key Characteristics:**
- Light-first, paper-warm: `#FBF7F1` page, `#FFFFFF` cards, `#F4EDE2` recessed
- Two-type system: **Fraunces** (serif display, optical-size axis engaged) + **Inter** (UI)
- Single chromatic accent: **Terracotta `#C14F2A`** — reserved for primary action + editorial flourishes
- Hair-thin warm rules: `#E8E1D6` — no cold greys anywhere
- Generous vertical rhythm (96px+ between sections), confident whitespace
- Image-forward: wide 16:9 or 21:9 photography, never cropped to squares unless iconic
- Small-caps and tracked uppercase labels for metadata (`tracking: 0.14em`)
- Subtle paper texture *only* on hero surfaces — never busy

## 2. Color Palette & Roles

### Paper & Surface
- **Paper** (`#FBF7F1`) — page background. Warm off-white, the default canvas.
- **Paper Deep** (`#F4EDE2`) — recessed sections (alternating bands, feature strips).
- **Card** (`#FFFFFF`) — elevated surfaces, photography mats, panels.
- **Paper Night** (`#1A1410`) — inverted hero/footer only. Deep warm black, not pure.

### Ink (Text)
- **Ink** (`#1A1410`) — primary text, headlines.
- **Ink 70** (`#3D352E`) — body text long-form.
- **Ink 50** (`#6B6157`) — secondary text, captions.
- **Ink 35** (`#9B9087`) — tertiary text, timestamps, disabled.
- **Ink Reverse** (`#FBF7F1`) — text on dark surfaces.

### Accent
- **Terracotta** (`#C14F2A`) — primary CTA, key links, brand mark.
- **Terracotta Deep** (`#A03E1F`) — hover state, pressed.
- **Terracotta Wash** (`#F5E4DA`) — tinted backgrounds, badges, highlights.
- **Ochre** (`#C89A3D`) — secondary editorial accent, used rarely (e.g. star/callout).

### Status
- **Forest** (`#2F6B4A`) — success, "in progress".
- **Clay** (`#9B4F2E`) — warning, nearly-terracotta but muted.

### Line & Divider
- **Rule** (`#E8E1D6`) — hair-thin horizontal rule, the default divider.
- **Rule Deep** (`#D4C8B4`) — structural separators.
- **Ink Line** (`#1A1410`) — editorial emphasis rule (1px or 2px solid).

### Shadow
- **Paper Lift** (`rgba(26, 20, 16, 0.04) 0 1px 0 0, rgba(26, 20, 16, 0.06) 0 4px 16px -4px`) — subtle card lift.
- **Paper Float** (`rgba(26, 20, 16, 0.08) 0 12px 32px -8px`) — floating panels, hero imagery.

## 3. Typography Rules

### Font Families
- **Display**: `Fraunces` (Google Fonts, variable, axes: `opsz 9..144`, `wght 100..900`, `SOFT 0..100`, `WONK 0..1`). Fallbacks: `'Iowan Old Style', 'Palatino', 'Georgia', serif`.
  - OpenType features: `'opsz' auto, 'ss01' on` (single-story `a` at display sizes).
  - SOFT axis: `50` for display, `30` for subheads — gives plates a humanist warmth.
- **UI**: `Inter` (variable). Fallbacks: `'SF Pro Text', system-ui, -apple-system, Segoe UI, Roboto`.
  - OpenType features: `'cv11' on` (single-story `a`), `'ss01' on` (alternate punctuation), `'tnum' on` in numeric contexts.
- **Mono**: `JetBrains Mono` for code blocks and technical labels.

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display XL | Fraunces | 80px / 5.0rem | 340 | 0.96 | -0.02em | Hero editorial headline |
| Display | Fraunces | 56px / 3.5rem | 360 | 1.00 | -0.018em | Section headlines |
| Display SM | Fraunces | 40px / 2.5rem | 380 | 1.05 | -0.015em | Feature titles, CTA block |
| Heading 1 | Fraunces | 32px / 2.0rem | 420 | 1.15 | -0.012em | Article title |
| Heading 2 | Inter | 22px / 1.375rem | 580 | 1.3 | -0.01em | Card title, sub-sections |
| Heading 3 | Inter | 17px / 1.0625rem | 620 | 1.4 | -0.005em | List labels, feature name |
| Lead | Fraunces | 22px / 1.375rem | 380 | 1.5 | -0.005em | Deck/standfirst under headline |
| Body Large | Inter | 18px / 1.125rem | 420 | 1.65 | -0.003em | Long-form body, intros |
| Body | Inter | 16px / 1.0rem | 420 | 1.6 | 0 | Default paragraph |
| Small | Inter | 14px / 0.875rem | 450 | 1.55 | 0 | Secondary content |
| Caption | Inter | 13px / 0.8125rem | 500 | 1.4 | 0 | Figure captions, metadata |
| Overline | Inter | 11px / 0.6875rem | 600 | 1 | 0.14em | Uppercase section labels |
| Byline | Fraunces (italic) | 15px / 0.9375rem | 400 | 1.4 | 0 | Author/editorial italic notes |

### Principles
- **Mixed voices**: Fraunces *speaks*, Inter *labels*. Never use Fraunces for UI chrome, never use Inter for editorial display.
- **Opsz is not optional**: Fraunces looks wrong without the optical-size axis engaged. Use `font-optical-sizing: auto`.
- **Italic Fraunces is a feature, not a fallback**: Use for bylines, pull-quotes, place names in running text.
- **Uppercase overlines track wide**: 0.14em minimum on any uppercase label ≤ 12px.
- **No weight above 620 in Inter**: keeps the UI from shouting against the serif.
- **Numbers tabular in tables**: `font-variant-numeric: tabular-nums`.

## 4. Components

### Buttons

**Primary (Terracotta)**
- Background `#C14F2A`, text `#FBF7F1`, 14px Inter 580, padding `14px 24px`, radius `999px` (pill) or `10px` (rectangular; choose one per surface).
- Hover: `#A03E1F`. Active: translate-y-[1px], no shadow change.
- Focus ring: `0 0 0 3px rgba(193, 79, 42, 0.24)`.

**Secondary (Ink Outline)**
- Background transparent, text `#1A1410`, border `1px solid #1A1410`, 14px Inter 580, padding `13px 23px`, radius matches primary.
- Hover: background `#1A1410`, text `#FBF7F1` (full inversion).

**Tertiary (Ghost)**
- Background transparent, text `#1A1410`, padding `8px 14px`, no border.
- Hover: background `#F4EDE2`. Use for nav links, inline actions.

**Link Button (Editorial)**
- Inline text with a single terracotta underline (`border-bottom: 1px solid #C14F2A`, offset 3px). No other styling.
- Hover: underline thickens to 2px.

### Cards

**Editorial Card**
- Background `#FFFFFF`, border `1px solid #E8E1D6`, radius `4px` (sharp, paper-like), shadow `Paper Lift`.
- Internal padding: `28px` (comfortable) or `40px` (feature).
- Image-led variants: no border, radius `4px`, wide aspect ratio, caption in 11px overline beneath.

**Quiet Card**
- Background `#F4EDE2`, no border, radius `4px`, no shadow.
- Use for secondary tiles, "related" sections.

### Inputs

**Text Field**
- Background `#FFFFFF`, border `1px solid #E8E1D6`, radius `6px`, padding `12px 14px`, 15px Inter 450.
- Focus: border `#1A1410`, ring `0 0 0 3px rgba(26, 20, 16, 0.06)`.
- Placeholder `#9B9087`.

### Badges & Pills

**Editorial Badge (Overline)**
- Background transparent, text `#C14F2A`, 11px Inter 600 uppercase, tracking `0.14em`, optional leading dot: `•`.
- Use for pre-headline eyebrows: `• A GUIDE TO SEOUL`.

**Tag Pill**
- Background `#F5E4DA`, text `#A03E1F`, 12px Inter 550, padding `4px 10px`, radius `999px`.
- No border. Quiet.

**Number Marker**
- Circle or square mark, 32px × 32px, border `1px solid #1A1410`, no fill, Fraunces 500 17px centered. For enumerated steps.

### Navigation

- Sticky top bar, background `rgba(251, 247, 241, 0.85)` with `backdrop-filter: blur(14px) saturate(140%)`, bottom rule `1px solid #E8E1D6`.
- Height `64px`. Logo left, links center-or-right, CTA pill right.
- Link: 14px Inter 520, color `#3D352E`. Active/hover: `#1A1410`.
- Logo wordmark: Fraunces 420, 19px, `-0.01em` tracking.

### Image Treatment

- Hero: full-bleed horizontal photograph, min-height `68vh`, cinematic crop. No overlay text unless editorial caption is intentional.
- Feature imagery: wide 16:9 or 3:2, `4px` radius, no border.
- Captions: 11px overline beneath, terracotta or ink-50.
- Duotone never. Desaturated rarely. Real color is the point.

## 5. Layout Principles

### Spacing Scale (8pt base)
`4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192` (px). Primary rhythm: **16 / 24 / 48 / 96**.

### Containers
- **Reading width**: `680px` max. Long-form content.
- **Editorial width**: `1040px` max. Most sections.
- **Wide width**: `1280px` max. Hero, galleries.
- Page gutter: `24px` mobile, `48px` desktop.

### Vertical Rhythm
- Between sections: `96px` (mobile `64px`).
- Between paragraph and next heading: `40px`.
- Between heading and its body: `16px` (tight coupling).

### Radius Scale
- `0px` — full-bleed images, editorial rules.
- `4px` — cards, image tiles (paper-like corners).
- `6px` — inputs.
- `10px` — rectangular buttons.
- `999px` — pills, primary CTAs.

## 6. Depth & Elevation

The page is a stack of paper. Each layer is expressed by (a) background warmth shift and (b) optional subtle lift shadow.

| Level | Treatment | Use |
|-------|-----------|-----|
| 0 | `#FBF7F1` bg, no shadow | Page canvas |
| 1 | `#F4EDE2` bg, no shadow | Recessed band |
| 2 | `#FFFFFF` bg + Paper Lift | Cards, panels |
| 3 | `#FFFFFF` bg + Paper Float | Floating (modal prep), photography hero |
| Inverse | `#1A1410` bg, Ink Reverse text | CTA band, footer |

No neon outlines. No glow. No gradient borders.

## 7. Do's and Don'ts

### Do
- Set `font-optical-sizing: auto` and enable Fraunces' variable axes (`wght`, `opsz`, `SOFT`).
- Use Fraunces for *anything that should feel written*: headlines, standfirsts, place names in prose, pull quotes.
- Use terracotta `#C14F2A` as the only chromatic accent. One accent, used with intent.
- Let photography carry the hero. Don't crowd it with floating product screenshots.
- Use overlines with wide tracking (`0.14em`) for section labels.
- Use italic Fraunces for bylines and subtle editorial flourishes.
- Keep Inter weights ≤ 620. Never go full bold.
- Use 4px radius on cards — paper has a corner, not a curve.

### Don't
- Don't use dark mode as default. This brand lives on warm paper.
- Don't stack animated gradients on headlines. Editorial confidence, not shader tricks.
- Don't use pure black `#000` or pure white `#FFF` on the paper canvas — warmth matters.
- Don't introduce a second accent color. One accent. Terracotta. Period.
- Don't use Inter 700/800. Use Fraunces when you need weight.
- Don't use cold grays (`#888`, `#ccc`) — always warm taupes.
- Don't wrap every element in a rounded pill. Serif typography wants restraint.
- Don't animate page titles with background-clip gradients. It's the signature move of generic AI-slop landing pages.

## 8. Responsive Behavior

| Breakpoint | Width | Behavior |
|-----------|-------|----------|
| Mobile | <640px | Single column, 24px gutter, display XL → 44px |
| Tablet | 640–1024px | Editorial 2-col possible, display XL → 56px |
| Desktop | 1024–1280px | Full editorial, display XL → 72px |
| Wide | >1280px | Full editorial, display XL → 80px, generous margins |

### Collapsing Strategy
- Display XL (80 → 72 → 56 → 44)
- Section padding (96 → 96 → 64 → 48)
- Feature strip: 3-col → 2-col → 1-col stacked
- Hero: side-by-side → stacked with image first on mobile

## 9. Agent Prompt Guide

### Quick Tokens
- Page bg: `#FBF7F1` · Card: `#FFFFFF` · Recess: `#F4EDE2` · Inverse: `#1A1410`
- Ink: `#1A1410` · Ink 50: `#6B6157` · Ink 35: `#9B9087`
- Accent: `#C14F2A` · Accent deep: `#A03E1F` · Accent wash: `#F5E4DA`
- Rule: `#E8E1D6`
- Display font: Fraunces (opsz auto, ss01 on)
- UI font: Inter (cv11 on, ss01 on)
- Primary CTA: terracotta pill, 14px Inter 580, padding `14px 24px`, radius `999px`
- Body: 16px Inter 420, `#3D352E`, line-height 1.6

### Example Component Prompt
"Build an editorial hero on `#FBF7F1`. Overline above headline: 11px Inter 600 uppercase, `#C14F2A`, tracking `0.14em`, preceded by `•`. Headline: Fraunces 360 weight, size clamp(44px, 7vw, 80px), line-height 0.96, letter-spacing `-0.02em`, color `#1A1410`, `font-optical-sizing: auto`. Standfirst: Fraunces italic 22px, 1.5 line-height, max-width 42ch, color `#3D352E`. CTAs: terracotta pill primary + outline-ink secondary. Right side: full-bleed wide landscape photograph, 4px radius, Paper Float shadow."
