import { ImageResponse } from 'next/og';
import { getPost, getAllPosts } from '@/lib/blog/posts';

export const alt = 'OurTrips Blog';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  const title = post?.title ?? 'OurTrips Blog';
  const subtitle = post?.subtitle ?? '';

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
          background: 'linear-gradient(135deg, #1A1A1A 0%, #0F0F0F 50%, #1A1A2E 100%)',
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
              fontWeight: 800,
              color: '#FFFFFF',
              letterSpacing: '-0.03em',
            }}
          >
            OurTrips
          </div>
          <div
            style={{
              fontSize: '14px',
              color: '#6AABF7',
              background: 'rgba(43, 124, 233, 0.15)',
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
            fontSize: '48px',
            fontWeight: 800,
            color: '#FFFFFF',
            lineHeight: 1.15,
            letterSpacing: '-0.03em',
            maxWidth: '900px',
            marginBottom: '16px',
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: '22px',
              color: 'rgba(255, 255, 255, 0.5)',
              lineHeight: 1.5,
              maxWidth: '800px',
            }}
          >
            {subtitle}
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            bottom: '60px',
            left: '80px',
            fontSize: '16px',
            color: 'rgba(255, 255, 255, 0.3)',
          }}
        >
          ourtrips.to
        </div>
      </div>
    ),
    { ...size },
  );
}
