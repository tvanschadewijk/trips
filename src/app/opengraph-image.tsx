import { OG_SIZE, OG_CONTENT_TYPE, renderOgImage } from '@/lib/og-image';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgImage();
}
