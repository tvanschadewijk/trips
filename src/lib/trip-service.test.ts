import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteDayItemInTripData,
  formatTripLogisticsLedgerForRead,
  formatTripForRead,
  hashMarkdownSource,
  patchTripForUserWithResult,
  replaceDayInTripData,
  replaceDaySectionInTripData,
  saveTripForUser,
  saveTripImageAssetInTripData,
  setTripHeroImageForUser,
  summarizeTripImages,
  syncMarkdownSourceForUser,
  trackTripImageDownload,
  truncateDaysAfterInTripData,
  TripServiceError,
  upsertDayItemInTripData,
  verifyTripPublicDataForUser,
} from './trip-service';

function fixtureData() {
  return {
    trip: {
      name: 'London by Rail',
      subtitle: 'A compact rail weekend',
      dates: { start: '2026-07-01', end: '2026-07-03' },
      travelers: ['Thijs'],
      summary: 'Train, galleries, and a good dinner.',
      hero_image: '/hero.jpg',
    },
    markdown_source: '# London by Rail\n\nOriginal plan.',
    days: [
      {
        day_number: 1,
        date: '2026-07-01',
        title: 'Amsterdam to London',
        blocks: [
          {
            time_label: 'Afternoon',
            type: 'site',
            content: 'Visit the Frick Collection.',
            detail: { title: 'Frick Collection', body: 'Small art museum.' },
          },
        ],
        transport: [
          {
            mode: 'train',
            label: 'Eurostar',
            from: 'Amsterdam Centraal',
            to: 'London St Pancras',
            detail: { platform: '15' },
          },
        ],
        accommodation: {
          name: 'Town Hall Hotel',
          status: 'considering',
        },
        meals: [{ type: 'dinner', name: 'The Marksman' }],
      },
      {
        day_number: 2,
        date: '2026-07-02',
        title: 'East London',
        blocks: [],
        accommodation: {
          name: 'Town Hall Hotel',
          status: 'considering',
        },
      },
    ],
  };
}

function fixtureRecord() {
  return {
    id: 'trip-1',
    share_id: 'abc123',
    name: 'London by Rail',
    share_mode: 'companion',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-02T00:00:00.000Z',
    data: fixtureData(),
  };
}

test('saveTripForUser normalizes route point aliases and returns ingestion warnings', async () => {
  let insertedTripData: Record<string, unknown> | null = null;
  const admin = {
    from(table: string) {
      if (table === 'trip_accommodation_reviews') {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: null, error: null }),
          upsert: async () => ({ error: null }),
        };
      }

      assert.equal(table, 'trips');
      let inserted = false;
      return {
        select() { return this; },
        eq() { return this; },
        insert(payload: Record<string, unknown>) {
          insertedTripData = payload.data as Record<string, unknown>;
          inserted = true;
          return this;
        },
        single: async () => (
          inserted
            ? { data: { id: 'trip-new', share_id: 'share-new' }, error: null }
            : { data: null, error: null }
        ),
      };
    },
  };

  const result = await saveTripForUser(
    admin as never,
    'user-1',
    {
      trip: {
        name: 'India',
        subtitle: 'Grand circuit',
        dates: { start: '2026-12-29', end: '2027-01-27' },
        travelers: [],
        summary: 'Rajasthan, Kerala, Goa, and Mumbai.',
        hero_image: 'https://example.com/india.jpg',
        route_points: [
          { name: 'Mumbai', lat: 19.076, lng: 72.8777 },
          { title: 'Jaipur', lat: 26.9124, lng: 75.7873 },
          { label: 'Broken stop', lat: 0 },
        ],
      },
      days: [],
    },
    'https://ourtrips.to'
  );

  assert.deepEqual(result.warnings, [
    'trip.route_points[0].name was converted to label.',
    'trip.route_points[1].title was converted to label.',
    'trip.route_points[2] was skipped because label, lat, or lng was missing.',
  ]);
  assert.deepEqual(
    ((insertedTripData?.trip as Record<string, unknown>).route_points as Array<{ label: string }>).map((point) => point.label),
    ['Mumbai', 'Jaipur']
  );
});

