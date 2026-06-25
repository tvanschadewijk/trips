import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { trySyncAccommodationReviewForTrip } from '@/lib/accommodation-review-store';
import { getBillingSummary } from '@/lib/billing';
import { enrichTripPlaces } from '@/lib/trip-place-enrichment';
import { normalizeTripData, normalizeTripDataWithWarnings } from '@/lib/trip-data-normalize';
import { buildTripLogisticsLedger } from '@/lib/trip-logistics-ledger';
import { auditTripLogistics, type TripLogisticsAudit } from '@/lib/trip-logistics';
import {
  COORDINATE_BACKED_ROUTE_POINTS_REQUIRED_MESSAGE,
  hasCoordinateBackedTripRoute,
  normalizeTripForQualityContract,
  validateItineraryQuality,
  type TripQualityReport,
} from '@/lib/trip-quality';
import { isPublicItineraryShareId } from '@/lib/public-itineraries';
import { buildTripImagePromptSet } from '@/lib/trip-image-prompts';
import type { TripData, TripImageAsset, TripImageAssetSlot } from '@/lib/types';

type AdminClient = SupabaseClient;

export class TripServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export type SaveTripInput = {
  trip?: Record<string, unknown>;
  days?: unknown[];
  trip_id?: string;
  markdown_source?: string;
  trip_schema_version?: number;
  strict_quality?: boolean;
};

export type PatchTripInput = {
  trip?: Record<string, unknown>;
  days?: Array<Record<string, unknown>>;
  markdown_source?: string;
  mode?: TripPatchMode;
  replace_paths?: TripPathReplacement[];
  delete_paths?: string[];
  response_mode?: TripResponseMode;
};

export type TripResponseMode = 'compact' | 'full';
export type TripPatchMode = 'merge' | 'replace';

export type TripPathReplacement = {
  path: string;
  value: unknown;
};

export type TripMutationSummary = {
  trip_id: string;
  share_id: string;
  url: string;
  status: 'updated';
  updated_at: string;
  changed_paths: string[];
  warnings: string[];
  markdown_source: MarkdownSourceSummary;
  image_status: TripImageStatus;
  quality?: TripQualityReport;
};

export type MarkdownSourceSummary = {
  present: boolean;
  length: number;
  sha256: string;
  previous_sha256?: string;
};

export type TripMutationResult = {
  record: Record<string, unknown>;
  summary: TripMutationSummary;
};

export type TripReadView = 'full' | 'summary' | 'day' | 'days' | 'sections';

export type TripReadSection =
  | 'trip'
  | 'markdown_source'
  | 'days'
  | 'images'
  | 'image_assets'
  | 'blocks'
  | 'transport'
  | 'accommodation'
  | 'meals'
  | 'tips'
  | 'stats'
  | 'route_points'
  | 'quality'
  | 'logistics'
  | 'services'
  | 'notes';

export type TripReadInput = {
  view?: TripReadView;
  day_number?: number;
  day_numbers?: number[];
  day_start?: number;
  day_end?: number;
  sections?: TripReadSection[];
  include_markdown_source?: boolean;
  allow_large?: boolean;
};

export type TripLogisticsLedgerRead = ReturnType<typeof buildTripLogisticsLedger> & {
  trip_id: string;
  share_id: string;
  url: string;
  name: string;
  share_mode: string;
  created_at: string;
  updated_at: string;
};

export type DayItemKind = 'meal' | 'transport' | 'activity' | 'accommodation';
export type DayItemMutationMode = 'merge' | 'replace';
export type DayItemInsertPosition = 'append' | 'prepend';
export type AccommodationMutationScope = 'day' | 'matching_accommodation_name';

export type DayItemMatch = {
  index?: number;
  name?: string;
  label?: string;
  title?: string;
  type?: string;
  mode?: string;
  from?: string;
  to?: string;
  time_label?: string;
  content_contains?: string;
};

export type UpsertDayItemInput = {
  kind: DayItemKind;
  day_number: number;
  item: Record<string, unknown>;
  match?: DayItemMatch;
  mode?: DayItemMutationMode;
  position?: DayItemInsertPosition;
  scope?: AccommodationMutationScope;
  response_mode?: TripResponseMode;
};

export type DeleteDayItemInput = {
  kind: DayItemKind;
  day_number: number;
  match?: DayItemMatch;
  scope?: AccommodationMutationScope;
  response_mode?: TripResponseMode;
};

export type ReplaceDaySectionInput = {
  day_number: number;
  section: 'blocks' | 'transport' | 'accommodation' | 'meals' | 'tips' | 'stats';
  value: unknown;
  response_mode?: TripResponseMode;
};

export type ReplaceDayInput = {
  day_number: number;
  day: Record<string, unknown>;
  response_mode?: TripResponseMode;
};

export type DeleteDayInput = {
  day_number: number;
  response_mode?: TripResponseMode;
};

export type TruncateDaysAfterInput = {
  keep_through_day_number: number;
  response_mode?: TripResponseMode;
};

export type TripImageSearchOrientation = 'landscape' | 'portrait' | 'squarish';
export type TripImageCompletionTargetKind = 'trip_hero' | 'trip_overview' | 'day_hero';

export type TripImageSearchResult = {
  id: string;
  landscape: string;
  portrait: string;
  download_url: string;
  description: string;
  photographer: string;
  photographer_url: string;
};

export type TripHeroImageTarget =
  | { kind: 'trip'; field?: 'hero_image' | 'overview_image' }
  | { kind: 'day'; day_number: number };

export type SetTripHeroImageInput = {
  target: TripHeroImageTarget;
  url: string;
  download_url?: string;
  response_mode?: TripResponseMode;
};

export type SaveTripImageAssetInput = {
  slot: TripImageAssetSlot;
  asset: TripImageAsset;
  response_mode?: TripResponseMode;
};

export type TripImageStatusTarget = {
  target: TripImageCompletionTargetKind;
  label: string;
  day_number?: number;
};

export type TripImageStatus = {
  trip_hero_image: { present: boolean; url?: string };
  overview_image: { present: boolean; url?: string };
  day_hero_images: {
    present: number;
    total: number;
    missing_day_numbers: number[];
  };
  image_assets: Record<
    TripImageAssetSlot,
    {
      present: boolean;
      url?: string;
      source?: string;
      aspect_ratio?: string;
      provider?: string;
      model?: string;
    }
  >;
  required: {
    complete: boolean;
    missing_targets: TripImageStatusTarget[];
  };
  optional: {
    missing_targets: TripImageStatusTarget[];
  };
};

export type TripImageCompletionInput = {
  replace_existing?: boolean;
  include_overview?: boolean;
  max_updates?: number;
};

export type TripImageCompletionTarget = TripImageStatusTarget & {
  orientation: TripImageSearchOrientation;
  query: string;
};

export type TripImageCompletionApplied = TripImageCompletionTarget & {
  changed_path: string;
  url: string;
  photo_id: string;
  photographer: string;
};

export type TripImageCompletionFailure = TripImageCompletionTarget & {
  error: string;
};

export type TripImageCompletionResult = {
  trip_id: string;
  share_id: string;
  url: string;
  status: 'complete' | 'partial' | 'unchanged';
  changed_paths: string[];
  updated_targets: TripImageCompletionApplied[];
  failed_targets: TripImageCompletionFailure[];
  skipped_targets: TripImageCompletionTarget[];
  image_status: TripImageStatus;
  trip_data?: TripData;
};

export type SyncMarkdownSourceInput = {
  markdown_source: string;
  expected_current_hash?: string;
  response_mode?: TripResponseMode;
};

export type UpdateFromMarkdownInput = SyncMarkdownSourceInput & {
  trip?: Record<string, unknown>;
  days?: Array<Record<string, unknown>>;
  mode?: TripPatchMode;
};

type MutableTripData = {
  trip: Record<string, unknown>;
  days: Array<Record<string, unknown>>;
  markdown_source?: string;
};

type MutationDetails = {
  changed_paths: string[];
  warnings?: string[];
};

export type TripSaveResult = {
  trip_id: string;
  share_id: string;
  url: string;
  status: 'created' | 'updated';
  day_count: number;
  warnings: string[];
  image_status: TripImageStatus;
  quality?: TripQualityReport;
  logistics?: TripLogisticsAudit;
  accommodation_review: 'synced' | 'sync_failed';
};

