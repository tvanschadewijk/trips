import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTripImagePromptSet } from './trip-image-prompts';
import type { TripData } from './types';

const fixture: TripData = {
  trip: {
    name: 'Scotland',
    subtitle: 'Highlands by rail',
    dates: { start: '2026-04-24', end: '2026-05-01' },
    travelers: ['Tessa Private'],
    summary: 'A rail-led Highland trip through Glasgow, lochs, and mountain passes.',
    hero_image: 'https://example.com/hero.jpg',
  },
  days: [
    {
      day_number: 1,
      date: '2026-04-24',
      title: 'Amsterdam -> London',
      subtitle: 'Eurostar to the city',
      blocks: [{ time_label: 'Afternoon', content: 'Train to London and a quiet first night.', type: 'train' }],
      transport: [{ mode: 'train', label: 'Eurostar', from: 'Amsterdam', to: 'London', detail: { booking_ref: 'SECRET123' } }],
      meals: [{ type: 'dinner', name: 'The Marksman', detail: { cuisine: 'London pub dinner' } }],
      accommodation: { name: 'Town Hall Hotel London', detail: { confirmation: 'PRIVATE456' } },
    },
    {
      day_number: 2,
      date: '2026-04-25',
      title: 'London -> Glasgow',
      description: 'Train north to Scotland.',
      blocks: [{ time_label: 'Afternoon', content: 'Rail journey to Glasgow.', type: 'train' }],
      transport: [{ mode: 'train', label: 'Avanti West Coast', from: 'London', to: 'Glasgow' }],
      accommodation: { name: 'Grasshopper Hotel Glasgow' },
    },
    {
      day_number: 3,
      date: '2026-04-26',
      title: 'Glasgow -> Bridge of Orchy',
      description: 'Train north into the Highlands.',
      blocks: [{ time_label: 'Afternoon', content: 'Lochside rail views.', type: 'train' }],
      transport: [{ mode: 'train', label: 'West Highland Line', from: 'Glasgow', to: 'Bridge of Orchy' }],
    },
    {
      day_number: 4,
      date: '2026-04-27',
      title: 'Bridge of Orchy -> Kingshouse',
      description: 'Start the West Highland Way walk.',
      blocks: [{ time_label: 'All day', content: 'West Highland Way stage over Rannoch Moor.', type: 'walk' }],
    },
    {
      day_number: 5,
      date: '2026-04-28',
      title: 'Kingshouse -> Kinlochleven',
      description: 'West Highland Way walking stage.',
      blocks: [{ time_label: 'All day', content: "Walk the Devil's Staircase.", type: 'walk' }],
    },
    {
      day_number: 6,
      date: '2026-04-29',
      title: 'Kinlochleven -> Fort William',
      description: 'Final West Highland Way stage.',
      blocks: [{ time_label: 'All day', content: 'Walk to Fort William.', type: 'walk' }],
    },
    {
      day_number: 7,
      date: '2026-04-30',
      title: 'Fort William -> Oban',
      description: 'Finish at the coast before returning south.',
      blocks: [{ time_label: 'Afternoon', content: 'Travel to Oban.', type: 'train' }],
      transport: [{ mode: 'train', label: 'ScotRail', from: 'Fort William', to: 'Oban' }],
    },
    {
      day_number: 8,
      date: '2026-05-01',
      title: 'Oban -> Glasgow -> Amsterdam',
      description: 'Return through Glasgow, then fly home.',
      blocks: [{ time_label: 'Evening', content: 'Return flight from Glasgow.', type: 'flight' }],
      transport: [
        { mode: 'train', label: 'ScotRail', from: 'Oban', to: 'Glasgow' },
        { mode: 'flight', label: 'Return flight', from: 'Glasgow', to: 'Amsterdam' },
      ],
    },
  ],
};

const beachFixture: TripData = {
  trip: {
    name: 'Naxos',
    subtitle: 'A slow week by the water',
    dates: { start: '2026-08-10', end: '2026-08-17' },
    travelers: ['Private Person'],
    summary: 'A beach holiday based in Naxos with relaxed swims, tavernas, and a day trip to the old town.',
    hero_image: 'https://example.com/naxos.jpg',
  },
  days: [
    {
      day_number: 1,
      date: '2026-08-10',
      title: 'Amsterdam -> Naxos',
      description: 'Travel to the island and settle in by the sea.',
      transport: [{ mode: 'flight', label: 'Flight', from: 'Amsterdam', to: 'Naxos' }],
      blocks: [{ time_label: 'Evening', content: 'Arrive at the beach villa.', type: 'arrival' }],
      accommodation: { name: 'Naxos beach villa' },
    },
    {
      day_number: 2,
      date: '2026-08-11',
      title: 'Beach day in Naxos',
      description: 'Slow swims at Plaka Beach and dinner by the water.',
      blocks: [{ time_label: 'All day', content: 'Plaka Beach, sea swims, taverna lunch.', type: 'beach' }],
    },
    {
      day_number: 3,
      date: '2026-08-12',
      title: 'Naxos Old Town',
      description: 'A compact cultural day trip.',
      blocks: [{ time_label: 'Afternoon', content: 'Walk the old town lanes.', type: 'city' }],
    },
  ],
};

