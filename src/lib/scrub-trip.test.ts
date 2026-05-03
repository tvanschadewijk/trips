/**
 * Tests for scrubTripData and anchorTripToToday.
 *
 * The scrub is the only thing standing between an owner's booking refs
 * and a stranger remixing their trip — these tests are load-bearing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubTripData, anchorTripToToday, scrubAndAnchorTripData } from './scrub-trip';
import type { TripData } from './types';

function fixture(): TripData {
  return {
    trip: {
      name: 'Scotland',
      subtitle: 'West Highland Way',
      dates: { start: '2026-04-24', end: '2026-05-03' },
      travelers: ['Thijs', 'Alexli'],
      summary: 'Eurostar to London, then north.',
      hero_image: 'https://example.com/hero.jpg',
      services: [
        {
          type: 'transport',
          label: 'Eurostar',
          icon: 'train',
          provider: 'Eurostar',
          ref: 'EUROSTAR-XYZ-123',
          status: 'booked',
          price: '€180',
        },
      ],
      notes: [
        { title: 'Trip notes', content: 'Some prose with maybe a number 555-1234' },
      ],
    },
    days: [
      {
        day_number: 1,
        date: '2026-04-24',
        title: 'Amsterdam → London',
        subtitle: 'Eurostar to Hackney',
        description: 'Take the Eurostar.',
        hero_image: 'https://example.com/d1.jpg',
        blocks: [
          { time_label: 'Morning', type: 'travel', content: 'Eurostar to St Pancras' },
        ],
        transport: [
          {
            mode: 'train',
            label: 'Eurostar',
            from: 'Amsterdam Centraal',
            to: 'London St Pancras',
            depart: '07:30',
            arrive: '11:00',
            status: 'booked',
            detail: {
              class: 'Standard Premier',
              seats: '12A 12B',
              booking_ref: 'EUR-XYZ-123',
              flight: 'N/A',
              gate: '6',
              terminal: '5',
              check_in: '06:30',
              cancellation_policy: 'Non-refundable',
            },
          },
        ],
        accommodation: {
          name: 'The Crown Pub & Guesthouse',
          rating: '4.2',
          status: 'confirmed',
          nights: 2,
          price: '£140/night',
          detail: {
            address: '1 Mare Street, London E8',
            phone: '+44 20 1234 5678',
            confirmation: 'BK-CONFIRM-9999',
            check_in: '15:00',
            wifi: 'CrownGuest_2024',
          },
        },
        meals: [
          {
            type: 'dinner',
            name: 'Miga',
            status: 'reserved',
            detail: {
              address: '1 Mare St',
              phone: '+44 20 0000 0000',
              cuisine: 'Korean',
              price_range: '££',
              reservation: 'OPENTABLE-12345',
            },
          },
        ],
      },
    ],
    markdown_source: '# Trip\n\nBooking ref: EUR-XYZ-123\nPhone: +44 20 1234 5678',
  };
}

test('scrubs travelers (real names)', () => {
  const out = scrubTripData(fixture());
  assert.deepEqual(out.trip.travelers, []);
});

test('drops markdown_source entirely', () => {
  const out = scrubTripData(fixture());
  assert.equal(out.markdown_source, undefined);
});

test('drops transport detail and status', () => {
  const out = scrubTripData(fixture());
  const t = out.days[0].transport![0];
  assert.equal(t.status, undefined);
  assert.equal(t.detail, undefined);
  // High-level metadata kept
  assert.equal(t.from, 'Amsterdam Centraal');
  assert.equal(t.to, 'London St Pancras');
  assert.equal(t.depart, '07:30');
});

test('drops accommodation detail and status, keeps name + price', () => {
  const out = scrubTripData(fixture());
  const a = out.days[0].accommodation!;
  assert.equal(a.status, undefined);
  assert.equal(a.detail, undefined);
  assert.equal(a.name, 'The Crown Pub & Guesthouse');
  assert.equal(a.price, '£140/night');
});

test('keeps meal name + cuisine + price_range, drops address/phone/reservation/status', () => {
  const out = scrubTripData(fixture());
  const m = out.days[0].meals![0];
  assert.equal(m.status, undefined);
  assert.equal(m.name, 'Miga');
  assert.equal(m.detail?.cuisine, 'Korean');
  assert.equal(m.detail?.price_range, '££');
  // PII gone
  assert.equal((m.detail as Record<string, unknown> | undefined)?.address, undefined);
  assert.equal((m.detail as Record<string, unknown> | undefined)?.phone, undefined);
  assert.equal((m.detail as Record<string, unknown> | undefined)?.reservation, undefined);
});

test('drops service ref and status, keeps the rest', () => {
  const out = scrubTripData(fixture());
  const s = out.trip.services![0];
  assert.equal((s as unknown as Record<string, unknown>).ref, undefined);
  assert.equal((s as unknown as Record<string, unknown>).status, undefined);
  assert.equal(s.label, 'Eurostar');
  assert.equal(s.price, '€180');
});

test('preserves day-level structure (number, date, title, blocks, tips)', () => {
  const out = scrubTripData(fixture());
  assert.equal(out.days.length, 1);
  assert.equal(out.days[0].day_number, 1);
  assert.equal(out.days[0].date, '2026-04-24');
  assert.equal(out.days[0].title, 'Amsterdam → London');
  assert.equal(out.days[0].blocks.length, 1);
});

test('scrub is idempotent', () => {
  const once = scrubTripData(fixture());
  const twice = scrubTripData(once);
  assert.deepEqual(twice, once);
});

test('anchorTripToToday rebases trip + day dates starting today', () => {
  const out = anchorTripToToday(fixture());
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  assert.equal(out.trip.dates.start, todayStr);
  assert.equal(out.days[0].date, todayStr);
});

test('anchorTripToToday cascades day_number sequentially from 1', () => {
  const data = fixture();
  // Add a second day
  data.days.push({
    day_number: 99, // intentionally wrong
    date: '2099-01-01',
    title: 'Day 2',
    blocks: [],
  });
  const out = anchorTripToToday(data);
  assert.equal(out.days[0].day_number, 1);
  assert.equal(out.days[1].day_number, 2);
});

test('scrubAndAnchorTripData composes both', () => {
  const out = scrubAndAnchorTripData(fixture());
  assert.deepEqual(out.trip.travelers, []);
  assert.equal(out.markdown_source, undefined);
  assert.equal(out.days[0].transport![0].detail, undefined);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  assert.equal(out.trip.dates.start, today.toISOString().slice(0, 10));
});
