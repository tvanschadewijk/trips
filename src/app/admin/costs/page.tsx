import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  CalendarDays,
  ChartLine,
  Database,
  DollarSign,
  MessageSquare,
  ReceiptText,
} from 'lucide-react';

import AppTopBar from '@/components/ui/AppTopBar';
import {
  buildAdminCostDashboard,
  type AdminCostApiKeyRow,
  type AdminCostAuthUser,
  type AdminCostChatMessageRow,
  type AdminCostRange,
  type AdminCostThreadRow,
  type AdminCostTripRow,
  type AdminCostUsageRow,
  type AdminCostUserSummary,
} from '@/lib/admin-costs';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import '@/styles/admin.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'User Costs - OurTrips Admin',
  robots: {
    index: false,
    follow: false,
  },
};

type PageSearchParams = Promise<{
  from?: string | string[];
  to?: string | string[];
  preset?: string | string[];
}>;

type AdminClient = ReturnType<typeof createAdminClient>;

type RangeQuery<T> = {
  range(from: number, to: number): PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;
};

const PAGE_SIZE = 1000;

const PRESETS = [
  { key: 'all', label: 'All time' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'ytd', label: 'YTD' },
] as const;

async function isAdmin(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  return data?.role === 'admin';
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isDateParam(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function rangeFromPreset(preset: string | undefined): AdminCostRange {
  const today = new Date();
  const to = isoDate(today);

  if (preset === '7d') return { from: isoDate(addDays(today, -7)), to };
  if (preset === '30d') return { from: isoDate(addDays(today, -30)), to };
  if (preset === '90d') return { from: isoDate(addDays(today, -90)), to };
  if (preset === 'ytd') return { from: `${today.getFullYear()}-01-01`, to };

  return { from: null, to: null };
}

function resolveRange(params: { from?: string; to?: string; preset?: string }): AdminCostRange {
  if (isDateParam(params.from) || isDateParam(params.to)) {
    return {
      from: isDateParam(params.from) ? params.from : null,
      to: isDateParam(params.to) ? params.to : null,
    };
  }
  return rangeFromPreset(params.preset);
}

function activePreset(params: { from?: string; to?: string; preset?: string }): string {
  if (isDateParam(params.from) || isDateParam(params.to)) return 'custom';
  return PRESETS.some((preset) => preset.key === params.preset) ? params.preset ?? 'all' : 'all';
}

function applyCreatedRange<T extends { created_at: string | null }>(
  rows: T[],
  range: AdminCostRange
): T[] {
  if (!range.from && !range.to) return rows;
  const from = range.from ? Date.parse(`${range.from}T00:00:00.000Z`) : null;
  const to = range.to ? Date.parse(`${range.to}T23:59:59.999Z`) : null;
  return rows.filter((row) => {
    if (!row.created_at) return false;
    const created = Date.parse(row.created_at);
    if (from !== null && created < from) return false;
    if (to !== null && created > to) return false;
    return true;
  });
}

type CreatedRangeCapable = {
  gte(column: string, value: string): CreatedRangeCapable;
  lte(column: string, value: string): CreatedRangeCapable;
};

function withCreatedRange<T>(query: T, range: AdminCostRange): T {
  let next = query as unknown as CreatedRangeCapable;
  if (range.from) next = next.gte('created_at', `${range.from}T00:00:00.000Z`);
  if (range.to) next = next.lte('created_at', `${range.to}T23:59:59.999Z`);
  return next as unknown as T;
}

function asRangeQuery<T>(query: unknown): RangeQuery<T> {
  return query as RangeQuery<T>;
}

async function fetchAllRows<T>(makeQuery: () => RangeQuery<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function listAllAuthUsers(admin: AdminClient): Promise<AdminCostAuthUser[]> {
  const users: AdminCostAuthUser[] = [];

  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    });
    if (error) throw new Error(error.message);

    const pageUsers = data.users.map((user) => ({
      id: user.id,
      email: user.email ?? null,
      created_at: user.created_at ?? null,
      last_sign_in_at: user.last_sign_in_at ?? null,
    }));
    users.push(...pageUsers);
    if (data.users.length < PAGE_SIZE) break;
  }

  return users;
}

