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
  assert.equal(preferences.pace, 'balanced');
  assert.equal(preferences.budget, 'mid_range');
  assert.deepEqual(preferences.lodging, ['Boutique hotels']);
});

test('builds compact travel reference markdown from preferences', () => {
  const preferences = normalizeTravelProfilePreferences({
    travelers: 'Alex, Thijs',
    home_base: 'Amsterdam',
    pace: 'relaxed',
    budget: 'upscale',
    food: ['Local food', 'Markets'],
    avoid: 'Long driving days',
  });

  const markdown = buildTravelReferenceMarkdown(preferences);
  assert.match(markdown, /^# Travel Profile/);
  assert.match(markdown, /Travelers: Alex, Thijs/);
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
