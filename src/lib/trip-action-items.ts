export type ActionItemType = 'transport' | 'accommodation' | 'meal';
export type ActionItemStatus = 'booked' | 'open';

type MutableTripData = {
  days: Array<Record<string, unknown>>;
};

type ApplyStatusParams = {
  dayNumber: number;
  itemType: ActionItemType;
  itemIndex: number;
  status: ActionItemStatus;
};

type ApplyStatusResult =
  | { ok: true; status: ActionItemStatus }
  | { ok: false; error: string; statusCode: number };

export function normalizeActionItemType(value: unknown): ActionItemType | null {
  if (value === 'transport' || value === 'accommodation' || value === 'meal') {
    return value;
  }
  return null;
}

export function normalizeActionItemStatus(value: unknown): ActionItemStatus | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'booked') return 'booked';
  if (normalized === 'open' || normalized === 'pending') return 'open';
  return null;
}

function isPlaceholderAccommodationName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === '' ||
    normalized === 'hotel not confirmed yet' ||
    normalized === 'hotel pending' ||
    normalized === 'accommodation pending' ||
    normalized === 'to be confirmed' ||
    normalized === 'tbc' ||
    normalized === 'tbd'
  );
}

export function applyActionItemStatusToTripData(
  data: MutableTripData,
  params: ApplyStatusParams
): ApplyStatusResult {
  const { dayNumber, itemType, itemIndex, status } = params;

  if (typeof dayNumber !== 'number' || !Number.isFinite(dayNumber)) {
    return { ok: false, error: 'Invalid day number', statusCode: 400 };
  }

  if (itemType !== 'accommodation' && (!Number.isInteger(itemIndex) || itemIndex < 0)) {
    return { ok: false, error: 'Invalid item index', statusCode: 400 };
  }

  if (itemType === 'accommodation') {
    const targetDay = data.days.find((d) => d.day_number === dayNumber);
    if (!targetDay?.accommodation) {
      return { ok: false, error: 'Accommodation not found', statusCode: 404 };
    }

    const accomNameValue = (targetDay.accommodation as Record<string, unknown>).name;
    const rawAccomName = typeof accomNameValue === 'string' ? accomNameValue.trim() : '';
    const accomName = rawAccomName && !isPlaceholderAccommodationName(rawAccomName) ? rawAccomName : '';

    for (const day of data.days) {
      const accommodation = day.accommodation as Record<string, unknown> | undefined;
      const name = typeof accommodation?.name === 'string' ? accommodation.name.trim() : '';
      const sameStay = accomName ? name === accomName : day.day_number === dayNumber;
      if (accommodation && sameStay) {
        accommodation.status = status;
      }
    }

    return { ok: true, status };
  }

  const day = data.days.find((d) => d.day_number === dayNumber);
  if (!day) {
    return { ok: false, error: 'Day not found', statusCode: 404 };
  }

  const items = itemType === 'transport'
    ? (day.transport as Array<Record<string, unknown>> | undefined)
    : (day.meals as Array<Record<string, unknown>> | undefined);

  if (!items?.[itemIndex]) {
    return { ok: false, error: `${itemType} at index ${itemIndex} not found`, statusCode: 404 };
  }

  items[itemIndex].status = status;
  return { ok: true, status };
}
