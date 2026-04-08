import { ImageResponse } from 'next/og';

export const alt = 'Our Trips Blog — AI Trip Planning Guides';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: 'linear-gradient(135deg, #08090a 0%, #0f1011 50%, #08090a 100%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              fontSize: '20px',
              fontWeight: 600,
              color: '#f7f8f8',
              letterSpacing: '-0.03em',
            }}
          >
            Our Trips
          </div>
          <div
            style={{
              fontSize: '14px',
              color: '#7170ff',
              background: 'rgba(94, 106, 210, 0.15)',
              padding: '4px 12px',
              borderRadius: '12px',
              fontWeight: 600,
            }}
          >
            Blog
          </div>
        </div>
        <div
          style={{
            fontSize: '52px',
            fontWeight: 600,
            color: '#f7f8f8',
            lineHeight: 1.15,
            letterSpacing: '-0.03em',
            maxWidth: '900px',
            marginBottom: '16px',
          }}
        >
          AI Trip Planning Guides
        </div>
        <div
          style={{
            fontSize: '22px',
            color: '#8a8f98',
            lineHeight: 1.5,
            maxWidth: '800px',
          }}
        >
          Learn how to use Claude skills to create beautiful, shareable travel itineraries.
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: '60px',
            left: '80px',
            fontSize: '16px',
            color: '#62666d',
          }}
        >
          ourtrips.to
        </div>
      </div>
    ),
    { ...size },
  );
}