test('saveTripForUser refuses to overwrite an existing trip with a partial day payload', async () => {
  const trip = {
    ...fixtureRecord(),
    user_id: 'user-1',
  };
  let updateCalled = false;
  const admin = {
    from(table: string) {
      assert.equal(table, 'trips');
      return {
        select() { return this; },
        eq() { return this; },
        update() {
          updateCalled = true;
          return this;
        },
        single: async () => ({ data: trip, error: null }),
      };
    },
  };

  await assert.rejects(
    () => saveTripForUser(
      admin as never,
      'user-1',
      {
        trip_id: 'trip-1',
        trip: trip.data.trip,
        days: [trip.data.days[0]],
      },
      'https://ourtrips.to'
    ),
    (err) => err instanceof TripServiceError
      && err.status === 409
      && /Refusing to replace an existing trip with 1 day/.test(err.message)
      && /Missing existing day numbers: 2/.test(err.message)
  );

  assert.equal(updateCalled, false);
});

test('formatTripForRead returns compact summaries without full markdown by default', () => {
  const summary = formatTripForRead(fixtureRecord(), { view: 'summary' }, 'https://ourtrips.to');

  assert.equal(summary.trip_id, 'trip-1');
  assert.equal(summary.url, 'https://ourtrips.to/t/abc123');
  assert.equal(summary.day_count, 2);
  assert.equal(summary.markdown_source.length, '# London by Rail\n\nOriginal plan.'.length);
  assert.equal(summary.markdown_source.sha256, hashMarkdownSource('# London by Rail\n\nOriginal plan.'));
  assert.equal('markdown_source' in summary && typeof summary.markdown_source, 'object');
  assert.deepEqual(summary.image_status.day_hero_images.missing_day_numbers, [1, 2]);
});

test('formatTripForRead guards accidental full reads and supports day ranges', () => {
  assert.throws(
    () => formatTripForRead(fixtureRecord(), { view: 'full' }, 'https://ourtrips.to'),
    /Full trip reads can exceed agent token limits/
  );

  const ranged = formatTripForRead(
    fixtureRecord(),
    { view: 'sections', sections: ['days', 'accommodation'], day_start: 2, day_end: 2 },
    'https://ourtrips.to'
  );

  assert.equal(ranged.days.length, 1);
  assert.equal(ranged.days[0].day_number, 2);
  assert.deepEqual(Object.keys(ranged.days[0]).sort(), [
    'accommodation',
    'date',
    'day_number',
    'description',
    'description_title',
    'hero_image',
    'subtitle',
    'title',
  ]);
});

test('formatTripLogisticsLedgerForRead wraps the canonical ledger with trip metadata', () => {
  const ledger = formatTripLogisticsLedgerForRead(
    fixtureRecord(),
    'https://ourtrips.to'
  );

  assert.equal(ledger.trip_id, 'trip-1');
  assert.equal(ledger.url, 'https://ourtrips.to/t/abc123');
  assert.equal(ledger.trip_name, 'London by Rail');
  assert.equal(ledger.direct_answers.trip_starts_on, '2026-07-01');
  assert.equal(ledger.direct_answers.trip_ends_on, '2026-07-03');
  assert.equal(ledger.direct_answers.expected_itinerary_day_count, 3);
  assert.equal(ledger.direct_answers.itinerary_day_count, 2);
  assert.equal(ledger.status, 'needs_repair');
});

test('upsertDayItemInTripData updates train journeys without replacing the transport array', () => {
  const data = fixtureData();

  const result = upsertDayItemInTripData(data, {
    kind: 'transport',
    day_number: 1,
    match: { label: 'Eurostar' },
    item: {
      label: 'Eurostar',
      detail: { seats: '12A and 12B' },
    },
  });

  assert.deepEqual(result.changed_paths, ['days[day_number=1].transport[0]']);
  assert.equal(data.days[0].transport[0].detail.platform, '15');
  assert.equal(data.days[0].transport[0].detail.seats, '12A and 12B');
});

test('upsertDayItemInTripData can update a hotel across matching stay days', () => {
  const data = fixtureData();

  const result = upsertDayItemInTripData(data, {
    kind: 'accommodation',
    day_number: 1,
    scope: 'matching_accommodation_name',
    item: {
      detail: { phone: '+44 20 0000 0000' },
      status: 'booked',
    },
  });

  assert.deepEqual(result.changed_paths, [
    'days[day_number=1].accommodation',
    'days[day_number=2].accommodation',
  ]);
  assert.equal(data.days[0].accommodation?.status, 'booked');
  assert.equal(data.days[1].accommodation?.status, 'booked');
  assert.equal(data.days[1].accommodation?.detail?.phone, '+44 20 0000 0000');
});

test('upsertDayItemInTripData requires day-scoped accommodation matches to match the target day', () => {
  const data = fixtureData();

  assert.throws(
    () => upsertDayItemInTripData(data, {
      kind: 'accommodation',
      day_number: 1,
      match: { name: 'Different Hotel' },
      item: {
        status: 'booked',
      },
    }),
    (err) => err instanceof TripServiceError
      && err.status === 404
      && /Accommodation not found/.test(err.message)
  );

  assert.equal(data.days[0].accommodation?.status, 'considering');
});

