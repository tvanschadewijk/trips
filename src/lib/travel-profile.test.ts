import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTravelReferenceMarkdown,
  normalizeTravelProfilePreferences,
} from './travel-profile';

test('normalizes travel profile preferences with defaults', () => {
  const preferences = normalizeTravelProfilePreferences({
    travelers: 'Alex, Thijs',
    lodging: ['Boutique hotels'],
    interests: ['Architecture', 'Food'],
  });

  assert.equal(preferences.travelers, 'Alex, Thijs');
  assert.deepEqual(
    preferences.traveler_profiles.map((profile) => profile.full_name),
    ['Alex', 'Thijs']
  );
  assert.equal(preferences.pace, 'balanced');
  assert.equal(preferences.budget, 'mid_range');
  assert.deepEqual(preferences.lodging, ['Boutique hotels']);
});

test('builds compact travel reference markdown from preferences', () => {
  const preferences = normalizeTravelProfilePreferences({
    traveler_profiles: [
      {
        full_name: 'Alex',
        date_of_birth: '1990-03-12',
        gender: 'female',
        passport_number: 'NLD1234567',
        passport_country: 'Netherlands',
        passport_expiry: '2031-04-20',
      },
      { full_name: 'Thijs' },
    ],
    home_base: 'Amsterdam',
    pace: 'relaxed',
    budget: 'upscale',
    food: ['Local food', 'Markets'],
    avoid: 'Long driving days',
  });

  const markdown = buildTravelReferenceMarkdown(preferences);
  assert.match(markdown, /^# Travel Profile/);
  assert.match(markdown, /- Travelers:\n  - Alex - date of birth 1990-03-12; gender female; passport Netherlands \*\*\*\* 4567; passport expires 2031-04-20\n  - Thijs/);
  assert.doesNotMatch(markdown, /NLD1234567/);
  assert.match(markdown, /Preferred pace: relaxed/);
  assert.match(markdown, /Food preferences: Local food, Markets/);
  assert.match(markdown, /Avoid: Long driving days/);
});

test('adds ready previous trip sources to the travel reference', () => {
  const preferences = normalizeTravelProfilePreferences({
    travelers: 'Alex, Thijs',
  });

  const markdown = buildTravelReferenceMarkdown(preferences, [
    {
      id: 'source-1',
      file_name: 'dolomites.md',
      content_type: 'text/markdown',
      status: 'ready',
      extracted_text: [
        '# Dolomites',
        'We loved boutique hotels near walkable town centers.',
        'Avoid long driving days after mountain hikes.',
        'Booked train connections worked better than rental cars.',
      ].join('\n'),
    },
    {
      id: 'source-2',
      file_name: 'pending.pdf',
      content_type: 'application/pdf',
      status: 'pending',
      extracted_text: null,
    },
  ]);

  assert.match(markdown, /## Previous Trip References/);
  assert.match(markdown, /### dolomites\.md/);
  assert.match(markdown, /boutique hotels near walkable town centers/);
  assert.match(markdown, /Avoid long driving days/);
  assert.doesNotMatch(markdown, /pending\.pdf/);
});
