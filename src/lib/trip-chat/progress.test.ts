import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHAT_STATUS_PHASES,
  INITIAL_CHAT_PROGRESS_MESSAGE,
  POLICY_RESEARCH_STATUS_PHASES,
  getAppliedToolProgressUpdate,
  getChatStatusPhases,
  getToolProgressUpdate,
} from './progress';

test('initial chat progress copy describes active processing', () => {
  assert.equal(INITIAL_CHAT_PROGRESS_MESSAGE, 'Reading your request...');
});

test('getChatStatusPhases uses research copy for hotel policy questions', () => {
  assert.deepEqual(
    getChatStatusPhases('confirm dog policy for all hotels'),
    POLICY_RESEARCH_STATUS_PHASES
  );
});

test('getChatStatusPhases keeps default copy for ordinary edits', () => {
  assert.deepEqual(
    getChatStatusPhases('make day 2 more relaxed'),
    DEFAULT_CHAT_STATUS_PHASES
  );
});

test('getToolProgressUpdate describes real tool activity', () => {
  assert.deepEqual(getToolProgressUpdate('mcp__trip_editor__get_date_ledger'), {
    stage: 'checking',
    action: 'check',
    object_type: 'date_ledger',
    object_label: 'Dates and stays',
    status: 'active',
    confidence: 'observed',
    message: 'Checking the date and stay ledger...',
  });
  assert.deepEqual(getToolProgressUpdate('WebSearch', { query: 'best restaurants in Amsterdam' }), {
    stage: 'researching',
    action: 'search',
    object_type: 'web_query',
    object_label: 'best restaurants in Amsterdam',
    source: 'web',
    source_label: 'Web',
    status: 'active',
    confidence: 'observed',
    message: 'Searching the web for "best restaurants in Amsterdam"...',
  });
});

test('getToolProgressUpdate includes object labels from focused trip edits', () => {
  assert.deepEqual(
    getToolProgressUpdate('mcp__trip_editor__upsert_meal', {
      day_number: 3,
      meal: { type: 'dinner', name: 'Restaurant De Kas' },
    }),
    {
      stage: 'editing',
      action: 'save',
      object_type: 'restaurant',
      object_label: 'Restaurant De Kas',
      status: 'active',
      confidence: 'observed',
      message: 'Saving Restaurant De Kas on Day 3...',
    }
  );
});

test('getAppliedToolProgressUpdate describes completed writes', () => {
  assert.deepEqual(
    getAppliedToolProgressUpdate('upsert_meal', {
      day_number: 3,
      meal: { type: 'dinner', name: 'Restaurant De Kas' },
    }),
    {
      stage: 'reviewing',
      action: 'saved',
      object_type: 'restaurant',
      object_label: 'Restaurant De Kas',
      status: 'completed',
      confidence: 'observed',
      message: 'Saved Restaurant De Kas on Day 3.',
    }
  );
});
