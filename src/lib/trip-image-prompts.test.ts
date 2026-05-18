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
      title: 'Amsterdam -> Glasgow',
      subtitle: 'Arrival in the city',
      blocks: [{ time_label: 'Evening', content: 'Walk through the West End.', type: 'walk' }],
      transport: [{ mode: 'plane', label: 'Flight', from: 'Amsterdam', to: 'Glasgow', detail: { booking_ref: 'SECRET123' } }],
      meals: [{ type: 'dinner', name: 'Ox and Finch', detail: { cuisine: 'Scottish small plates' } }],
      accommodation: { name: 'Grasshopper Hotel Glasgow', detail: { confirmation: 'PRIVATE456' } },
    },
    {
      day_number: 2,
      date: '2026-04-25',
      title: 'Glasgow -> Bridge of Orchy',
      description: 'Train north into the Highlands.',
      blocks: [{ time_label: 'Afternoon', content: 'Lochside rail views.', type: 'train' }],
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
  assert.match(prompts.cover_portrait.prompt, /Glasgow/);
  assert.match(prompts.cover_portrait.prompt, /Destination labels to render on the map/);
  assert.match(prompts.cover_portrait.prompt, /legible destination labels/);
  assert.match(prompts.cover_portrait.prompt, /lower 35%/);
  assert.match(prompts.cover_landscape.prompt, /desktop hero/);
  assert.match(prompts.social_og.prompt, /small preview sizes/);
});

test('buildTripImagePromptSet asks for itinerary stop labels, not arbitrary map text', () => {
  const prompt = buildTripImagePromptSet(fixture).cover_portrait.prompt;

  assert.match(prompt, /exact stop names from the itinerary/);
  assert.match(prompt, /no extra fictional place names/i);
  assert.doesNotMatch(prompt, /No readable text/);
  assert.doesNotMatch(prompt, /no map labels/);
});

test('buildTripImagePromptSet avoids traveler names and private booking details', () => {
  const prompt = buildTripImagePromptSet(fixture).cover_portrait.prompt;

  assert.doesNotMatch(prompt, /Tessa Private/);
  assert.doesNotMatch(prompt, /SECRET123/);
  assert.doesNotMatch(prompt, /PRIVATE456/);
});