test('buildTripImagePromptSet creates grounded prompts for all image slots', () => {
  const prompts = buildTripImagePromptSet(fixture);

  assert.equal(prompts.cover_portrait.aspectRatio, '9:16');
  assert.equal(prompts.cover_landscape.aspectRatio, '3:2');
  assert.equal(prompts.social_og.aspectRatio, '1.91:1');
  assert.match(prompts.cover_portrait.prompt, /Scotland/);
  assert.match(prompts.cover_portrait.prompt, /Amsterdam/);
  assert.match(prompts.cover_portrait.prompt, /London/);
  assert.match(prompts.cover_portrait.prompt, /Glasgow/);
  assert.match(prompts.cover_portrait.prompt, /Primary destination, stay, or excursion labels to render on the map/);
  assert.match(prompts.cover_portrait.prompt, /small, legible labels/);
  assert.match(prompts.cover_portrait.prompt, /Journey type and visual emphasis/);
  assert.match(prompts.cover_portrait.prompt, /lower 35%/);
  assert.match(prompts.cover_landscape.prompt, /desktop hero/);
  assert.match(prompts.social_og.prompt, /small preview sizes/);
});

test('buildTripImagePromptSet adapts to beach holidays without forcing roadtrip structure', () => {
  const prompt = buildTripImagePromptSet(beachFixture).cover_portrait.prompt;
  const primarySection = prompt.slice(
    prompt.indexOf('Primary destination, stay, or excursion labels to render on the map:'),
    prompt.indexOf('Journey type and visual emphasis:')
  );

  assert.match(prompt, /coastal or beach holiday/);
  assert.match(prompt, /beach holiday as a calm stay base with nearby beaches or excursions/);
  assert.match(prompt, /stay-base cluster, island chain, trail spine, or beach-and-excursion layout/);
  assert.match(prompt, /Do not force mountains, roads, trains, planes, or dense route lines/);
  assert.match(prompt, /Home\/departure context label, if useful:\n- Amsterdam/);
  assert.match(primarySection, /Naxos/);
  assert.match(primarySection, /Naxos Old Town/);
  assert.doesNotMatch(primarySection, /Beach day in Naxos/);
  assert.doesNotMatch(prompt, /strong central route silhouette/);
});

test('buildTripImagePromptSet asks for itinerary stop labels, not arbitrary map text', () => {
  const prompt = buildTripImagePromptSet(fixture).cover_portrait.prompt;

  assert.match(prompt, /exact names from the itinerary/);
  assert.match(prompt, /no extra fictional place names/i);
  assert.match(prompt, /stay bases, beaches, trailheads, or excursion points/);
  assert.match(prompt, /Home\/departure context label/);
  assert.match(prompt, /home\/departure context label is optional and must be smaller/i);
  assert.doesNotMatch(prompt, /No readable text/);
  assert.doesNotMatch(prompt, /no map labels/);
});

test('buildTripImagePromptSet separates home from primary destination labels', () => {
  const prompt = buildTripImagePromptSet(fixture).cover_portrait.prompt;
  const primarySection = prompt.slice(
    prompt.indexOf('Primary destination, stay, or excursion labels to render on the map:'),
    prompt.indexOf('Journey type and visual emphasis:')
  );

  assert.match(prompt, /Home\/departure context label, if useful:\n- Amsterdam/);
  assert.doesNotMatch(primarySection, /Amsterdam/);
  assert.match(primarySection, /London/);
  assert.match(primarySection, /Glasgow/);
  assert.match(primarySection, /Bridge of Orchy/);
  assert.match(primarySection, /Kingshouse/);
  assert.match(primarySection, /Kinlochleven/);
  assert.match(primarySection, /Fort William/);
  assert.match(primarySection, /Oban/);
});

test('buildTripImagePromptSet preserves transport modes and walking stages', () => {
  const prompt = buildTripImagePromptSet(fixture).cover_portrait.prompt;

  assert.match(prompt, /Transport cues to respect:/);
  assert.match(prompt, /rail journey/);
  assert.match(prompt, /walking or hiking trail/);
  assert.match(prompt, /train: Amsterdam -> London/);
  assert.match(prompt, /train: London -> Glasgow/);
  assert.match(prompt, /flight: Glasgow -> Amsterdam/);
  assert.match(prompt, /Walking or hiking stages to visualize:/);
  assert.match(prompt, /Bridge of Orchy -> Kingshouse/);
  assert.match(prompt, /Kingshouse -> Kinlochleven/);
  assert.match(prompt, /Kinlochleven -> Fort William/);
  assert.match(prompt, /Do not show airplanes on train legs/);
  assert.match(prompt, /Only show an airplane when the itinerary explicitly contains a flight leg/);
});

test('buildTripImagePromptSet avoids traveler names and private booking details', () => {
  const prompt = buildTripImagePromptSet(fixture).cover_portrait.prompt;

  assert.doesNotMatch(prompt, /Tessa Private/);
  assert.doesNotMatch(prompt, /SECRET123/);
  assert.doesNotMatch(prompt, /PRIVATE456/);
});