test('syncMarkdownSourceForUser adds an updated_at guard when expected hash is supplied', async () => {
  const trip = {
    ...fixtureRecord(),
    user_id: 'user-1',
  };
  const updateEqCalls: Array<[string, string]> = [];
  let isUpdateQuery = false;
  const admin = {
    from(table: string) {
      if (table === 'trip_accommodation_reviews') {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: null, error: null }),
          upsert: async () => ({ error: null }),
        };
      }

      assert.equal(table, 'trips');
      return {
        select() { return this; },
        eq(column: string, value: string) {
          if (isUpdateQuery) {
            updateEqCalls.push([column, value]);
          }
          return this;
        },
        update() {
          isUpdateQuery = true;
          return this;
        },
        single: async () => {
          if (isUpdateQuery) {
            return {
              data: {
                ...trip,
                updated_at: '2026-06-03T00:00:00.000Z',
                data: {
                  ...trip.data,
                  markdown_source: '# Updated plan',
                },
              },
              error: null,
            };
          }

          return { data: trip, error: null };
        },
      };
    },
  };

  const result = await syncMarkdownSourceForUser(
    admin as never,
    'user-1',
    'trip-1',
    {
      markdown_source: '# Updated plan',
      expected_current_hash: hashMarkdownSource(trip.data.markdown_source),
    },
    'https://ourtrips.to'
  );

  assert.equal(result.summary.markdown_source.previous_sha256, hashMarkdownSource(trip.data.markdown_source));
  assert.deepEqual(updateEqCalls, [
    ['id', 'trip-1'],
    ['user_id', 'user-1'],
    ['updated_at', '2026-06-02T00:00:00.000Z'],
  ]);
});

test('deleteDayItemInTripData removes tourist sites and attractions by title', () => {
  const data = fixtureData();

  const result = deleteDayItemInTripData(data, {
    kind: 'activity',
    day_number: 1,
    match: { title: 'Frick Collection' },
  });

  assert.deepEqual(result.changed_paths, ['days[day_number=1].blocks[0]']);
  assert.equal(data.days[0].blocks.length, 0);
});

test('deleteDayItemInTripData requires day-scoped accommodation matches to match the target day', () => {
  const data = fixtureData();

  assert.throws(
    () => deleteDayItemInTripData(data, {
      kind: 'accommodation',
      day_number: 1,
      match: { name: 'Different Hotel' },
    }),
    (err) => err instanceof TripServiceError
      && err.status === 404
      && /Accommodation not found/.test(err.message)
  );

  assert.equal(data.days[0].accommodation?.name, 'Town Hall Hotel');
});

test('patchTripForUserWithResult rejects replacement paths that corrupt required trip shape', async () => {
  const trip = {
    ...fixtureRecord(),
    user_id: 'user-1',
  };
  let updateCalled = false;
  const admin = {
    from(table: string) {
      assert.equal(table, 'trips');
      return {
        select() { return this; },
        eq() { return this; },
        update() {
          updateCalled = true;
          return this;
        },
        single: async () => ({ data: trip, error: null }),
      };
    },
  };

  await assert.rejects(
    () => patchTripForUserWithResult(
      admin as never,
      'user-1',
      'trip-1',
      {
        replace_paths: [
          { path: 'days[0]', value: 'not a day object' },
        ],
      },
      'https://ourtrips.to'
    ),
    (err) => err instanceof TripServiceError
      && err.status === 400
      && /malformed after path edit/.test(err.message)
  );

  assert.equal(updateCalled, false);
});

test('replaceDaySectionInTripData replaces a whole day section intentionally', () => {
  const data = fixtureData();

  const result = replaceDaySectionInTripData(data, {
    day_number: 1,
    section: 'meals',
    value: [
      { type: 'lunch', name: 'Rochelle Canteen' },
      { type: 'dinner', name: 'Brat' },
    ],
  });

  assert.deepEqual(result.changed_paths, ['days[day_number=1].meals']);
  assert.deepEqual(
    data.days[0].meals.map((meal) => meal.name),
    ['Rochelle Canteen', 'Brat']
  );
});

