import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemPrompt,
  buildTurnPrompt,
  detectTurnIntentLedger,
} from './prompt';

test('system prompt tells the agent to read trip context before route answers', () => {
  const prompt = buildSystemPrompt();

  assert.match(prompt, /Never tell the user you cannot access the trip file/);
  assert.match(prompt, /mcp__trip_editor__get_date_ledger/);
  assert.match(prompt, /call\s+`get_date_ledger`\s+first/);
  assert.match(prompt, /route-comparison questions/);
  assert.match(prompt, /view: "summary"/);
  assert.match(prompt, /clarifying question only after the trip read/);
});

test('system prompt requires cascading review after accommodation location edits', () => {
  const prompt = buildSystemPrompt();

  assert.match(prompt, /Cascading location edits/);
  assert.match(prompt, /cascade_review\.required/);
  assert.match(prompt, /review_day_numbers/);
  assert.match(prompt, /Do not stop after only\s+renaming the hotel/);
});

test('system prompt treats booked hotel plus restaurant request as separate intents', () => {
  const prompt = buildSystemPrompt();

  assert.match(prompt, /Intent ledger discipline/);
  assert.match(prompt, /committed trip fact first/);
  assert.match(prompt, /status: "booked"/);
  assert.match(prompt, /booking_status: "booked"/);
  assert.match(prompt, /Do not let a later restaurant/);
});

test('system prompt forbids assuming OpenTable for restaurants', () => {
  const prompt = buildSystemPrompt();

  assert.match(prompt, /Do not assume OpenTable/);
  assert.match(prompt, /opentable_verified: true/);
  assert.match(prompt, /booking channel is unverified/);
});

test('intent ledger catches booked hotel and restaurant booking request in one turn', () => {
  const message = `[The user is currently viewing Day 7 (2026-07-26) — "Novi Sad". If their question is ambiguous about which day, default to this one.]

We booked Hotel Pupin in Novi Sad for this day. Find us a nice restaurant that we can book in Novi Sad (if we need to book)`;

  const ledger = detectTurnIntentLedger(message);

  assert.deepEqual(
    ledger.map((item) => item.kind),
    [
      'confirm_accommodation_booking',
      'restaurant_recommendation',
      'restaurant_reservation_channel',
    ]
  );
  assert.equal(ledger[0].place_name, 'Hotel Pupin');
  assert.equal(ledger[0].day_number, 7);
  assert.equal(ledger[0].city, 'Novi Sad');
  assert.match(ledger[2].expected_action, /Do not assume OpenTable/);
});

test('turn prompt includes deterministic intent ledger before current message', () => {
  const prompt = buildTurnPrompt(
    [],
    `[The user is currently viewing Day 7.]

We booked Hotel Pupin in Novi Sad for this day. Find us a restaurant we can book in Novi Sad.`
  );

  assert.match(prompt, /Deterministic intent ledger/);
  assert.match(prompt, /confirm_accommodation_booking/);
  assert.match(prompt, /restaurant_recommendation/);
  assert.match(prompt, /restaurant_reservation_channel/);
  assert.match(prompt, /Completion rule/);
});
