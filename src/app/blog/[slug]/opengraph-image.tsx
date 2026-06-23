import { ImageResponse } from 'next/og';
import { getPost, getAllPosts } from '@/lib/blog/posts';

export const alt = 'OurTrips Journal';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  const title = post?.title ?? 'OurTrips Journal';
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
          background: '#FBF7F1',
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
              color: '#1A1410',
              letterSpacing: '0',
            }}
          >
            OurTrips
          </div>
          <div
            style={{
              fontSize: '14px',
              color: '#A03E1F',
              background: '#F5E4DA',
              padding: '4px 12px',
              borderRadius: '12px',
              fontWeight: 600,
            }}
          >
            Journal
          </div>
        </div>
        <div
          style={{
            fontSize: '48px',
            fontWeight: 800,
            color: '#1A1410',
            lineHeight: 1.15,
            letterSpacing: '0',
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
              color: '#3D352E',
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
            color: '#6B6157',
          }}
        >
          ourtrips.to
        </div>
      </div>
    ),
    { ...size },
  );
}
