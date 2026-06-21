export type AdminCostRange = {
  from: string | null;
  to: string | null;
};

export type AdminCostAuthUser = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
};

export type AdminCostTripRow = {
  id: string;
  user_id: string;
  created_at: string | null;
  updated_at: string | null;
};

export type AdminCostChatMessageRow = {
  id: string;
  user_id: string;
  created_at: string | null;
};

export type AdminCostUsageRow = {
  user_id: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  total_cost_usd: number | string | null;
  duration_ms: number | null;
  num_tool_calls: number | null;
  error_detail: string | null;
  created_at: string | null;
};

export type AdminCostThreadRow = {
  id: string;
  user_id: string;
  created_at: string | null;
};

export type AdminCostApiKeyRow = {
  id: string;
  user_id: string;
  created_at: string | null;
  last_used_at: string | null;
};

export type AdminCostUserSummary = {
  userId: string;
  email: string;
  createdAt: string | null;
  lastSignInAt: string | null;
  tripsCreated: number;
  chatRequests: number;
  providerRecordedTurns: number;
  providerCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  toolCalls: number;
  errorTurns: number;
  threadCount: number;
  apiKeyCount: number;
  lastApiKeyUsedAt: string | null;
  lastActivityAt: string | null;
  avgCostPerRequestUsd: number | null;
  avgCostPerTripUsd: number | null;
  avgDurationMs: number | null;
  modelBreakdown: {
    model: string;
    turns: number;
    costUsd: number;
  }[];
};

export type AdminCostDashboard = {
  range: AdminCostRange;
  generatedAt: string;
  totals: {
    users: number;
    usersWithTrips: number;
    usersWithProviderCost: number;
    tripsCreated: number;
    chatRequests: number;
    providerRecordedTurns: number;
    providerCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    totalTokens: number;
    toolCalls: number;
    errorTurns: number;
    apiKeys: number;
  };
  users: AdminCostUserSummary[];
};

export type BuildAdminCostDashboardInput = {
  range: AdminCostRange;
  users: AdminCostAuthUser[];
  trips: AdminCostTripRow[];
  chatMessages: AdminCostChatMessageRow[];
  usage: AdminCostUsageRow[];
  threads: AdminCostThreadRow[];
  apiKeys: AdminCostApiKeyRow[];
  generatedAt?: string;
};

type MutableUserSummary = Omit<
  AdminCostUserSummary,
  'avgCostPerRequestUsd' | 'avgCostPerTripUsd' | 'avgDurationMs' | 'modelBreakdown'
> & {
  durationCount: number;
  durationTotalMs: number;
  models: Map<string, { turns: number; costUsd: number }>;
};

