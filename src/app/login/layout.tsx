import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in to OurTrips',
  description: 'Sign in to manage, save, and share your OurTrips itineraries.',
  alternates: {
    canonical: 'https://ourtrips.to/login',
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
