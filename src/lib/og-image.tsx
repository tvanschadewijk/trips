import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

const GOOGLE_FONT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

async function loadGoogleFont(
  family: string,
  weight: number,
  italic = false,
): Promise<ArrayBuffer> {
  const familyParam = family.replace(/ /g, '+');
  const axis = italic ? 'ital,wght' : 'wght';
  const value = italic ? `1,${weight}` : `${weight}`;
  const url = `https://fonts.googleapis.com/css2?family=${familyParam}:${axis}@${value}&display=swap`;
  const css = await fetch(url, { headers: { 'User-Agent': GOOGLE_FONT_UA } }).then((r) =>
    r.text(),
  );
  const match = css.match(/src:\s*url\((.+?)\)\s*format/);
  if (!match) throw new Error(`Could not locate ${family} ${weight}${italic ? ' italic' : ''} font URL`);
  return await fetch(match[1]).then((r) => r.arrayBuffer());
}

export async function renderOgImage(): Promise<ImageResponse> {
  const [fraunces, frauncesItalic, inter] = await Promise.all([
    loadGoogleFont('Fraunces', 400),
    loadGoogleFont('Fraunces', 400, true),
    loadGoogleFont('Inter', 600),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#FBF7F1',
          fontFamily: 'Inter',
          padding: '72px 80px',
          position: 'relative',
        }}
      >
        {/* Top eyebrow */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#C14F2A',
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: 999, background: '#C14F2A' }} />
            <div>OurTrips</div>
            <div style={{ color: '#9B9087', marginLeft: 14 }}>· An editorial travel journal</div>
          </div>
          <div
            style={{
              display: 'flex',
              fontFamily: 'Fraunces',
              fontStyle: 'italic',
              fontSize: 18,
              color: '#6B6157',
            }}
          >
            est. 2026
          </div>
        </div>

        {/* Hair-thin warm rule */}
        <div
          style={{
            display: 'flex',
            height: 1,
            background: '#E8E1D6',
            marginTop: 28,
          }}
        />

        {/* Title */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'Fraunces',
            fontSize: 124,
            fontWeight: 400,
            lineHeight: 0.96,
            letterSpacing: '-0.025em',
            color: '#1A1410',
            marginTop: 72,
          }}
        >
          <div style={{ display: 'flex' }}>Your trips,</div>
          <div style={{ display: 'flex', marginTop: 6 }}>
            <div style={{ fontStyle: 'italic', color: '#C14F2A', marginRight: 30 }}>
              beautifully
            </div>
            <div>planned.</div>
          </div>
        </div>

        {/* Subtitle */}
        <div
          style={{
            display: 'flex',
            fontFamily: 'Fraunces',
            fontStyle: 'italic',
            fontSize: 30,
            fontWeight: 400,
            color: '#3D352E',
            lineHeight: 1.4,
            maxWidth: 820,
            marginTop: 36,
          }}
        >
          Built for agentic AI — Claude CoWork, Codex, and other agents that run skills.
        </div>

        {/* Bottom row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            marginTop: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: '0.20em',
              textTransform: 'uppercase',
              color: '#1A1410',
            }}
          >
            ourtrips.to
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: '#6B6157',
            }}
          >
            <div>Plan · Share · Travel</div>
          </div>
        </div>

        {/* Editorial corner mark — subtle terracotta plate */}
        <div
          style={{
            position: 'absolute',
            top: 60,
            right: 64,
            display: 'flex',
            width: 18,
            height: 18,
            borderRadius: 999,
            background: '#C14F2A',
            opacity: 0,
          }}
        />
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: 'Fraunces', data: fraunces, weight: 400, style: 'normal' },
        { name: 'Fraunces', data: frauncesItalic, weight: 400, style: 'italic' },
        { name: 'Inter', data: inter, weight: 600, style: 'normal' },
      ],
    },
  );
}