async function loadCostDashboard(admin: AdminClient, range: AdminCostRange) {
  const [users, trips, chatMessages, usage, threads, apiKeys] = await Promise.all([
    listAllAuthUsers(admin),
    fetchAllRows<AdminCostTripRow>(() => {
      const query = withCreatedRange(
        admin
          .from('trips')
          .select('id, user_id, created_at, updated_at')
          .is('deleted_at', null),
        range
      ).order('created_at', { ascending: false });
      return asRangeQuery<AdminCostTripRow>(query);
    }),
    fetchAllRows<AdminCostChatMessageRow>(() => {
      const query = withCreatedRange(
        admin
          .from('trip_chat_messages')
          .select('id, user_id, created_at')
          .eq('role', 'user'),
        range
      ).order('created_at', { ascending: false });
      return asRangeQuery<AdminCostChatMessageRow>(query);
    }),
    fetchAllRows<AdminCostUsageRow>(() => {
      const query = withCreatedRange(
        admin
          .from('trip_chat_usage')
          .select(
            [
              'user_id',
              'model',
              'input_tokens',
              'output_tokens',
              'cache_creation_input_tokens',
              'cache_read_input_tokens',
              'total_cost_usd',
              'duration_ms',
              'num_tool_calls',
              'error_detail',
              'created_at',
            ].join(', ')
          ),
        range
      ).order('created_at', { ascending: false });
      return asRangeQuery<AdminCostUsageRow>(query);
    }),
    fetchAllRows<AdminCostThreadRow>(() => {
      const query = withCreatedRange(
        admin
          .from('trip_chat_sessions')
          .select('id, user_id, created_at'),
        range
      ).order('created_at', { ascending: false });
      return asRangeQuery<AdminCostThreadRow>(query);
    }),
    fetchAllRows<AdminCostApiKeyRow>(() => {
      const query = admin
        .from('api_keys')
        .select('id, user_id, created_at, last_used_at')
        .order('created_at', { ascending: false });
      return asRangeQuery<AdminCostApiKeyRow>(query);
    }),
  ]);

  return buildAdminCostDashboard({
    range,
    users,
    trips,
    chatMessages,
    usage,
    threads,
    apiKeys: applyCreatedRange(apiKeys, range),
  });
}

function presetHref(key: string): string {
  return key === 'all' ? '/admin/costs' : `/admin/costs?preset=${key}`;
}

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  const digits = value > 0 && value < 1 ? 4 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function rangeLabel(range: AdminCostRange): string {
  if (!range.from && !range.to) return 'All time';
  if (range.from && range.to) return `${range.from} to ${range.to}`;
  if (range.from) return `Since ${range.from}`;
  return `Until ${range.to}`;
}

function modelLabel(user: AdminCostUserSummary): string {
  const [model] = user.modelBreakdown;
  if (!model) return '-';
  if (user.modelBreakdown.length === 1) return model.model;
  return `${model.model} +${user.modelBreakdown.length - 1}`;
}

function CostStat({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="admin-costs-stat">
      <div className="admin-costs-stat-icon">{icon}</div>
      <div>
        <div className="admin-costs-stat-label">{label}</div>
        <div className="admin-costs-stat-value">{value}</div>
        <div className="admin-costs-stat-note">{note}</div>
      </div>
    </div>
  );
}

