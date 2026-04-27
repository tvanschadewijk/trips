import { OG_SIZE, OG_CONTENT_TYPE, renderOgImage } from '@/lib/og-image';
import { renderTripOgImage } from '@/lib/og-trip-image';
import { createClient } from '@/lib/supabase/server';
import type { TripData } from '@/lib/types';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ shareId: string }>;
}

export default async function Image({ params }: Props) {
  const { shareId } = await params;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('trips')
      .select('data')
      .eq('share_id', shareId)
      .eq('is_public', true)
      .single();
    if (!error && data?.data?.trip) {
      return renderTripOgImage(data.data as TripData);
    }
  } catch {
    // fall through to brand OG
  }
  return renderOgImage();
}