function numeric(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function latestDate(current: string | null, next: string | null | undefined): string | null {
  if (!next) return current;
  if (!current) return next;
  return Date.parse(next) > Date.parse(current) ? next : current;
}

function createMutableSummary(user: AdminCostAuthUser): MutableUserSummary {
  return {
    userId: user.id,
    email: user.email ?? 'Unknown email',
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at,
    tripsCreated: 0,
    chatRequests: 0,
    providerRecordedTurns: 0,
    providerCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
    toolCalls: 0,
    errorTurns: 0,
    threadCount: 0,
    apiKeyCount: 0,
    lastApiKeyUsedAt: null,
    lastActivityAt: latestDate(user.last_sign_in_at, user.created_at),
    durationCount: 0,
    durationTotalMs: 0,
    models: new Map(),
  };
}

function createUnknownUser(userId: string): AdminCostAuthUser {
  return {
    id: userId,
    email: null,
    created_at: null,
    last_sign_in_at: null,
  };
}

function finalizeSummary(summary: MutableUserSummary): AdminCostUserSummary {
  const modelBreakdown = Array.from(summary.models.entries())
    .map(([model, value]) => ({ model, ...value }))
    .sort((a, b) => b.costUsd - a.costUsd || b.turns - a.turns || a.model.localeCompare(b.model));

  return {
    userId: summary.userId,
    email: summary.email,
    createdAt: summary.createdAt,
    lastSignInAt: summary.lastSignInAt,
    tripsCreated: summary.tripsCreated,
    chatRequests: summary.chatRequests,
    providerRecordedTurns: summary.providerRecordedTurns,
    providerCostUsd: summary.providerCostUsd,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    cacheCreationInputTokens: summary.cacheCreationInputTokens,
    cacheReadInputTokens: summary.cacheReadInputTokens,
    totalTokens: summary.totalTokens,
    toolCalls: summary.toolCalls,
    errorTurns: summary.errorTurns,
    threadCount: summary.threadCount,
    apiKeyCount: summary.apiKeyCount,
    lastApiKeyUsedAt: summary.lastApiKeyUsedAt,
    lastActivityAt: summary.lastActivityAt,
    avgCostPerRequestUsd:
      summary.chatRequests > 0 ? summary.providerCostUsd / summary.chatRequests : null,
    avgCostPerTripUsd:
      summary.tripsCreated > 0 ? summary.providerCostUsd / summary.tripsCreated : null,
    avgDurationMs:
      summary.durationCount > 0 ? summary.durationTotalMs / summary.durationCount : null,
    modelBreakdown,
  };
}

export function buildAdminCostDashboard(
  input: BuildAdminCostDashboardInput
): AdminCostDashboard {
  const byUser = new Map<string, MutableUserSummary>();

  function getUser(userId: string): MutableUserSummary {
    const existing = byUser.get(userId);
    if (existing) return existing;
    const created = createMutableSummary(createUnknownUser(userId));
    byUser.set(userId, created);
    return created;
  }

  for (const user of input.users) {
    byUser.set(user.id, createMutableSummary(user));
  }

  for (const trip of input.trips) {
    const summary = getUser(trip.user_id);
    summary.tripsCreated += 1;
    summary.lastActivityAt = latestDate(summary.lastActivityAt, trip.updated_at ?? trip.created_at);
  }

  for (const message of input.chatMessages) {
    const summary = getUser(message.user_id);
    summary.chatRequests += 1;
    summary.lastActivityAt = latestDate(summary.lastActivityAt, message.created_at);
  }

  for (const usage of input.usage) {
    const summary = getUser(usage.user_id);
    const cost = numeric(usage.total_cost_usd);
    const inputTokens = numeric(usage.input_tokens);
    const outputTokens = numeric(usage.output_tokens);
    const cacheCreationTokens = numeric(usage.cache_creation_input_tokens);
    const cacheReadTokens = numeric(usage.cache_read_input_tokens);
    const durationMs = numeric(usage.duration_ms);
    const toolCalls = numeric(usage.num_tool_calls);
    const model = usage.model?.trim() || 'unknown';

    summary.providerRecordedTurns += 1;
    summary.providerCostUsd += cost;
    summary.inputTokens += inputTokens;
    summary.outputTokens += outputTokens;
    summary.cacheCreationInputTokens += cacheCreationTokens;
    summary.cacheReadInputTokens += cacheReadTokens;
    summary.totalTokens += inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
    summary.toolCalls += toolCalls;
    summary.lastActivityAt = latestDate(summary.lastActivityAt, usage.created_at);

    if (usage.error_detail) {
      summary.errorTurns += 1;
    }
    if (durationMs > 0) {
      summary.durationCount += 1;
      summary.durationTotalMs += durationMs;
    }

    const modelSummary = summary.models.get(model) ?? { turns: 0, costUsd: 0 };
    modelSummary.turns += 1;
    modelSummary.costUsd += cost;
    summary.models.set(model, modelSummary);
  }

  for (const thread of input.threads) {
    const summary = getUser(thread.user_id);
    summary.threadCount += 1;
    summary.lastActivityAt = latestDate(summary.lastActivityAt, thread.created_at);
  }

  for (const apiKey of input.apiKeys) {
    const summary = getUser(apiKey.user_id);
    summary.apiKeyCount += 1;
    summary.lastApiKeyUsedAt = latestDate(summary.lastApiKeyUsedAt, apiKey.last_used_at);
    summary.lastActivityAt = latestDate(
      summary.lastActivityAt,
      apiKey.last_used_at ?? apiKey.created_at
    );
  }

  const users = Array.from(byUser.values())
    .map(finalizeSummary)
    .sort((a, b) => {
      return (
        b.providerCostUsd - a.providerCostUsd ||
        b.chatRequests - a.chatRequests ||
        b.tripsCreated - a.tripsCreated ||
        a.email.localeCompare(b.email)
      );
    });

  const totals = users.reduce<AdminCostDashboard['totals']>(
    (acc, user) => {
      acc.users += 1;
      acc.usersWithTrips += user.tripsCreated > 0 ? 1 : 0;
      acc.usersWithProviderCost += user.providerCostUsd > 0 ? 1 : 0;
      acc.tripsCreated += user.tripsCreated;
      acc.chatRequests += user.chatRequests;
      acc.providerRecordedTurns += user.providerRecordedTurns;
      acc.providerCostUsd += user.providerCostUsd;
      acc.inputTokens += user.inputTokens;
      acc.outputTokens += user.outputTokens;
      acc.cacheCreationInputTokens += user.cacheCreationInputTokens;
      acc.cacheReadInputTokens += user.cacheReadInputTokens;
      acc.totalTokens += user.totalTokens;
      acc.toolCalls += user.toolCalls;
      acc.errorTurns += user.errorTurns;
      acc.apiKeys += user.apiKeyCount;
      return acc;
    },
    {
      users: 0,
      usersWithTrips: 0,
      usersWithProviderCost: 0,
      tripsCreated: 0,
      chatRequests: 0,
      providerRecordedTurns: 0,
      providerCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
      toolCalls: 0,
      errorTurns: 0,
      apiKeys: 0,
    }
  );

  return {
    range: input.range,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    totals,
    users,
  };
}