export type TripListItem = {
  trip_id: string;
  name: string;
  share_id: string;
  url: string;
  share_mode: string;
  created_at: string;
  updated_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function asMutableTripData(data: unknown): MutableTripData {
  if (!isRecord(data) || !isRecord(data.trip) || !Array.isArray(data.days)) {
    throw new TripServiceError('Trip data is malformed', 500);
  }

  if (!data.days.every(isRecord)) {
    throw new TripServiceError('Trip day data is malformed', 500);
  }

  const cloned = cloneValue(normalizeTripData(data));
  return cloned as unknown as MutableTripData;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function tripUrl(origin: string, shareId: string): string {
  return origin ? `${origin}/t/${shareId}` : `/t/${shareId}`;
}

function publicVerificationOrigin(): string {
  const configuredOrigin = process.env.OURTRIPS_PUBLIC_ORIGIN
    || process.env.NEXT_PUBLIC_SITE_URL
    || 'https://ourtrips.to';

  try {
    return new URL(configuredOrigin).origin;
  } catch {
    return 'https://ourtrips.to';
  }
}

export function hashMarkdownSource(markdownSource: string | undefined): string {
  return createHash('sha256').update(markdownSource ?? '').digest('hex');
}

function summarizeMarkdownSource(markdownSource: unknown): MarkdownSourceSummary {
  const source = typeof markdownSource === 'string' ? markdownSource : undefined;
  return {
    present: typeof source === 'string',
    length: source?.length ?? 0,
    sha256: hashMarkdownSource(source),
  };
}

const IMAGE_ASSET_SLOTS: TripImageAssetSlot[] = [
  'cover_portrait',
  'cover_landscape',
  'social_og',
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function displayLabel(value: unknown, fallback: string): string {
  return isNonEmptyString(value) ? value.trim() : fallback;
}

export function summarizeTripImages(data: unknown): TripImageStatus {
  const trip = isRecord(data) && isRecord(data.trip) ? data.trip : {};
  const days = isRecord(data) && Array.isArray(data.days) ? data.days.filter(isRecord) : [];
  const assets = isRecord(trip.image_assets) ? trip.image_assets : {};
  const missingDayNumbers: number[] = [];
  const missingRequiredTargets: TripImageStatusTarget[] = [];
  const missingOptionalTargets: TripImageStatusTarget[] = [];
  let presentDayImages = 0;

  if (!isNonEmptyString(trip.hero_image)) {
    missingRequiredTargets.push({
      target: 'trip_hero',
      label: displayLabel(trip.name, 'Trip hero'),
    });
  }

  if (!isNonEmptyString(trip.overview_image)) {
    missingOptionalTargets.push({
      target: 'trip_overview',
      label: displayLabel(trip.name, 'Trip overview'),
    });
  }

  for (const day of days) {
    if (isNonEmptyString(day.hero_image)) {
      presentDayImages += 1;
    } else if (typeof day.day_number === 'number') {
      missingDayNumbers.push(day.day_number);
      missingRequiredTargets.push({
        target: 'day_hero',
        day_number: day.day_number,
        label: displayLabel(day.title, `Day ${day.day_number}`),
      });
    }
  }

  return {
    trip_hero_image: {
      present: isNonEmptyString(trip.hero_image),
      ...(isNonEmptyString(trip.hero_image) ? { url: trip.hero_image } : {}),
    },
    overview_image: {
      present: isNonEmptyString(trip.overview_image),
      ...(isNonEmptyString(trip.overview_image) ? { url: trip.overview_image } : {}),
    },
    day_hero_images: {
      present: presentDayImages,
      total: days.length,
      missing_day_numbers: missingDayNumbers,
    },
    image_assets: Object.fromEntries(
      IMAGE_ASSET_SLOTS.map((slot) => {
        const asset = isRecord(assets[slot]) ? assets[slot] : {};
        return [
          slot,
          {
            present: isNonEmptyString(asset.url),
            ...(isNonEmptyString(asset.url) ? { url: asset.url } : {}),
            ...(isNonEmptyString(asset.source) ? { source: asset.source } : {}),
            ...(isNonEmptyString(asset.aspect_ratio) ? { aspect_ratio: asset.aspect_ratio } : {}),
            ...(isNonEmptyString(asset.provider) ? { provider: asset.provider } : {}),
            ...(isNonEmptyString(asset.model) ? { model: asset.model } : {}),
          },
        ];
      })
    ) as TripImageStatus['image_assets'],
    required: {
      complete: missingRequiredTargets.length === 0,
      missing_targets: missingRequiredTargets,
    },
    optional: {
      missing_targets: missingOptionalTargets,
    },
  };
}

function buildMutationSummary(
  record: Record<string, unknown>,
  origin: string,
  details: MutationDetails
): TripMutationSummary {
  const shareId = String(record.share_id ?? '');
  const data = isRecord(record.data) ? record.data : {};

  return {
    trip_id: String(record.id ?? ''),
    share_id: shareId,
    url: tripUrl(origin, shareId),
    status: 'updated',
    updated_at: String(record.updated_at ?? ''),
    changed_paths: unique(details.changed_paths),
    warnings: unique(details.warnings ?? []),
    markdown_source: summarizeMarkdownSource(data.markdown_source),
    image_status: summarizeTripImages(data),
  };
}

function assertMarkdownSize(markdownSource: unknown): asserts markdownSource is string | undefined {
  if (typeof markdownSource === 'string' && markdownSource.length > 262144) {
    throw new TripServiceError('markdown_source exceeds 256 KB', 413);
  }
}

function buildTripBody(input: SaveTripInput): {
  tripBody: TripData;
  quality?: TripQualityReport;
  warnings: string[];
} {
  assertMarkdownSize(input.markdown_source);

  if (!input.trip?.name) {
    throw new TripServiceError('Trip name is required', 400);
  }

  const tripBody: {
    trip: SaveTripInput['trip'];
    days: SaveTripInput['days'];
    markdown_source?: string;
  } = {
    trip: input.trip,
    days: input.days,
  };

  if (typeof input.markdown_source === 'string' && input.markdown_source.length > 0) {
    tripBody.markdown_source = input.markdown_source;
  }

  const normalizedInput = normalizeTripDataWithWarnings(tripBody);

  if (input.trip_schema_version === 2) {
    const normalized = normalizeTripForQualityContract(normalizedInput.data);
    const quality = validateItineraryQuality(normalized);
    const strictErrors = [
      ...quality.errors,
      ...(!hasCoordinateBackedTripRoute(normalized)
        ? [COORDINATE_BACKED_ROUTE_POINTS_REQUIRED_MESSAGE]
        : []),
    ];
    if (input.strict_quality && strictErrors.length > 0) {
      throw new TripServiceError(strictErrors.join(' '), 422);
    }
    return { tripBody: normalized, quality, warnings: normalizedInput.warnings };
  }

  return { tripBody: normalizedInput.data, warnings: normalizedInput.warnings };
}

function dayNumbersFromTripData(data: unknown): number[] {
  if (!isRecord(data) || !Array.isArray(data.days)) return [];

  return data.days
    .filter(isRecord)
    .map((day) => day.day_number)
    .filter((dayNumber): dayNumber is number => typeof dayNumber === 'number');
}

function assertFullSaveDoesNotDropExistingDays(existingData: unknown, nextData: TripData): void {
  const existingDayNumbers = dayNumbersFromTripData(existingData);
  const nextDayNumbers = dayNumbersFromTripData(nextData);

  if (existingDayNumbers.length === 0 || nextDayNumbers.length >= existingDayNumbers.length) {
    return;
  }

  const nextDayNumberSet = new Set(nextDayNumbers);
  const missingDayNumbers = existingDayNumbers.filter((dayNumber) => !nextDayNumberSet.has(dayNumber));
  const missingSummary = missingDayNumbers.length > 0
    ? ` Missing existing day numbers: ${missingDayNumbers.join(', ')}.`
    : '';

  throw new TripServiceError(
    `Refusing to replace an existing trip with ${nextDayNumbers.length} day(s) because it currently has ${existingDayNumbers.length}. save_trip replaces the complete itinerary; use patch_trip, replace_day, replace_day_section, or focused upsert/delete tools for day edits.${missingSummary}`,
    409
  );
}

export async function saveTripForUser(
  admin: AdminClient,
  userId: string,
  input: SaveTripInput,
  origin: string
): Promise<TripSaveResult> {
  const { tripBody, quality, warnings } = buildTripBody(input);
  await enrichTripPlaces(tripBody);
  const logistics = quality?.logistics ?? auditTripLogistics(tripBody);
  const tripName = String(input.trip?.name);

  if (input.trip_id) {
    const { data: existing } = await admin
      .from('trips')
      .select('id, share_id, data')
      .eq('id', input.trip_id)
      .eq('user_id', userId)
      .single();

    if (existing) {
      assertFullSaveDoesNotDropExistingDays(existing.data, tripBody);

      const { error } = await admin
        .from('trips')
        .update({
          name: tripName,
          data: tripBody,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) {
        throw new TripServiceError(error.message, 500);
      }

      const accommodationReview = await trySyncAccommodationReviewForTrip(
        admin,
        existing.id,
        tripBody
      );

      return {
        trip_id: existing.id,
        share_id: existing.share_id,
        url: `${origin}/t/${existing.share_id}`,
        status: 'updated',
        day_count: Array.isArray(tripBody.days) ? tripBody.days.length : 0,
        warnings: unique(warnings),
        image_status: summarizeTripImages(tripBody),
        quality,
        logistics,
        accommodation_review: accommodationReview,
      };
    }
  }

  let existingByName: { id: string; share_id: string; data: unknown } | null = null;
  const startDate = tripBody.trip.dates.start;

  if (typeof startDate === 'string' && startDate.length > 0) {
    const { data } = await admin
      .from('trips')
      .select('id, share_id, data')
      .eq('user_id', userId)
      .eq('name', tripName)
      .eq('data->trip->dates->>start', startDate)
      .single();
    existingByName = data;
  }

  if (!existingByName) {
    const { data } = await admin
      .from('trips')
      .select('id, share_id, data')
      .eq('user_id', userId)
      .eq('name', tripName)
      .single();
    existingByName = data;
  }

  if (existingByName) {
    assertFullSaveDoesNotDropExistingDays(existingByName.data, tripBody);

    const { error } = await admin
      .from('trips')
      .update({
        name: tripName,
        data: tripBody,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingByName.id);

    if (error) {
      throw new TripServiceError(error.message, 500);
    }

    const accommodationReview = await trySyncAccommodationReviewForTrip(
      admin,
      existingByName.id,
      tripBody
    );

    return {
      trip_id: existingByName.id,
      share_id: existingByName.share_id,
      url: `${origin}/t/${existingByName.share_id}`,
      status: 'updated',
      day_count: Array.isArray(tripBody.days) ? tripBody.days.length : 0,
      warnings: unique(warnings),
      image_status: summarizeTripImages(tripBody),
      quality,
      logistics,
      accommodation_review: accommodationReview,
    };
  }

  const billing = await getBillingSummary(admin, userId);
  if (!billing.can_create_trip) {
    throw new TripServiceError(
      `You have used the ${billing.free_trip_limit} trips included with the free plan. Subscribe to create another trip.`,
      402,
      'trip_limit_reached',
      { billing }
    );
  }

  const { data: newTrip, error } = await admin
    .from('trips')
    .insert({
      user_id: userId,
      name: tripName,
      data: tripBody,
      share_mode: 'companion',
    })
    .select('id, share_id')
    .single();

  if (error || !newTrip) {
    throw new TripServiceError(error?.message || 'Failed to create trip', 500);
  }

  const accommodationReview = await trySyncAccommodationReviewForTrip(
    admin,
    newTrip.id,
    tripBody
  );

  return {
    trip_id: newTrip.id,
    share_id: newTrip.share_id,
    url: `${origin}/t/${newTrip.share_id}`,
    status: 'created',
    day_count: Array.isArray(tripBody.days) ? tripBody.days.length : 0,
    warnings: unique(warnings),
    image_status: summarizeTripImages(tripBody),
    quality,
    logistics,
    accommodation_review: accommodationReview,
  };
}

export async function listTripsForUser(
  admin: AdminClient,
  userId: string,
  origin: string
): Promise<TripListItem[]> {
  const { data: trips, error } = await admin
    .from('trips')
    .select('id, name, share_id, share_mode, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new TripServiceError(error.message, 500);
  }

  return (trips || [])
    .filter((trip) => !isPublicItineraryShareId(trip.share_id))
    .map((trip) => ({
      trip_id: trip.id,
      name: trip.name,
      share_id: trip.share_id,
      url: `${origin}/t/${trip.share_id}`,
      share_mode: trip.share_mode,
      created_at: trip.created_at,
      updated_at: trip.updated_at,
    }));
}

export async function getTripForUser(
  admin: AdminClient,
  userId: string,
  tripId: string
) {
  const { data: trip, error } = await admin
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .eq('user_id', userId)
    .single();

  if (error || !trip) {
    throw new TripServiceError('Trip not found', 404);
  }

  return trip;
}

async function getTripByShareIdForUser(
  admin: AdminClient,
  userId: string,
  shareId: string
) {
  const { data: trip, error } = await admin
    .from('trips')
    .select('*')
    .eq('share_id', shareId)
    .eq('user_id', userId)
    .single();

  if (error || !trip) {
    throw new TripServiceError('Trip not found', 404);
  }

  return trip;
}

async function persistTripDataForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  nextData: MutableTripData,
  expectedUpdatedAt?: string
): Promise<Record<string, unknown>> {
  const updatedName = nextData.trip.name;
  let query = admin
    .from('trips')
    .update({
      data: nextData,
      ...(typeof updatedName === 'string' && updatedName.length > 0
        ? { name: updatedName }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', tripId)
    .eq('user_id', userId);

  if (expectedUpdatedAt) {
    query = query.eq('updated_at', expectedUpdatedAt);
  }

  const { data: updated, error } = await query.select().single();

  if (error) {
    if (expectedUpdatedAt) {
      throw new TripServiceError('Trip changed while applying expected markdown hash', 409);
    }
    throw new TripServiceError(error.message, 500);
  }

  await trySyncAccommodationReviewForTrip(admin, tripId, nextData as unknown as TripData);
  return updated as Record<string, unknown>;
}

async function mutateTripForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  origin: string,
  mutate: (data: MutableTripData, record: Record<string, unknown>) => MutationDetails,
  options: { compareUpdatedAt?: boolean } = {}
): Promise<TripMutationResult> {
  const trip = await getTripForUser(admin, userId, tripId);
  const nextData = asMutableTripData(trip.data);
  const details = mutate(nextData, trip);
  if (mutationTouchesMapPlaces(details.changed_paths)) {
    await enrichTripPlaces(nextData as unknown as TripData);
  }
  const updated = await persistTripDataForUser(
    admin,
    userId,
    tripId,
    nextData,
    options.compareUpdatedAt ? String(trip.updated_at ?? '') : undefined
  );

  return {
    record: updated,
    summary: buildMutationSummary(updated, origin, details),
  };
}

function mutationTouchesMapPlaces(paths: string[]): boolean {
  return paths.some((path) => (
    path === 'trip' ||
    path === 'days' ||
    /^days\[day_number=\d+\]$/.test(path) ||
    path === 'trip.route_points' ||
    path.startsWith('trip.route_points.') ||
    path.includes('.blocks') ||
    path.includes('.meals') ||
    path.includes('.accommodation')
  ));
}

export async function patchTripForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: PatchTripInput
) {
  const result = await patchTripForUserWithResult(admin, userId, tripId, input, '');
  return result.record;
}

export async function patchTripForUserWithResult(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: PatchTripInput,
  origin: string
): Promise<TripMutationResult> {
  return mutateTripForUser(admin, userId, tripId, origin, (existing) => {
    const details = applyPatchTripInput(existing, input);
    return details;
  });
}

function applyPatchTripInput(existing: MutableTripData, input: PatchTripInput): MutationDetails {
  const changedPaths: string[] = [];
  const warnings: string[] = [];
  const mode = input.mode ?? 'merge';

  if (input.trip) {
    if (mode === 'replace') {
      existing.trip = cloneValue(input.trip);
      changedPaths.push('trip');
    } else {
      existing.trip = deepMerge(existing.trip, input.trip);
      changedPaths.push(...collectPatchPaths('trip', input.trip));
    }
  }

  if (typeof input.markdown_source === 'string') {
    assertMarkdownSize(input.markdown_source);
    if (input.markdown_source.length === 0) {
      delete existing.markdown_source;
    } else {
      existing.markdown_source = input.markdown_source;
    }
    changedPaths.push('markdown_source');
  }

  if (input.days && Array.isArray(input.days)) {
    for (const patchDay of input.days) {
      if (typeof patchDay.day_number !== 'number') continue;
      const dayNumber = patchDay.day_number;
      const dayPath = dayPathForNumber(dayNumber);
      const idx = existing.days.findIndex((day) => day.day_number === dayNumber);
      warnings.push(...collectArrayPatchWarnings(dayPath, patchDay));
      if (mode === 'merge' && idx >= 0) {
        warnings.push(...collectAccommodationMergeWarnings(dayPath, existing.days[idx], patchDay));
      }
      if (idx >= 0) {
        existing.days[idx] =
          mode === 'replace'
            ? cloneValue(patchDay)
            : deepMerge(existing.days[idx], patchDay);
      } else {
        existing.days.push(cloneValue(patchDay));
        existing.days.sort((a, b) => (a.day_number as number) - (b.day_number as number));
      }
      changedPaths.push(...collectPatchPaths(dayPath, patchDay, new Set(['day_number'])));
    }
  }

  for (const replacement of input.replace_paths ?? []) {
    replaceTripPath(existing, replacement.path, replacement.value);
    changedPaths.push(replacement.path);
  }

  for (const path of input.delete_paths ?? []) {
    deleteTripPath(existing, path);
    changedPaths.push(path);
  }

  return { changed_paths: changedPaths, warnings };
}

function dayPathForNumber(dayNumber: number): string {
  return `days[day_number=${dayNumber}]`;
}

function collectPatchPaths(
  prefix: string,
  value: unknown,
  omittedKeys = new Set<string>()
): string[] {
  if (!isRecord(value)) return [prefix];

  const paths: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    if (omittedKeys.has(key)) continue;
    const path = `${prefix}.${key}`;
    if (isRecord(nested)) {
      paths.push(...collectPatchPaths(path, nested));
    } else {
      paths.push(path);
    }
  }

  return paths.length > 0 ? paths : [prefix];
}

function collectArrayPatchWarnings(prefix: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    return [
      `${prefix} contains an array patch. Arrays are replaced as complete arrays in patch_trip; use the focused upsert/delete tools for item-level edits.`,
    ];
  }

  if (!isRecord(value)) return [];

  return Object.entries(value).flatMap(([key, nested]) =>
    collectArrayPatchWarnings(`${prefix}.${key}`, nested)
  );
}

function collectAccommodationMergeWarnings(
  dayPath: string,
  existingDay: Record<string, unknown>,
  patchDay: Record<string, unknown>
): string[] {
  if (!isRecord(existingDay.accommodation) || !isRecord(patchDay.accommodation)) {
    return [];
  }

  const existingName = existingDay.accommodation.name;
  const nextName = patchDay.accommodation.name;
  if (
    isNonEmptyString(existingName) &&
    isNonEmptyString(nextName) &&
    existingName !== nextName
  ) {
    return [
      `${dayPath}.accommodation changed name from "${existingName}" to "${nextName}" with merge semantics. Existing nested accommodation.detail keys may have survived; use replace_accommodation, replace_day_section, or mode=replace when swapping hotels.`,
    ];
  }

  return [];
}

type PathSegment =
  | { type: 'property'; key: string }
  | { type: 'arrayIndex'; key: string; index: number }
  | { type: 'dayNumber'; dayNumber: number };

const SAFE_PROPERTY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSAFE_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const REQUIRED_ROOT_PATHS = new Set(['trip', 'days']);

function parseTripPath(path: string): PathSegment[] {
  const trimmed = path.trim();
  if (trimmed.length === 0 || trimmed !== path) {
    throw new TripServiceError(`Invalid path: ${path}`, 400);
  }

  return trimmed.split('.').map((part) => {
    const dayMatch = /^days\[day_number=(\d+)\]$/.exec(part);
    if (dayMatch) {
      return { type: 'dayNumber', dayNumber: Number(dayMatch[1]) };
    }

    const arrayMatch = /^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]$/.exec(part);
    if (arrayMatch) {
      const key = arrayMatch[1];
      assertSafePathKey(key);
      return { type: 'arrayIndex', key, index: Number(arrayMatch[2]) };
    }

    if (!SAFE_PROPERTY_RE.test(part)) {
      throw new TripServiceError(`Invalid path segment: ${part}`, 400);
    }

    assertSafePathKey(part);
    return { type: 'property', key: part };
  });
}

function assertPathDoesNotTargetRequiredRoot(
  segments: PathSegment[],
  path: string,
  action: 'replace' | 'delete'
): void {
  const first = segments[0];
  if (
    segments.length === 1 &&
    first?.type === 'property' &&
    REQUIRED_ROOT_PATHS.has(first.key)
  ) {
    throw new TripServiceError(
      `Cannot ${action} required root path "${path}" with replace_paths/delete_paths`,
      400
    );
  }
}

function assertRequiredTripShape(data: MutableTripData): void {
  if (!isRecord(data.trip) || !Array.isArray(data.days) || !data.days.every(isRecord)) {
    throw new TripServiceError('Trip data is malformed after path edit', 400);
  }
}

function assertSafePathKey(key: string): void {
  if (UNSAFE_PATH_KEYS.has(key)) {
    throw new TripServiceError(`Unsafe path segment: ${key}`, 400);
  }
}

function resolvePathSegment(container: unknown, segment: PathSegment): unknown {
  if (segment.type === 'property') {
    if (!isRecord(container) || !(segment.key in container)) {
      throw new TripServiceError(`Path not found: ${segment.key}`, 404);
    }
    return container[segment.key];
  }

  if (segment.type === 'arrayIndex') {
    if (!isRecord(container) || !Array.isArray(container[segment.key])) {
      throw new TripServiceError(`Path is not an array: ${segment.key}`, 400);
    }
    const array = container[segment.key] as unknown[];
    if (segment.index < 0 || segment.index >= array.length) {
      throw new TripServiceError(`Array index out of range: ${segment.key}[${segment.index}]`, 404);
    }
    return array[segment.index];
  }

  if (!isRecord(container) || !Array.isArray(container.days)) {
    throw new TripServiceError('Path is not a trip days array', 400);
  }
  const day = container.days.find((candidate) =>
    isRecord(candidate) && candidate.day_number === segment.dayNumber
  );
  if (!day) {
    throw new TripServiceError(`Day ${segment.dayNumber} not found`, 404);
  }
  return day;
}

function replaceTripPath(data: MutableTripData, path: string, value: unknown): void {
  const segments = parseTripPath(path);
  if (segments.length === 0) {
    throw new TripServiceError('Path is required', 400);
  }
  assertPathDoesNotTargetRequiredRoot(segments, path, 'replace');

  const last = segments[segments.length - 1];
  const parent = segments.slice(0, -1).reduce<unknown>(
    (current, segment) => resolvePathSegment(current, segment),
    data
  );

  if (last.type === 'property') {
    if (!isRecord(parent)) {
      throw new TripServiceError(`Cannot replace property ${last.key}`, 400);
    }
    parent[last.key] = cloneValue(value);
    assertRequiredTripShape(data);
    return;
  }

  if (last.type === 'arrayIndex') {
    if (!isRecord(parent) || !Array.isArray(parent[last.key])) {
      throw new TripServiceError(`Path is not an array: ${last.key}`, 400);
    }
    const array = parent[last.key] as unknown[];
    if (last.index < 0 || last.index >= array.length) {
      throw new TripServiceError(`Array index out of range: ${last.key}[${last.index}]`, 404);
    }
    array[last.index] = cloneValue(value);
    assertRequiredTripShape(data);
    return;
  }

  if (!Array.isArray(data.days)) {
    throw new TripServiceError('Path is not a trip days array', 400);
  }
  const idx = data.days.findIndex((day) => day.day_number === last.dayNumber);
  if (idx < 0) {
    throw new TripServiceError(`Day ${last.dayNumber} not found`, 404);
  }
  if (!isRecord(value)) {
    throw new TripServiceError('Replacement day value must be an object', 400);
  }
  data.days[idx] = {
    ...cloneValue(value),
    day_number:
      typeof value.day_number === 'number'
        ? value.day_number
        : last.dayNumber,
  };
  assertRequiredTripShape(data);
}

function deleteTripPath(data: MutableTripData, path: string): void {
  const segments = parseTripPath(path);
  if (segments.length === 0) {
    throw new TripServiceError('Path is required', 400);
  }
  assertPathDoesNotTargetRequiredRoot(segments, path, 'delete');

  const last = segments[segments.length - 1];
  const parent = segments.slice(0, -1).reduce<unknown>(
    (current, segment) => resolvePathSegment(current, segment),
    data
  );

  if (last.type === 'property') {
    if (!isRecord(parent) || !(last.key in parent)) {
      throw new TripServiceError(`Path not found: ${path}`, 404);
    }
    delete parent[last.key];
    assertRequiredTripShape(data);
    return;
  }

  if (last.type === 'arrayIndex') {
    if (!isRecord(parent) || !Array.isArray(parent[last.key])) {
      throw new TripServiceError(`Path is not an array: ${last.key}`, 400);
    }
    const array = parent[last.key] as unknown[];
    if (last.index < 0 || last.index >= array.length) {
      throw new TripServiceError(`Array index out of range: ${last.key}[${last.index}]`, 404);
    }
    array.splice(last.index, 1);
    assertRequiredTripShape(data);
    return;
  }

  const idx = data.days.findIndex((day) => day.day_number === last.dayNumber);
  if (idx < 0) {
    throw new TripServiceError(`Day ${last.dayNumber} not found`, 404);
  }
  data.days.splice(idx, 1);
  assertRequiredTripShape(data);
}

const ARRAY_SECTION_BY_KIND: Partial<Record<DayItemKind, string>> = {
  meal: 'meals',
  transport: 'transport',
  activity: 'blocks',
};

const ARRAY_DAY_SECTIONS = new Set(['blocks', 'transport', 'meals', 'tips', 'stats']);

function dayByNumber(data: MutableTripData, dayNumber: number): Record<string, unknown> {
  const day = data.days.find((candidate) => candidate.day_number === dayNumber);
  if (!day) {
    throw new TripServiceError(`Day ${dayNumber} not found`, 404);
  }
  return day;
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : undefined;
}

function stringIncludes(value: unknown, needle: unknown): boolean {
  const normalizedValue = normalizedString(value);
  const normalizedNeedle = normalizedString(needle);
  return Boolean(normalizedValue && normalizedNeedle && normalizedValue.includes(normalizedNeedle));
}

function stringEquals(value: unknown, expected: unknown): boolean {
  const normalizedValue = normalizedString(value);
  const normalizedExpected = normalizedString(expected);
  return Boolean(normalizedValue && normalizedExpected && normalizedValue === normalizedExpected);
}

function nestedTitle(record: Record<string, unknown>): unknown {
  return isRecord(record.detail) ? record.detail.title : undefined;
}

function itemMatches(record: Record<string, unknown>, match: DayItemMatch): boolean {
  const checks: boolean[] = [];

  if (match.name) checks.push(stringEquals(record.name, match.name));
  if (match.label) checks.push(stringEquals(record.label, match.label));
  if (match.type) checks.push(stringEquals(record.type, match.type));
  if (match.mode) checks.push(stringEquals(record.mode, match.mode));
  if (match.from) checks.push(stringEquals(record.from, match.from));
  if (match.to) checks.push(stringEquals(record.to, match.to));
  if (match.time_label) checks.push(stringEquals(record.time_label, match.time_label));
  if (match.title) {
    checks.push(
      stringEquals(record.title, match.title) ||
        stringEquals(record.label, match.title) ||
        stringEquals(record.name, match.title) ||
        stringEquals(nestedTitle(record), match.title)
    );
  }
  if (match.content_contains) {
    checks.push(stringIncludes(record.content, match.content_contains));
  }

  return checks.length > 0 && checks.every(Boolean);
}

function defaultMatchForItem(kind: DayItemKind, item: Record<string, unknown>): DayItemMatch | undefined {
  if (kind === 'meal') {
    const match: DayItemMatch = {};
    if (typeof item.name === 'string') match.name = item.name;
    if (typeof item.type === 'string') match.type = item.type;
    return Object.keys(match).length > 0 ? match : undefined;
  }

  if (kind === 'transport') {
    const match: DayItemMatch = {};
    if (typeof item.label === 'string') match.label = item.label;
    if (typeof item.mode === 'string') match.mode = item.mode;
    if (typeof item.from === 'string') match.from = item.from;
    if (typeof item.to === 'string') match.to = item.to;
    return Object.keys(match).length > 0 ? match : undefined;
  }

  if (kind === 'activity') {
    const match: DayItemMatch = {};
    if (typeof item.time_label === 'string') match.time_label = item.time_label;
    if (typeof item.type === 'string') match.type = item.type;
    if (typeof item.title === 'string') match.title = item.title;
    if (isRecord(item.detail) && typeof item.detail.title === 'string') {
      match.title = item.detail.title;
    }
    return Object.keys(match).length > 0 ? match : undefined;
  }

  return undefined;
}

function hasMatchCriteria(match: DayItemMatch | undefined): match is DayItemMatch {
  if (!match) return false;
  return Object.entries(match).some(([, value]) =>
    typeof value === 'number' || (typeof value === 'string' && value.trim().length > 0)
  );
}

function findMatchedIndex(
  items: Array<Record<string, unknown>>,
  match: DayItemMatch | undefined
): number {
  if (!hasMatchCriteria(match)) return -1;
  if (typeof match.index === 'number') return match.index;
  return items.findIndex((item) => itemMatches(item, match));
}

function arraySectionForKind(kind: DayItemKind): string {
  const section = ARRAY_SECTION_BY_KIND[kind];
  if (!section) {
    throw new TripServiceError(`Unsupported array item kind: ${kind}`, 400);
  }
  return section;
}

function ensureDayArray(day: Record<string, unknown>, section: string): Array<Record<string, unknown>> {
  if (!Array.isArray(day[section])) {
    day[section] = [];
  }

  const items = day[section] as unknown[];
  if (!items.every(isRecord)) {
    throw new TripServiceError(`Day section ${section} contains malformed items`, 500);
  }
  return items as Array<Record<string, unknown>>;
}

function matchingAccommodationDayIndexes(
  data: MutableTripData,
  day: Record<string, unknown>,
  match: DayItemMatch | undefined
): number[] {
  const targetName =
    match?.name ??
    (isRecord(day.accommodation) && typeof day.accommodation.name === 'string'
      ? day.accommodation.name
      : undefined);

  if (!targetName) {
    return [data.days.indexOf(day)];
  }

  return data.days.flatMap((candidate, index) => {
    if (!isRecord(candidate.accommodation)) return [];
    return stringEquals(candidate.accommodation.name, targetName) ? [index] : [];
  });
}

function accommodationMatchesInput(
  accommodation: Record<string, unknown>,
  match: DayItemMatch | undefined
): boolean {
  if (!hasMatchCriteria(match)) return true;
  if (typeof match.index === 'number' && match.index !== 0) return false;

  const fieldMatch: DayItemMatch = { ...match };
  delete fieldMatch.index;
  return hasMatchCriteria(fieldMatch) ? itemMatches(accommodation, fieldMatch) : true;
}

export function upsertDayItemInTripData(
  data: MutableTripData,
  input: UpsertDayItemInput
): MutationDetails {
  const day = dayByNumber(data, input.day_number);
  const mode = input.mode ?? 'merge';

  if (input.kind === 'accommodation') {
    if (
      input.scope !== 'matching_accommodation_name' &&
      hasMatchCriteria(input.match) &&
      (!isRecord(day.accommodation) || !accommodationMatchesInput(day.accommodation, input.match))
    ) {
      throw new TripServiceError('Accommodation not found', 404);
    }

    const indexes =
      input.scope === 'matching_accommodation_name'
        ? matchingAccommodationDayIndexes(data, day, input.match)
        : [data.days.indexOf(day)];

    const changedPaths = indexes.map((index) => {
      const targetDay = data.days[index];
      targetDay.accommodation =
        mode === 'merge' && isRecord(targetDay.accommodation)
          ? deepMerge(targetDay.accommodation, input.item)
          : cloneValue(input.item);
      return `${dayPathForNumber(Number(targetDay.day_number))}.accommodation`;
    });

    return { changed_paths: changedPaths };
  }

  const section = arraySectionForKind(input.kind);
  const items = ensureDayArray(day, section);
  const match = input.match ?? defaultMatchForItem(input.kind, input.item);
  const matchedIndex = findMatchedIndex(items, match);

  if (typeof match?.index === 'number' && (match.index < 0 || match.index > items.length)) {
    throw new TripServiceError(`${section}[${match.index}] is out of range`, 404);
  }

  let index = matchedIndex;
  if (index >= 0 && index < items.length) {
    items[index] =
      mode === 'merge'
        ? deepMerge(items[index], input.item)
        : cloneValue(input.item);
  } else {
    if (input.position === 'prepend') {
      items.unshift(cloneValue(input.item));
      index = 0;
    } else {
      items.push(cloneValue(input.item));
      index = items.length - 1;
    }
  }

  return {
    changed_paths: [`${dayPathForNumber(input.day_number)}.${section}[${index}]`],
  };
}

export function deleteDayItemInTripData(
  data: MutableTripData,
  input: DeleteDayItemInput
): MutationDetails {
  const day = dayByNumber(data, input.day_number);

  if (input.kind === 'accommodation') {
    if (
      input.scope !== 'matching_accommodation_name' &&
      hasMatchCriteria(input.match) &&
      (!isRecord(day.accommodation) || !accommodationMatchesInput(day.accommodation, input.match))
    ) {
      throw new TripServiceError('Accommodation not found', 404);
    }

    const indexes =
      input.scope === 'matching_accommodation_name'
        ? matchingAccommodationDayIndexes(data, day, input.match)
        : [data.days.indexOf(day)];

    if (indexes.length === 0 || !indexes.some((index) => isRecord(data.days[index]?.accommodation))) {
      throw new TripServiceError('Accommodation not found', 404);
    }

    const changedPaths = indexes.flatMap((index) => {
      const targetDay = data.days[index];
      if (!isRecord(targetDay.accommodation)) return [];
      targetDay.accommodation = null;
      return [`${dayPathForNumber(Number(targetDay.day_number))}.accommodation`];
    });

    return { changed_paths: changedPaths };
  }

  const section = arraySectionForKind(input.kind);
  const items = ensureDayArray(day, section);
  if (!hasMatchCriteria(input.match)) {
    throw new TripServiceError(`A match is required to delete from ${section}`, 400);
  }

  const index = findMatchedIndex(items, input.match);
  if (index < 0 || index >= items.length) {
    throw new TripServiceError(`${input.kind} not found`, 404);
  }

  items.splice(index, 1);
  return {
    changed_paths: [`${dayPathForNumber(input.day_number)}.${section}[${index}]`],
  };
}

export function replaceDaySectionInTripData(
  data: MutableTripData,
  input: ReplaceDaySectionInput
): MutationDetails {
  const day = dayByNumber(data, input.day_number);

  if (ARRAY_DAY_SECTIONS.has(input.section) && !Array.isArray(input.value)) {
    throw new TripServiceError(`${input.section} must be an array`, 400);
  }

  if (input.section === 'accommodation' && input.value !== null && !isRecord(input.value)) {
    throw new TripServiceError('accommodation must be an object or null', 400);
  }

  day[input.section] = cloneValue(input.value);
  return {
    changed_paths: [`${dayPathForNumber(input.day_number)}.${input.section}`],
  };
}

export function replaceDayInTripData(
  data: MutableTripData,
  input: ReplaceDayInput
): MutationDetails {
  const idx = data.days.findIndex((day) => day.day_number === input.day_number);
  const replacement = {
    ...cloneValue(input.day),
    day_number:
      typeof input.day.day_number === 'number'
        ? input.day.day_number
        : input.day_number,
  };

  if (idx >= 0) {
    data.days[idx] = replacement;
  } else {
    data.days.push(replacement);
    data.days.sort((a, b) => Number(a.day_number) - Number(b.day_number));
  }

  return {
    changed_paths: [dayPathForNumber(input.day_number)],
  };
}

export function deleteDayInTripData(
  data: MutableTripData,
  input: DeleteDayInput
): MutationDetails {
  const idx = data.days.findIndex((day) => day.day_number === input.day_number);
  if (idx < 0) {
    throw new TripServiceError(`Day ${input.day_number} not found`, 404);
  }

  data.days.splice(idx, 1);
  return {
    changed_paths: [dayPathForNumber(input.day_number)],
  };
}

export function truncateDaysAfterInTripData(
  data: MutableTripData,
  input: TruncateDaysAfterInput
): MutationDetails {
  const removedDayNumbers = data.days
    .filter((day) => typeof day.day_number === 'number' && Number(day.day_number) > input.keep_through_day_number)
    .map((day) => Number(day.day_number));

  data.days = data.days.filter((day) =>
    typeof day.day_number === 'number'
      ? Number(day.day_number) <= input.keep_through_day_number
      : true
  );

  return {
    changed_paths: removedDayNumbers.map(dayPathForNumber),
    warnings:
      removedDayNumbers.length > 0
        ? []
        : [`No days existed after day ${input.keep_through_day_number}.`],
  };
}

export async function upsertDayItemForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: UpsertDayItemInput,
  origin: string
): Promise<TripMutationResult> {
  return mutateTripForUser(admin, userId, tripId, origin, (data) =>
    upsertDayItemInTripData(data, input)
  );
}

export async function deleteDayItemForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: DeleteDayItemInput,
  origin: string
): Promise<TripMutationResult> {
  return mutateTripForUser(admin, userId, tripId, origin, (data) =>
    deleteDayItemInTripData(data, input)
  );
}

