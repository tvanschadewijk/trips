import type { Accommodation } from './types';

export function isConfirmedAccommodation(
  accommodation: Pick<Accommodation, 'status'> | null | undefined
): boolean {
  const status = accommodation?.status?.trim().toLowerCase();
  return status === 'booked' || status === 'confirmed';
}
