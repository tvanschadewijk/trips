import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAdminCostDashboard } from './admin-costs';

test('buildAdminCostDashboard rolls provider cost and activity up per user', () => {
  const dashboard = buildAdminCostDashboard({
    range: { from: null, to: null },
    generatedAt: '2026-06-20T10:00:00.000Z',
    users: [
      {
        id: 'user-a',
        email: 'a@example.com',
        created_at: '2026-01-01T00:00:00.000Z',
        last_sign_in_at: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'user-b',
        email: 'b@example.com',
        created_at: '2026-01-02T00:00:00.000Z',
        last_sign_in_at: null,
      },
    ],
    trips: [
      {
        id: 'trip-1',
        user_id: 'user-a',
        created_at: '2026-06-10T00:00:00.000Z',
        updated_at: '2026-06-11T00:00:00.000Z',
      },
      {
        id: 'trip-2',
        user_id: 'user-a',
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-13T00:00:00.000Z',
      },
    ],
    chatMessages: [
      { id: 'msg-1', user_id: 'user-a', created_at: '2026-06-14T00:00:00.000Z' },
      { id: 'msg-2', user_id: 'user-a', created_at: '2026-06-15T00:00:00.000Z' },
      { id: 'msg-3', user_id: 'user-b', created_at: '2026-06-16T00:00:00.000Z' },
    ],
    usage: [
      {
        user_id: 'user-a',
        model: 'claude-test',
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 25,
        total_cost_usd: '0.123456',
        duration_ms: 1200,
        num_tool_calls: 3,
        error_detail: null,
        created_at: '2026-06-14T00:01:00.000Z',
      },
      {
        user_id: 'user-a',
        model: 'fast-lane-v1',
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        total_cost_usd: 0,
        duration_ms: 100,
        num_tool_calls: 1,
        error_detail: null,
        created_at: '2026-06-15T00:01:00.000Z',
      },
      {
        user_id: 'user-b',
        model: null,
        input_tokens: null,
        output_tokens: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        total_cost_usd: null,
        duration_ms: null,
        num_tool_calls: null,
        error_detail: 'transient failure',
        created_at: '2026-06-16T00:01:00.000Z',
      },
    ],
    threads: [
      { id: 'thread-1', user_id: 'user-a', created_at: '2026-06-14T00:00:00.000Z' },
    ],
    apiKeys: [
      {
        id: 'key-1',
        user_id: 'user-a',
        created_at: '2026-06-01T00:00:00.000Z',
        last_used_at: '2026-06-19T00:00:00.000Z',
      },
    ],
  });

  assert.equal(dashboard.generatedAt, '2026-06-20T10:00:00.000Z');
  assert.equal(dashboard.totals.users, 2);
  assert.equal(dashboard.totals.tripsCreated, 2);
  assert.equal(dashboard.totals.chatRequests, 3);
  assert.equal(dashboard.totals.providerRecordedTurns, 3);
  assert.equal(dashboard.totals.providerCostUsd, 0.123456);
  assert.equal(dashboard.totals.totalTokens, 185);
  assert.equal(dashboard.totals.errorTurns, 1);

  const [first] = dashboard.users;
  assert.equal(first.userId, 'user-a');
  assert.equal(first.tripsCreated, 2);
  assert.equal(first.chatRequests, 2);
  assert.equal(first.providerRecordedTurns, 2);
  assert.equal(first.providerCostUsd, 0.123456);
  assert.equal(first.avgCostPerRequestUsd, 0.061728);
  assert.equal(first.avgCostPerTripUsd, 0.061728);
  assert.equal(first.avgDurationMs, 650);
  assert.equal(first.modelBreakdown[0].model, 'claude-test');
  assert.equal(first.modelBreakdown[1].model, 'fast-lane-v1');
  assert.equal(first.lastApiKeyUsedAt, '2026-06-19T00:00:00.000Z');
});

test('buildAdminCostDashboard creates rows for activity from missing auth users', () => {
  const dashboard = buildAdminCostDashboard({
    range: { from: '2026-06-01', to: '2026-06-20' },
    users: [],
    trips: [
      {
        id: 'trip-1',
        user_id: 'deleted-user',
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      },
    ],
    chatMessages: [],
    usage: [],
    threads: [],
    apiKeys: [],
  });

  assert.equal(dashboard.totals.users, 1);
  assert.equal(dashboard.users[0].userId, 'deleted-user');
  assert.equal(dashboard.users[0].email, 'Unknown email');
  assert.equal(dashboard.users[0].tripsCreated, 1);
  assert.equal(dashboard.users[0].avgCostPerRequestUsd, null);
  assert.equal(dashboard.users[0].avgCostPerTripUsd, 0);
});