export async function replaceDaySectionForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: ReplaceDaySectionInput,
  origin: string
): Promise<TripMutationResult> {
  return mutateTripForUser(admin, userId, tripId, origin, (data) =>
    replaceDaySectionInTripData(data, input)
  );
}

export async function replaceDayForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: ReplaceDayInput,
  origin: string
): Promise<TripMutationResult> {
  return mutateTripForUser(admin, userId, tripId, origin, (data) =>
    replaceDayInTripData(data, input)
  );
}

export async function deleteDayForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: DeleteDayInput,
  origin: string
): Promise<TripMutationResult> {
  return mutateTripForUser(admin, userId, tripId, origin, (data) =>
    deleteDayInTripData(data, input)
  );
}

export async function truncateDaysAfterForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: TruncateDaysAfterInput,
  origin: string
): Promise<TripMutationResult> {
  return mutateTripForUser(admin, userId, tripId, origin, (data) =>
    truncateDaysAfterInTripData(data, input)
  );
}

function assertExpectedMarkdownHashForData(
  data: MutableTripData,
  expectedHash: string | undefined
): string {
  const currentHash = hashMarkdownSource(
    typeof data.markdown_source === 'string' ? data.markdown_source : undefined
  );

  if (expectedHash && expectedHash !== currentHash) {
    throw new TripServiceError('markdown_source hash does not match current trip data', 409);
  }

  return currentHash;
}

