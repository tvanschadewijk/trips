import type { Accommodation } from './types';

type AccommodationStatusLike = Pick<Accommodation, 'status'>;

export function isConfirmedAccommodation<T extends AccommodationStatusLike>(
  accommodation: T | null | undefined
): accommodation is T {
  const status = accommodation?.status?.trim().toLowerCase();
  return status === 'booked' || status === 'confirmed';
}