export default async function AdminCostsPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  const serverClient = await createClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  if (!(await isAdmin(user.id))) {
    return (
      <div className="admin admin-costs">
        <div className="admin-forbidden">
          <h2>Access denied</h2>
          <p>You don&apos;t have permission to view this page.</p>
          <Link href="/dashboard" className="admin-back-link">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const parsedParams = {
    from: one(params.from),
    to: one(params.to),
    preset: one(params.preset),
  };
  const range = resolveRange(parsedParams);
  const selectedPreset = activePreset(parsedParams);
  const admin = createAdminClient();
  const dashboard = await loadCostDashboard(admin, range);

  return (
    <div className="admin admin-costs">
      <AppTopBar
        href="/admin"
        suffix="Admin · User Costs"
        actions={
          <div className="admin-nav-links">
            <Link href="/admin" className="admin-costs-nav-link">
              <ChartLine size={15} aria-hidden="true" />
              Analytics
            </Link>
            <Link href="/admin/logistics" className="admin-costs-nav-link">
              <CalendarDays size={15} aria-hidden="true" />
              Logistics
            </Link>
          </div>
        }
      />

      <main className="admin-main admin-costs-main">
        <section className="admin-costs-hero">
          <div>
            <div className="admin-costs-overline">Provider spend</div>
            <h1>Cost by user.</h1>
            <p>
              Actual dollars come from provider-reported Claude Agent SDK usage in
              <code>trip_chat_usage.total_cost_usd</code>. Trips, requests, tokens,
              tool calls, and API keys are shown as cost drivers.
            </p>
          </div>
          <div className="admin-costs-range-card">
            <div className="admin-costs-range-label">Range</div>
            <strong>{rangeLabel(dashboard.range)}</strong>
            <span>Generated {formatDateTime(dashboard.generatedAt)}</span>
          </div>
        </section>

        <section className="admin-costs-controls" aria-label="Cost range filters">
          <div className="admin-costs-presets">
            {PRESETS.map((preset) => (
              <Link
                key={preset.key}
                href={presetHref(preset.key)}
                className={`admin-costs-preset ${selectedPreset === preset.key ? 'active' : ''}`}
              >
                {preset.label}
              </Link>
            ))}
          </div>
          <form className="admin-costs-date-form" method="get">
            <input
              type="date"
              name="from"
              aria-label="From date"
              defaultValue={range.from ?? ''}
            />
            <span>to</span>
            <input
              type="date"
              name="to"
              aria-label="To date"
              defaultValue={range.to ?? ''}
            />
            <button type="submit">Apply</button>
          </form>
        </section>

        <section className="admin-costs-stat-grid" aria-label="Cost summary">
          <CostStat
            icon={<DollarSign size={18} aria-hidden="true" />}
            label="Provider cost"
            value={formatUsd(dashboard.totals.providerCostUsd)}
            note={`${dashboard.totals.usersWithProviderCost} users with paid usage`}
          />
          <CostStat
            icon={<MessageSquare size={18} aria-hidden="true" />}
            label="Chat requests"
            value={formatNumber(dashboard.totals.chatRequests)}
            note={`${formatNumber(dashboard.totals.providerRecordedTurns)} recorded provider turns`}
          />
          <CostStat
            icon={<ReceiptText size={18} aria-hidden="true" />}
            label="Trips created"
            value={formatNumber(dashboard.totals.tripsCreated)}
            note={`${formatNumber(dashboard.totals.usersWithTrips)} users with trips`}
          />
          <CostStat
            icon={<Database size={18} aria-hidden="true" />}
            label="Tokens"
            value={formatCompact(dashboard.totals.totalTokens)}
            note={`${formatCompact(dashboard.totals.cacheReadInputTokens)} cache-read tokens`}
          />
        </section>

        <section className="admin-costs-coverage">
          <div>
            <div className="admin-costs-overline">Coverage</div>
            <h2>What is included</h2>
          </div>
          <div className="admin-costs-coverage-grid">
            <p>
              <strong>Claude Agent SDK:</strong> exact recorded cost, tokens, duration,
              tool calls, errors, and model names from completed chat turns.
            </p>
            <p>
              <strong>Fast-lane edits:</strong> counted as requests with zero provider
              cost when the app handles the edit without a model call.
            </p>
            <p>
              <strong>Unmetered here:</strong> Supabase, Cloudflare, Unsplash, Google
              Maps, and API-key route calls do not yet have per-user cost events.
            </p>
          </div>
        </section>

        <section className="admin-costs-table-card">
          <div className="admin-costs-table-header">
            <div>
              <div className="admin-costs-overline">Users</div>
              <h2>Cost leaderboard</h2>
            </div>
            <span>{formatNumber(dashboard.users.length)} users</span>
          </div>

          <div className="admin-costs-table-wrap">
            <table className="admin-costs-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Cost</th>
                  <th>Trips</th>
                  <th>Requests</th>
                  <th>Provider turns</th>
                  <th>Cost / request</th>
                  <th>Cost / trip</th>
                  <th>Tokens</th>
                  <th>Tools</th>
                  <th>Model</th>
                  <th>API keys</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.users.map((costUser) => (
                  <tr key={costUser.userId}>
                    <td>
                      <strong>{costUser.email}</strong>
                      <span>{costUser.userId}</span>
                    </td>
                    <td>{formatUsd(costUser.providerCostUsd)}</td>
                    <td>{formatNumber(costUser.tripsCreated)}</td>
                    <td>{formatNumber(costUser.chatRequests)}</td>
                    <td>
                      {formatNumber(costUser.providerRecordedTurns)}
                      {costUser.errorTurns > 0 ? (
                        <span>{formatNumber(costUser.errorTurns)} errors</span>
                      ) : null}
                    </td>
                    <td>{formatUsd(costUser.avgCostPerRequestUsd)}</td>
                    <td>{formatUsd(costUser.avgCostPerTripUsd)}</td>
                    <td>
                      {formatCompact(costUser.totalTokens)}
                      <span>
                        {formatCompact(costUser.inputTokens)} in /{' '}
                        {formatCompact(costUser.outputTokens)} out
                      </span>
                    </td>
                    <td>{formatNumber(costUser.toolCalls)}</td>
                    <td>{modelLabel(costUser)}</td>
                    <td>
                      {formatNumber(costUser.apiKeyCount)}
                      {costUser.lastApiKeyUsedAt ? (
                        <span>Used {formatDateTime(costUser.lastApiKeyUsedAt)}</span>
                      ) : null}
                    </td>
                    <td>{formatDateTime(costUser.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
