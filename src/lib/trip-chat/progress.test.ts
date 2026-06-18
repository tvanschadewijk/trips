import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHAT_STATUS_PHASES,
  POLICY_RESEARCH_STATUS_PHASES,
  getAppliedToolProgressUpdate,
  getChatStatusPhases,
  getToolProgressUpdate,
} from './progress';

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
    message: 'Checking the date and stay ledger...',
  });
  assert.deepEqual(getToolProgressUpdate('WebSearch'), {
    stage: 'researching',
    message: 'Searching current sources...',
  });
});

test('getAppliedToolProgressUpdate describes completed writes', () => {
  assert.deepEqual(getAppliedToolProgressUpdate('upsert_meal'), {
    stage: 'reviewing',
    message: 'Saved the meal change.',
  });
});
