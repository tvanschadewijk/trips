import { ImageResponse } from 'next/og';
import { OG_SIZE, loadGoogleFont } from './og-image';
import type { TripData } from './types';

async function fetchPhotoAsDataUrl(url: string): Promise<string | null> {
  try {
    const optimized = url.includes('unsplash.com')
      ? `${url}${url.includes('?') ? '&' : '?'}w=900&h=1200&fit=crop&fm=jpg&q=82`
      : url;
    const res = await fetch(optimized, {
      headers: {
        Accept: 'image/jpeg,image/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; OurTripsBot/1.0)',
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return null;
    const buf = await res.arrayBuffer();
    const mime = ct.includes('jpeg') ? 'image/jpeg' : ct.split(';')[0] || 'image/jpeg';
    return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
  } catch {
    return null;
  }
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function calcNights(start: string, end: string): number {
  const a = new Date(start + 'T12:00:00').getTime();
  const b = new Date(end + 'T12:00:00').getTime();
  return Math.max(1, Math.round((b - a) / 86400000));
}

export async function renderTripOgImage(trip: TripData): Promise<ImageResponse> {
  const heroUrl = trip.trip.hero_image;

  const [fraunces, frauncesItalic, inter, photoDataUrl] = await Promise.all([
    loadGoogleFont('Fraunces', 400),
    loadGoogleFont('Fraunces', 400, true),
    loadGoogleFont('Inter', 600),
    heroUrl ? fetchPhotoAsDataUrl(heroUrl) : Promise.resolve(null),
  ]);

  const start = formatDateLabel(trip.trip.dates.start);
  const end = formatDateLabel(trip.trip.dates.end);
  const nights = calcNights(trip.trip.dates.start, trip.trip.dates.end);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#FBF7F1',
          fontFamily: 'Inter',
        }}
      >
        {/* Paper column */}
        <div
          style={{
            width: photoDataUrl ? '54%' : '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '64px 56px',
            position: 'relative',
          }}
        >
          {/* Eyebrow */}
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
              marginBottom: 32,
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: 999, background: '#C14F2A' }} />
            <div>OurTrips</div>
          </div>

          {/* Trip name */}
          <div
            style={{
              display: 'flex',
              fontFamily: 'Fraunces',
              fontSize: trip.trip.name.length > 18 ? 76 : 100,
              fontWeight: 400,
              lineHeight: 0.96,
              letterSpacing: '-0.025em',
              color: '#C14F2A',
              marginBottom: 20,
            }}
          >
            {trip.trip.name}
          </div>

          {/* Subtitle */}
          {trip.trip.subtitle && (
            <div
              style={{
                display: 'flex',
                fontFamily: 'Fraunces',
                fontStyle: 'italic',
                fontSize: 28,
                fontWeight: 400,
                color: '#3D352E',
                lineHeight: 1.35,
                maxWidth: 560,
                marginBottom: 36,
              }}
            >
              {trip.trip.subtitle}
            </div>
          )}

          {/* Dates strip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 32,
              borderTop: '1px solid #E8E1D6',
              paddingTop: 22,
              marginTop: 'auto',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  fontFamily: 'Fraunces',
                  fontSize: 32,
                  fontWeight: 400,
                  color: '#1A1410',
                }}
              >
                {nights}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: '#6B6157',
                  marginTop: 2,
                }}
              >
                Nights
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  fontFamily: 'Fraunces',
                  fontSize: 32,
                  fontWeight: 400,
                  color: '#1A1410',
                }}
              >
                {start}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: '#6B6157',
                  marginTop: 2,
                }}
              >
                Start
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  fontFamily: 'Fraunces',
                  fontSize: 32,
                  fontWeight: 400,
                  color: '#1A1410',
                }}
              >
                {end}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: '#6B6157',
                  marginTop: 2,
                }}
              >
                End
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: '#1A1410',
                marginLeft: 'auto',
              }}
            >
              ourtrips.to
            </div>
          </div>
        </div>

        {/* Photo column */}
        {photoDataUrl && (
          <div style={{ width: '46%', height: '100%', display: 'flex', position: 'relative' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoDataUrl}
              alt=""
              width={552}
              height={630}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}
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