test('replaceDayInTripData replaces the whole day without stale nested fields', () => {
  const data = fixtureData();
  data.days[0].accommodation = {
    name: 'Old Hotel',
    detail: { confirmation: 'OLD', parking: 'Paid garage' },
  };

  const result = replaceDayInTripData(data, {
    day_number: 1,
    day: {
      day_number: 1,
      date: '2026-07-01',
      title: 'Amsterdam to London',
      blocks: [],
      accommodation: {
        name: 'New Hotel',
        detail: { check_in: '3:00 PM', check_out: '11:00 AM' },
      },
    },
  });

  assert.deepEqual(result.changed_paths, ['days[day_number=1]']);
  assert.equal(data.days[0].accommodation?.name, 'New Hotel');
  assert.equal(data.days[0].accommodation?.detail?.confirmation, undefined);
});

test('truncateDaysAfterInTripData deletes trailing days', () => {
  const data = fixtureData();

  const result = truncateDaysAfterInTripData(data, {
    keep_through_day_number: 1,
  });

  assert.deepEqual(result.changed_paths, ['days[day_number=2]']);
  assert.deepEqual(data.days.map((day) => day.day_number), [1]);
});

test('saveTripImageAssetInTripData stores generated asset metadata', () => {
  const data = fixtureData();

  const result = saveTripImageAssetInTripData(data, {
    slot: 'cover_portrait',
    asset: {
      url: 'https://example.com/generated.png',
      prompt: 'Create a map cover',
      aspect_ratio: '9:16',
      provider: 'openai',
      model: 'gpt-image-1',
      source: 'imagegen',
    },
  });

  assert.deepEqual(result.changed_paths, ['trip.image_assets.cover_portrait']);
  assert.equal(data.trip.image_assets?.cover_portrait?.url, 'https://example.com/generated.png');
  assert.equal(summarizeTripImages(data).image_assets.cover_portrait.present, true);
});

test('trackTripImageDownload rejects non-Unsplash download URLs before fetching', async () => {
  await assert.rejects(
    () => trackTripImageDownload('https://example.com/photos/abc/download'),
    (err) => err instanceof TripServiceError
      && err.status === 400
      && /Unsplash download location/.test(err.message)
  );
});

test('setTripHeroImageForUser rejects missing day hero targets without appending days', async () => {
  const trip = {
    ...fixtureRecord(),
    user_id: 'user-1',
  };
  let updateCalled = false;
  const admin = {
    from(table: string) {
      assert.equal(table, 'trips');
      return {
        select() { return this; },
        eq() { return this; },
        update() {
          updateCalled = true;
          return this;
        },
        single: async () => ({ data: trip, error: null }),
      };
    },
  };

  await assert.rejects(
    () => setTripHeroImageForUser(
      admin as never,
      'user-1',
      'trip-1',
      {
        target: { kind: 'day', day_number: 99 },
        url: 'https://images.unsplash.com/photo-1?w=800',
      },
      'https://ourtrips.to'
    ),
    (err) => err instanceof TripServiceError
      && err.status === 404
      && /Day 99 not found/.test(err.message)
  );

  assert.equal(updateCalled, false);
  assert.deepEqual(trip.data.days.map((day) => day.day_number), [1, 2]);
});

test('verifyTripPublicDataForUser uses the configured public origin for outbound checks', async () => {
  const originalFetch = globalThis.fetch;
  const originalPublicOrigin = process.env.OURTRIPS_PUBLIC_ORIGIN;
  const trip = {
    ...fixtureRecord(),
    user_id: 'user-1',
  };
  const fetchedUrls: string[] = [];
  const admin = {
    from(table: string) {
      assert.equal(table, 'trips');
      return {
        select() { return this; },
        eq() { return this; },
        single: async () => ({ data: trip, error: null }),
      };
    },
  };

  process.env.OURTRIPS_PUBLIC_ORIGIN = 'https://ourtrips.to';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchedUrls.push(url);
    if (url.endsWith(`/api/trip-data/${trip.share_id}`)) {
      return new Response(
        JSON.stringify({
          share_id: trip.share_id,
          share_mode: trip.share_mode,
          updated_at: trip.updated_at,
          data: trip.data,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    }

    return new Response('', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }) as typeof fetch;

  try {
    const result = await verifyTripPublicDataForUser(
      admin as never,
      'user-1',
      { trip_id: 'trip-1' }
    );

    assert.equal(result.public_data_url, 'https://ourtrips.to/api/trip-data/abc123');
    assert.equal(result.url, 'https://ourtrips.to/t/abc123');
    assert.deepEqual(fetchedUrls, [
      'https://ourtrips.to/api/trip-data/abc123',
      'https://ourtrips.to/t/abc123',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPublicOrigin === undefined) {
      delete process.env.OURTRIPS_PUBLIC_ORIGIN;
    } else {
      process.env.OURTRIPS_PUBLIC_ORIGIN = originalPublicOrigin;
    }
  }
});
