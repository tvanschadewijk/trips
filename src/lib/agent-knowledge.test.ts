import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAgentKnowledgeContext,
  loadKnowledgeBundle,
  routeAgentKnowledge,
  validateKnowledgeBundle,
} from './agent-knowledge';

test('knowledge bundle is OKF-parseable', () => {
  const issues = validateKnowledgeBundle();

  assert.deepEqual(issues, []);

  const bundle = loadKnowledgeBundle();
  assert.ok(bundle.byId.has('core/intent-ledger-and-completion-audit'));
  assert.ok(bundle.byId.has('ourtrips/tool-use-context'));
  assert.ok(bundle.byId.has('travel/restaurant-reservations/playbook'));
});

test('routes restaurant reservation knowledge with country context', () => {
  const route = routeAgentKnowledge({
    message: 'Find us a restaurant we can book in Novi Sad.',
    intents: [
      { kind: 'restaurant_recommendation', city: 'Novi Sad' },
      { kind: 'restaurant_reservation_channel', city: 'Novi Sad' },
    ],
  });

  const ids = route.concepts.map((concept) => concept.id);
  assert.ok(ids.includes('core/source-verification'));
  assert.ok(ids.includes('travel/restaurant-reservations/playbook'));
  assert.ok(ids.includes('travel/restaurant-reservations/platform-registry'));
  assert.ok(ids.includes('travel/restaurant-reservations/countries/RS'));
  assert.deepEqual(route.countries, ['RS']);
  assert.ok(route.completionChecks.includes('no_unsupported_platform_assumption'));
});

test('routes accommodation confirmation knowledge alongside restaurant knowledge', () => {
  const route = routeAgentKnowledge({
    message:
      'We booked Hotel Pupin in Novi Sad for this day. Find us a restaurant we can book in Novi Sad.',
    intents: [
      { kind: 'confirm_accommodation_booking', city: 'Novi Sad' },
      { kind: 'restaurant_recommendation', city: 'Novi Sad' },
      { kind: 'restaurant_reservation_channel', city: 'Novi Sad' },
    ],
  });

  const ids = route.concepts.map((concept) => concept.id);
  assert.ok(ids.includes('travel/accommodation-confirmation/playbook'));
  assert.ok(ids.includes('ourtrips/mutation-semantics'));
  assert.ok(ids.includes('travel/restaurant-reservations/countries/RS'));
  assert.ok(route.completionChecks.includes('public_accommodation_status_and_booking_status_set_to_booked'));
  assert.ok(route.completionChecks.includes('no_opentable_assumption'));
});

test('formats routed knowledge as a compact completion checklist', () => {
  const text = formatAgentKnowledgeContext(
    routeAgentKnowledge({
      message: 'Book a table in Paris.',
      intents: [{ kind: 'restaurant_reservation_channel', city: 'Paris' }],
    })
  );

  assert.match(text, /Routed task knowledge/);
  assert.match(text, /Country context detected: FR/);
  assert.match(text, /Restaurant Reservations/);
  assert.match(text, /Restaurant Reservation Platforms - France/);
  assert.match(text, /Knowledge completion rule/);
});
