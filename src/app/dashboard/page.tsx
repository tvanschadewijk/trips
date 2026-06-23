import { connection } from 'next/server';
import DashboardClient from './DashboardClient';

type DashboardSearchParams = {
  agent?: string | string[];
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  await connection();

  const params = await searchParams;
  const agent = Array.isArray(params.agent) ? params.agent[0] : params.agent;

  return <DashboardClient initialAgentOpen={agent === 'new'} />;
}
