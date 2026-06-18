/**
 * Smoke tests for the booking-link URL builders.
 *
 * These are pure URL builders; we check shape, escaping, and affiliate
 * passthrough. No network calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internal } from './booking-tools';

const { buildRestaurantUrl, buildHotelUrl, buildFlightUrl, buildActivityUrl } = _internal;

test('restaurant: defaults to unverified Google Maps reservation search', () => {
  const out = buildRestaurantUrl({
    name: 'Sokače',
    city: 'Novi Sad',
    country: 'Serbia',
    date: '2026-07-26',
    time: '19:30',
    party_size: 4,
  });
  assert.equal(out.platform, 'google-maps');
  assert.equal(out.verified, false);
  assert.match(out.url, /google\.com\/maps\/search/);
  assert.match(decodeURIComponent(out.url), /Sokače Novi Sad Serbia reservation/);
  assert.doesNotMatch(out.url, /opentable/i);
});

test('restaurant: uses OpenTable only when the venue was verified there', () => {
  const out = buildRestaurantUrl({
    name: 'La Trompette',
    city: 'London',
    date: '2026-04-25',
    time: '19:30',
    party_size: 4,
    opentable_verified: true,
  });
  assert.equal(out.platform, 'opentable');
  assert.equal(out.verified, true);
  assert.match(out.url, /opentable\.com\/s/);
  assert.match(out.url, /covers=4/);
  assert.match(out.url, /dateTime=2026-04-25T19%3A30%3A00/);
  assert.match(out.url, /term=La\+Trompette\+London/);
});

test('restaurant: defaults OpenTable dateTime to 19:00 when only date given', () => {
  const out = buildRestaurantUrl({
    name: 'Miga',
    date: '2026-04-25',
    opentable_verified: true,
  });
  assert.match(out.url, /dateTime=2026-04-25T19%3A00%3A00/);
});

test('restaurant: includes affiliate when verified OpenTable env set', () => {
  process.env.OPENTABLE_AFFILIATE_ID = 'aff-123';
  const out = buildRestaurantUrl({ name: 'X', opentable_verified: true });
  assert.match(out.url, /ref=aff-123/);
  delete process.env.OPENTABLE_AFFILIATE_ID;
});

test('restaurant: returns verified direct reservation URL when supplied', () => {
  const out = buildRestaurantUrl({
    name: 'Example Bistro',
    city: 'Paris',
    direct_reservation_url: 'https://example.com/reserve',
  });
  assert.equal(out.platform, 'direct');
  assert.equal(out.verified, true);
  assert.equal(out.url, 'https://example.com/reserve');
});

test('hotel: requires check_in/out, defaults guests + rooms', () => {
  const out = buildHotelUrl({
    query: 'Glasgow',
    check_in: '2026-05-02',
    check_out: '2026-05-03',
  });
  assert.equal(out.platform, 'booking.com');
  assert.match(out.url, /ss=Glasgow/);
  assert.match(out.url, /checkin=2026-05-02/);
  assert.match(out.url, /checkout=2026-05-03/);
  assert.match(out.url, /group_adults=2/);
  assert.match(out.url, /no_rooms=1/);
});

test('hotel: includes affiliate aid when env set', () => {
  process.env.BOOKING_AFFILIATE_ID = '99999';
  const out = buildHotelUrl({
    query: 'Paris',
    check_in: '2026-05-02',
    check_out: '2026-05-03',
  });
  assert.match(out.url, /aid=99999/);
  delete process.env.BOOKING_AFFILIATE_ID;
});

test('flight: roundtrip URL when return_date given', () => {
  const out = buildFlightUrl({
    origin: 'AMS',
    destination: 'LHR',
    depart_date: '2026-04-24',
    return_date: '2026-05-03',
    adults: 2,
  });
  assert.equal(out.platform, 'google-flights');
  assert.match(out.url, /google\.com\/travel\/flights/);
  assert.match(out.url, /Flights%20from%20AMS%20to%20LHR/);
  assert.match(out.url, /returning%202026-05-03/);
});

test('flight: oneway URL when no return_date', () => {
  const out = buildFlightUrl({
    origin: 'Amsterdam',
    destination: 'Paris',
    depart_date: '2026-04-24',
  });
  assert.match(out.url, /oneway/);
});

test('activity: query + city combined', () => {
  const out = buildActivityUrl({ query: 'Eiffel Tower ticket', city: 'Paris' });
  assert.equal(out.platform, 'getyourguide');
  assert.match(out.url, /q=Eiffel\+Tower\+ticket\+Paris/);
});

test('activity: passes partner_id from env', () => {
  process.env.GETYOURGUIDE_PARTNER_ID = 'pid-77';
  const out = buildActivityUrl({ query: 'wine tour' });
  assert.match(out.url, /partner_id=pid-77/);
  delete process.env.GETYOURGUIDE_PARTNER_ID;
});