export async function syncMarkdownSourceForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: SyncMarkdownSourceInput,
  origin: string
): Promise<TripMutationResult> {
  let previousHash = '';
  const result = await mutateTripForUser(
    admin,
    userId,
    tripId,
    origin,
    (data) => {
      previousHash = assertExpectedMarkdownHashForData(data, input.expected_current_hash);
      return applyPatchTripInput(data, { markdown_source: input.markdown_source });
    },
    { compareUpdatedAt: Boolean(input.expected_current_hash) }
  );

  result.summary.markdown_source = {
    ...result.summary.markdown_source,
    previous_sha256: previousHash,
  } as MarkdownSourceSummary & { previous_sha256: string };

  return result;
}

export async function updateTripFromMarkdownForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: UpdateFromMarkdownInput,
  origin: string
): Promise<TripMutationResult> {
  let previousHash = '';
  const result = await mutateTripForUser(
    admin,
    userId,
    tripId,
    origin,
    (data) => {
      previousHash = assertExpectedMarkdownHashForData(data, input.expected_current_hash);
      return applyPatchTripInput(data, {
        markdown_source: input.markdown_source,
        trip: input.trip,
        days: input.days,
        mode: input.mode,
      });
    },
    { compareUpdatedAt: Boolean(input.expected_current_hash) }
  );

  const warnings = [
    ...result.summary.warnings,
    ...(input.trip || input.days
      ? []
      : [
          'Only markdown_source was updated. OurTrips does not infer structured trip/days JSON from markdown server-side; provide parsed trip/days when the rendered itinerary also needs to change.',
        ]),
  ];

  result.summary.warnings = unique(warnings);
  result.summary.markdown_source = {
    ...result.summary.markdown_source,
    previous_sha256: previousHash,
  } as MarkdownSourceSummary & { previous_sha256: string };

  return result;
}

