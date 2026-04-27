import type { Metadata, Viewport } from 'next';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import './globals.css';

export const metadata: Metadata = {
  title: 'OurTrips — Your trips, beautifully presented',
  description:
    'Create and share beautiful, interactive travel itineraries. Plan day-by-day, add places, and share a stunning preview with anyone.',
  metadataBase: new URL('https://ourtrips.to'),
  openGraph: {
    title: 'OurTrips — Your trips, beautifully presented',
    description:
      'Create and share beautiful, interactive travel itineraries. Plan day-by-day, add places, and share a stunning preview with anyone.',
    url: 'https://ourtrips.to',
    siteName: 'OurTrips',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OurTrips — Your trips, beautifully presented',
    description:
      'Create and share beautiful, interactive travel itineraries. Plan day-by-day, add places, and share a stunning preview with anyone.',
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/icons/icon-192.png',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'OurTrips',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  userScalable: false,
  themeColor: '#FBF7F1',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..700,0..100;1,9..144,300..700,0..100&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, padding: 0, minHeight: '100dvh', background: '#FBF7F1' }}>
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
