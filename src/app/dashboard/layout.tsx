import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard — OurTrips',
  description: 'Manage your private OurTrips itineraries.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