function compactDaySummary(day: Record<string, unknown>) {
  return {
    day_number: day.day_number,
    date: day.date,
    title: day.title,
    subtitle: day.subtitle,
    description_title: day.description_title,
    description: day.description,
    hero_image: day.hero_image,
    blocks: Array.isArray(day.blocks) ? day.blocks.length : 0,
    transport: Array.isArray(day.transport) ? day.transport.length : 0,
    meals: Array.isArray(day.meals) ? day.meals.length : 0,
    accommodation: isRecord(day.accommodation) ? day.accommodation.name : null,
  };
}

function compactTripDataSummary(data: unknown) {
  if (!isRecord(data)) {
    return {
      trip: null,
      day_count: 0,
      markdown_source: summarizeMarkdownSource(undefined),
      image_status: summarizeTripImages(undefined),
    };
  }

  const normalized = normalizeTripData(data);
  const days = normalized.days;
  const trip = normalized.trip;

  return {
    trip: {
      name: trip.name,
      subtitle: trip.subtitle,
      dates: trip.dates,
      travelers: trip.travelers,
      summary: trip.summary,
      hero_image: trip.hero_image,
      overview_image: trip.overview_image,
    },
    day_count: days.length,
    days: days.map((day) => compactDaySummary(day as unknown as Record<string, unknown>)),
    markdown_source: summarizeMarkdownSource(data.markdown_source),
    image_status: summarizeTripImages(data),
  };
}

