import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHAT_STATUS_PHASES,
  POLICY_RESEARCH_STATUS_PHASES,
  getChatStatusPhases,
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