function tripReadBase(record: Record<string, unknown>, origin: string) {
  const shareId = String(record.share_id ?? '');

  return {
    trip_id: String(record.id ?? ''),
    share_id: shareId,
    url: tripUrl(origin, shareId),
    name: String(record.name ?? ''),
    share_mode: String(record.share_mode ?? ''),
    created_at: String(record.created_at ?? ''),
    updated_at: String(record.updated_at ?? ''),
  };
}

export function formatTripLogisticsLedgerForRead(
  record: Record<string, unknown>,
  origin: string
): TripLogisticsLedgerRead {
  const data = isRecord(record.data) ? record.data : {};
  return {
    ...tripReadBase(record, origin),
    ...buildTripLogisticsLedger(data),
  };
}

export async function getTripLogisticsLedgerForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  origin: string
): Promise<TripLogisticsLedgerRead> {
  const trip = await getTripForUser(admin, userId, tripId);
  return formatTripLogisticsLedgerForRead(trip as Record<string, unknown>, origin);
}

function selectDaySections(
  day: Record<string, unknown>,
  sections: TripReadSection[] | undefined
): Record<string, unknown> {
  const selected = new Set(sections?.length ? sections : ['blocks', 'transport', 'accommodation', 'meals']);
  const result: Record<string, unknown> = {
    day_number: day.day_number,
    date: day.date,
    title: day.title,
    subtitle: day.subtitle,
    description_title: day.description_title,
    description: day.description,
    hero_image: day.hero_image,
  };

  for (const section of selected) {
    if (
      section === 'blocks' ||
      section === 'transport' ||
      section === 'accommodation' ||
      section === 'meals' ||
      section === 'tips' ||
      section === 'stats'
    ) {
      result[section] = day[section];
    }
  }

  return result;
}

function selectDaysForRead(
  days: Array<Record<string, unknown>>,
  input: TripReadInput
): Array<Record<string, unknown>> {
  if (typeof input.day_number === 'number') {
    return days.filter((candidate) => candidate.day_number === input.day_number);
  }

  const requestedNumbers = new Set(input.day_numbers ?? []);
  const hasRequestedNumbers = requestedNumbers.size > 0;
  const start = typeof input.day_start === 'number' ? input.day_start : undefined;
  const end = typeof input.day_end === 'number' ? input.day_end : undefined;

  return days.filter((day) => {
    const dayNumber = typeof day.day_number === 'number' ? day.day_number : undefined;
    if (typeof dayNumber !== 'number') {
      return !hasRequestedNumbers && start === undefined && end === undefined;
    }
    if (hasRequestedNumbers && !requestedNumbers.has(dayNumber)) return false;
    if (start !== undefined && dayNumber < start) return false;
    if (end !== undefined && dayNumber > end) return false;
    return true;
  });
}

export function formatTripForRead(
  record: Record<string, unknown>,
  input: TripReadInput,
  origin: string
) {
  const view = input.view ?? 'summary';
  const data = isRecord(record.data) ? normalizeTripData(record.data) : normalizeTripData({});
  const days = data.days as unknown as Array<Record<string, unknown>>;

  if (view === 'full') {
    if (input.allow_large !== true) {
      throw new TripServiceError(
        'Full trip reads can exceed agent token limits. Use view=summary, view=day, view=days with day ranges, view=sections, or set allow_large=true intentionally.',
        400
      );
    }
    return { trip: record };
  }

  const base = tripReadBase(record, origin);
  if (view === 'summary') {
    return {
      ...base,
      ...compactTripDataSummary(data),
    };
  }

  if (view === 'day') {
    if (typeof input.day_number !== 'number') {
      throw new TripServiceError('day_number is required for day view', 400);
    }
    const day = days.find((candidate) => candidate.day_number === input.day_number);
    if (!day) {
      throw new TripServiceError(`Day ${input.day_number} not found`, 404);
    }

    return {
      ...base,
      day,
      markdown_source: summarizeMarkdownSource(data.markdown_source),
      image_status: summarizeTripImages(data),
    };
  }

  if (view === 'days') {
    return {
      ...base,
      days: selectDaysForRead(days, input),
      markdown_source: summarizeMarkdownSource(data.markdown_source),
      image_status: summarizeTripImages(data),
    };
  }

  const selected = new Set(input.sections?.length ? input.sections : ['trip', 'days']);
  const result: Record<string, unknown> = { ...base };

  if (selected.has('trip') && isRecord(data.trip)) {
    result.trip = data.trip;
  }

  if (selected.has('images')) {
    result.image_status = summarizeTripImages(data);
  }

  if (selected.has('image_assets') && isRecord(data.trip)) {
    result.image_assets = data.trip.image_assets;
  }

  if (selected.has('route_points') && isRecord(data.trip)) {
    result.route_points = data.trip.route_points;
  }

  if (selected.has('quality')) {
    result.quality = validateItineraryQuality(data);
  }

  if (selected.has('logistics')) {
    result.logistics = auditTripLogistics(data);
  }

  if (selected.has('services') && isRecord(data.trip)) {
    result.services = data.trip.services;
  }

  if (selected.has('notes') && isRecord(data.trip)) {
    result.notes = data.trip.notes;
  }

  if (selected.has('markdown_source')) {
    result.markdown_source = input.include_markdown_source
      ? data.markdown_source
      : summarizeMarkdownSource(data.markdown_source);
  }

  const daySections = input.sections?.filter((section) =>
    ['blocks', 'transport', 'accommodation', 'meals', 'tips', 'stats'].includes(section)
  );

  if (typeof input.day_number === 'number') {
    const day = days.find((candidate) => candidate.day_number === input.day_number);
    if (!day) {
      throw new TripServiceError(`Day ${input.day_number} not found`, 404);
    }
    result.day = selectDaySections(day, daySections);
  } else if (selected.has('days') || (daySections && daySections.length > 0)) {
    result.days = selectDaysForRead(days, input).map((day) => selectDaySections(day, daySections));
  }

  return result;
}

type TripItemCounts = {
  days: number;
  blocks: number;
  transport: number;
  meals: number;
  accommodations: number;
};

function countTripItems(data: unknown): TripItemCounts {
  const days = isRecord(data) && Array.isArray(data.days) ? data.days.filter(isRecord) : [];
  return days.reduce<TripItemCounts>(
    (counts, day) => {
      counts.days += 1;
      counts.blocks += Array.isArray(day.blocks) ? day.blocks.length : 0;
      counts.transport += Array.isArray(day.transport) ? day.transport.length : 0;
      counts.meals += Array.isArray(day.meals) ? day.meals.length : 0;
      counts.accommodations += isRecord(day.accommodation) ? 1 : 0;
      return counts;
    },
    { days: 0, blocks: 0, transport: 0, meals: 0, accommodations: 0 }
  );
}

function booleanStatus(values: Array<boolean | undefined>): 'ok' | 'failed' {
  return values.every((value) => value !== false) ? 'ok' : 'failed';
}

const UNSPLASH_API = 'https://api.unsplash.com/search/photos';
type NextFetchRequestInit = RequestInit & {
  next?: { revalidate?: number };
};

export async function searchTripImages(
  query: string,
  orientation: TripImageSearchOrientation = 'landscape'
): Promise<{
  query: string;
  orientation: TripImageSearchOrientation;
  results: TripImageSearchResult[];
}> {
  if (!query.trim()) {
    throw new TripServiceError('Image search query is required', 400);
  }

  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    throw new TripServiceError('UNSPLASH_ACCESS_KEY is not configured', 500);
  }

  const url = new URL(UNSPLASH_API);
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '3');
  url.searchParams.set('orientation', orientation);

  const requestInit: NextFetchRequestInit = {
    headers: { Authorization: `Client-ID ${key}` },
    next: { revalidate: 86400 },
  };

  const response = await fetch(url.toString(), requestInit);

  if (!response.ok) {
    const body = await response.text();
    throw new TripServiceError(`Unsplash image search failed: ${body}`, response.status);
  }

  const body = await response.json();
  const results = Array.isArray(body.results) ? body.results : [];

  return {
    query,
    orientation,
    results: results.map((photo: Record<string, unknown>) => {
      const urls = isRecord(photo.urls) ? photo.urls : {};
      const links = isRecord(photo.links) ? photo.links : {};
      const user = isRecord(photo.user) ? photo.user : {};
      const userLinks = isRecord(user.links) ? user.links : {};
      const base = isNonEmptyString(urls.raw) ? urls.raw.split('?')[0] : '';
      return {
        id: String(photo.id ?? ''),
        landscape: `${base}?w=800&h=500&fit=crop&q=80`,
        portrait: `${base}?w=1200&h=1600&fit=crop&q=80`,
        download_url: isNonEmptyString(links.download_location) ? links.download_location : '',
        description: String(photo.description || photo.alt_description || ''),
        photographer: String(user.name || ''),
        photographer_url: `${isNonEmptyString(userLinks.html) ? userLinks.html : ''}?utm_source=ourtrips&utm_medium=referral`,
      };
    }),
  };
}

export async function trackTripImageDownload(downloadUrl: string): Promise<{ ok: true }> {
  const trimmedUrl = downloadUrl.trim();
  if (!trimmedUrl) {
    throw new TripServiceError('download_url is required for Unsplash tracking', 400);
  }

  if (!isUnsplashDownloadLocation(trimmedUrl)) {
    throw new TripServiceError('download_url must be an Unsplash download location', 400);
  }

  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    throw new TripServiceError('UNSPLASH_ACCESS_KEY is not configured', 500);
  }

  const response = await fetch(trimmedUrl, {
    headers: { Authorization: `Client-ID ${key}` },
  });

  if (!response.ok) {
    throw new TripServiceError('Unsplash download tracking failed', response.status);
  }

  return { ok: true };
}

function isUnsplashDownloadLocation(downloadUrl: string): boolean {
  try {
    const url = new URL(downloadUrl);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'api.unsplash.com' &&
      url.username === '' &&
      url.password === '' &&
      /^\/photos\/[^/]+\/download$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

const DEFAULT_IMAGE_COMPLETION_MAX_UPDATES = 24;

function cleanImageQueryPart(value: unknown): string {
  if (!isNonEmptyString(value)) return '';
  return value
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[|()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addQueryPart(parts: string[], value: unknown, limit = 80): void {
  const cleaned = cleanImageQueryPart(value);
  if (!cleaned) return;
  const truncated = cleaned.length > limit ? cleaned.slice(0, limit).trimEnd() : cleaned;
  const normalized = truncated.toLocaleLowerCase();
  if (parts.some((part) => part.toLocaleLowerCase() === normalized)) return;
  parts.push(truncated);
}

function routeDestinationFromTitle(title: unknown): string {
  const cleaned = cleanImageQueryPart(title);
  if (!cleaned) return '';
  const parts = cleaned
    .split(/\s*(?:→|->|–>|—>| to )\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : cleaned;
}

function collectDayImageQueryParts(day: Record<string, unknown>): string[] {
  const parts: string[] = [];
  addQueryPart(parts, routeDestinationFromTitle(day.title));
  addQueryPart(parts, day.subtitle);
  addQueryPart(parts, day.description_title);

  if (isRecord(day.accommodation)) {
    addQueryPart(parts, day.accommodation.name, 60);
    if (isRecord(day.accommodation.detail)) {
      addQueryPart(parts, day.accommodation.detail.address, 60);
    }
  }

  const blocks = Array.isArray(day.blocks) ? day.blocks.filter(isRecord) : [];
  for (const block of blocks.slice(0, 2)) {
    if (isRecord(block.place)) {
      addQueryPart(parts, block.place.name, 60);
      addQueryPart(parts, block.place.address, 60);
    }
    if (isRecord(block.detail)) {
      addQueryPart(parts, block.detail.title, 60);
    }
    addQueryPart(parts, block.content, 60);
  }

  const meals = Array.isArray(day.meals) ? day.meals.filter(isRecord) : [];
  for (const meal of meals.slice(0, 1)) {
    if (isRecord(meal.place)) {
      addQueryPart(parts, meal.place.name, 60);
    }
  }

  return parts;
}

function buildTripImageQuery(trip: Record<string, unknown>, suffix: string): string {
  const parts: string[] = [];
  addQueryPart(parts, trip.name);
  addQueryPart(parts, trip.subtitle);
  addQueryPart(parts, trip.summary, 90);
  addQueryPart(parts, suffix);
  return parts.filter(Boolean).join(' ');
}

function buildDayImageQuery(
  trip: Record<string, unknown>,
  day: Record<string, unknown>
): string {
  const parts: string[] = [];
  for (const part of collectDayImageQueryParts(day)) {
    addQueryPart(parts, part);
  }
  addQueryPart(parts, trip.name, 60);
  addQueryPart(parts, 'travel photography');
  return parts.filter(Boolean).slice(0, 5).join(' ');
}

export function buildTripImageCompletionTargets(
  data: unknown,
  input: TripImageCompletionInput = {}
): TripImageCompletionTarget[] {
  const nextData = asMutableTripData(data);
  const replaceExisting = input.replace_existing === true;
  const includeOverview = input.include_overview !== false;
  const targets: TripImageCompletionTarget[] = [];

  if (replaceExisting || !isNonEmptyString(nextData.trip.hero_image)) {
    targets.push({
      target: 'trip_hero',
      label: displayLabel(nextData.trip.name, 'Trip hero'),
      orientation: 'portrait',
      query: buildTripImageQuery(nextData.trip, 'travel destination portrait'),
    });
  }

  if (includeOverview && (replaceExisting || !isNonEmptyString(nextData.trip.overview_image))) {
    targets.push({
      target: 'trip_overview',
      label: displayLabel(nextData.trip.name, 'Trip overview'),
      orientation: 'landscape',
      query: buildTripImageQuery(nextData.trip, 'travel landscape'),
    });
  }

  for (const day of nextData.days) {
    if (!replaceExisting && isNonEmptyString(day.hero_image)) continue;
    const dayNumber = typeof day.day_number === 'number' ? day.day_number : undefined;
    if (typeof dayNumber !== 'number') continue;
    targets.push({
      target: 'day_hero',
      day_number: dayNumber,
      label: displayLabel(day.title, `Day ${dayNumber}`),
      orientation: 'landscape',
      query: buildDayImageQuery(nextData.trip, day),
    });
  }

  return targets;
}

function selectedImageUrlForTarget(
  result: TripImageSearchResult,
  target: TripImageCompletionTarget
): string {
  return target.orientation === 'portrait' ? result.portrait : result.landscape;
}

function applyTripImageCompletionTarget(
  data: MutableTripData,
  target: TripImageCompletionTarget,
  url: string
): string {
  if (target.target === 'trip_hero') {
    data.trip.hero_image = url;
    return 'trip.hero_image';
  }

  if (target.target === 'trip_overview') {
    data.trip.overview_image = url;
    return 'trip.overview_image';
  }

  const day = data.days.find((candidate) => candidate.day_number === target.day_number);
  if (!day) {
    throw new TripServiceError(`Day ${target.day_number} not found`, 404);
  }
  day.hero_image = url;
  return `${dayPathForNumber(target.day_number as number)}.hero_image`;
}

export async function completeMissingTripImagesForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: TripImageCompletionInput,
  origin: string
): Promise<TripImageCompletionResult> {
  const trip = await getTripForUser(admin, userId, tripId);
  const nextData = asMutableTripData(trip.data);
  const allTargets = buildTripImageCompletionTargets(nextData, input);
  const maxUpdates = Math.max(
    0,
    Math.min(
      input.max_updates ?? DEFAULT_IMAGE_COMPLETION_MAX_UPDATES,
      DEFAULT_IMAGE_COMPLETION_MAX_UPDATES
    )
  );
  const targets = allTargets.slice(0, maxUpdates);
  const skippedTargets = allTargets.slice(maxUpdates);
  const updatedTargets: TripImageCompletionApplied[] = [];
  const failedTargets: TripImageCompletionFailure[] = [];
  const changedPaths: string[] = [];

  for (const target of targets) {
    try {
      const search = await searchTripImages(target.query, target.orientation);
      const selected = search.results[0];
      if (!selected) {
        throw new TripServiceError('No image results found', 404);
      }

      const selectedUrl = selectedImageUrlForTarget(selected, target);
      if (!isNonEmptyString(selectedUrl)) {
        throw new TripServiceError('Selected image result did not include a usable URL', 502);
      }

      if (isNonEmptyString(selected.download_url)) {
        await trackTripImageDownload(selected.download_url);
      }

      const changedPath = applyTripImageCompletionTarget(nextData, target, selectedUrl);
      changedPaths.push(changedPath);
      updatedTargets.push({
        ...target,
        changed_path: changedPath,
        url: selectedUrl,
        photo_id: selected.id,
        photographer: selected.photographer,
      });
    } catch (err) {
      failedTargets.push({
        ...target,
        error: err instanceof Error ? err.message : 'Image completion failed',
      });
    }
  }

  const updated = changedPaths.length > 0
    ? await persistTripDataForUser(admin, userId, tripId, nextData)
    : trip;
  const finalData = changedPaths.length > 0 ? updated.data : trip.data;
  const imageStatus = summarizeTripImages(finalData);
  const shareId = String(updated.share_id ?? trip.share_id ?? '');
  const status = imageStatus.required.complete && failedTargets.length === 0 && skippedTargets.length === 0
    ? (changedPaths.length > 0 ? 'complete' : 'unchanged')
    : 'partial';

  return {
    trip_id: String(updated.id ?? tripId),
    share_id: shareId,
    url: tripUrl(origin, shareId),
    status,
    changed_paths: unique(changedPaths),
    updated_targets: updatedTargets,
    failed_targets: failedTargets,
    skipped_targets: skippedTargets,
    image_status: imageStatus,
    trip_data: normalizeTripData(finalData),
  };
}

export async function setTripHeroImageForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: SetTripHeroImageInput,
  origin: string
): Promise<TripMutationResult> {
  if (!input.url.trim()) {
    throw new TripServiceError('Image URL is required', 400);
  }

  const trip = await getTripForUser(admin, userId, tripId);
  const nextData = asMutableTripData(trip.data);

  if (input.download_url) {
    await trackTripImageDownload(input.download_url);
  }

  let details: MutationDetails;
  if (input.target.kind === 'trip') {
    const field = input.target.field ?? 'hero_image';
    nextData.trip[field] = input.url;
    details = { changed_paths: [`trip.${field}`] };
  } else {
    const dayNumber = input.target.day_number;
    const day = nextData.days.find((candidate) => candidate.day_number === dayNumber);
    if (!day) {
      throw new TripServiceError(`Day ${dayNumber} not found`, 404);
    }
    day.hero_image = input.url;
    details = { changed_paths: [`${dayPathForNumber(dayNumber)}.hero_image`] };
  }

  const updated = await persistTripDataForUser(admin, userId, tripId, nextData);
  return {
    record: updated,
    summary: buildMutationSummary(updated, origin, details),
  };
}

export function saveTripImageAssetInTripData(
  data: MutableTripData,
  input: SaveTripImageAssetInput
): MutationDetails {
  if (!isNonEmptyString(input.asset.url)) {
    throw new TripServiceError('Image asset URL is required', 400);
  }

  if (!isRecord(data.trip.image_assets)) {
    data.trip.image_assets = {};
  }

  const assets = data.trip.image_assets as Record<string, unknown>;
  assets[input.slot] = cloneValue({
    ...input.asset,
    source: input.asset.source ?? 'manual',
    generated_at: input.asset.generated_at ?? new Date().toISOString(),
  });

  return {
    changed_paths: [`trip.image_assets.${input.slot}`],
  };
}

export async function saveTripImageAssetForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: SaveTripImageAssetInput,
  origin: string
): Promise<TripMutationResult> {
  return mutateTripForUser(admin, userId, tripId, origin, (data) =>
    saveTripImageAssetInTripData(data, input)
  );
}

export async function getTripImagePromptsForUser(
  admin: AdminClient,
  userId: string,
  tripId: string
) {
  const trip = await getTripForUser(admin, userId, tripId);
  const data = asMutableTripData(trip.data) as unknown as TripData;
  return {
    trip_id: trip.id,
    share_id: trip.share_id,
    prompts: buildTripImagePromptSet(data),
    image_status: summarizeTripImages(trip.data),
    save_tool: 'save_trip_image_asset',
  };
}

export async function verifyTripPublicDataForUser(
  admin: AdminClient,
  userId: string,
  input: { trip_id?: string; share_id?: string; check_page?: boolean }
) {
  if (!input.trip_id && !input.share_id) {
    throw new TripServiceError('trip_id or share_id is required', 400);
  }

  const trip = input.trip_id
    ? await getTripForUser(admin, userId, input.trip_id)
    : await getTripByShareIdForUser(admin, userId, String(input.share_id));
  const shareId = String(trip.share_id);
  const verificationOrigin = publicVerificationOrigin();
  const dataUrl = `${verificationOrigin}/api/trip-data/${shareId}`;
  const pageUrl = tripUrl(verificationOrigin, shareId);

  let publicBody: Record<string, unknown> | undefined;
  let publicStatus: number | undefined;
  let publicError: string | undefined;
  try {
    const response = await fetch(dataUrl, { cache: 'no-store' });
    publicStatus = response.status;
    publicBody = await fetchJsonBody(response, dataUrl);
  } catch (err) {
    publicError = err instanceof Error ? err.message : 'Failed to fetch public trip data';
  }

  let pageStatus: number | undefined;
  let pageContentType: string | null | undefined;
  let pageError: string | undefined;
  if (input.check_page !== false) {
    try {
      const response = await fetch(pageUrl, { cache: 'no-store' });
      pageStatus = response.status;
      pageContentType = response.headers.get('content-type');
    } catch (err) {
      pageError = err instanceof Error ? err.message : 'Failed to fetch public trip page';
    }
  }

  const publicData = isRecord(publicBody?.data) ? publicBody.data : undefined;
  const expectedData = trip.data;
  const publicImageStatus = summarizeTripImages(publicData);
  const checks = {
    public_data_accessible: typeof publicStatus === 'number' && publicStatus >= 200 && publicStatus < 300,
    public_page_accessible:
      input.check_page === false
        ? undefined
        : typeof pageStatus === 'number' && pageStatus >= 200 && pageStatus < 300,
    share_id_matches: publicBody?.share_id === trip.share_id,
    share_mode_matches: publicBody?.share_mode === trip.share_mode,
    updated_at_matches: publicBody?.updated_at === trip.updated_at,
    trip_name_matches:
      isRecord(publicData?.trip) &&
      isRecord(expectedData?.trip) &&
      publicData.trip.name === expectedData.trip.name,
    item_counts_match:
      JSON.stringify(countTripItems(publicData)) === JSON.stringify(countTripItems(expectedData)),
    trip_hero_image_present: publicImageStatus.trip_hero_image.present,
    all_day_hero_images_present:
      publicImageStatus.day_hero_images.total === 0 ||
      publicImageStatus.day_hero_images.missing_day_numbers.length === 0,
  };

  return {
    trip_id: trip.id,
    share_id: trip.share_id,
    url: pageUrl,
    public_data_url: dataUrl,
    status: booleanStatus(Object.values(checks)),
    checks,
    public_data: {
      http_status: publicStatus,
      error: publicError,
      summary: compactTripDataSummary(publicData),
      item_counts: countTripItems(publicData),
      image_status: publicImageStatus,
    },
    public_page:
      input.check_page === false
        ? undefined
        : {
            http_status: pageStatus,
            content_type: pageContentType,
            error: pageError,
          },
    expected: {
      updated_at: trip.updated_at,
      item_counts: countTripItems(expectedData),
      image_status: summarizeTripImages(expectedData),
    },
  };
}

async function fetchJsonBody(response: Response, url: string): Promise<Record<string, unknown> | undefined> {
  try {
    const body = await response.json();
    return isRecord(body) ? body : undefined;
  } catch {
    throw new TripServiceError(`Invalid JSON from ${url}`, 502);
  }
}

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}
