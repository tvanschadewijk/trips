import { Container, getContainer } from '@cloudflare/containers';

const BACKEND_INSTANCE_NAME = 'primary';
const BACKEND_PORT = 8788;

type StringEnvKey =
  | 'NODE_ENV'
  | 'PORT'
  | 'NEXT_PUBLIC_SUPABASE_URL'
  | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
  | 'NEXT_PUBLIC_SITE_URL'
  | 'SUPABASE_SERVICE_ROLE_KEY'
  | 'UNSPLASH_ACCESS_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'TRIP_CHAT_MODEL'
  | 'CLAUDE_CODE_EXECUTABLE'
  | 'CLAUDE_CONFIG_DIR'
  | 'OURTRIPS_CHAT_BACKEND_SECRET'
  | 'OPENTABLE_AFFILIATE_ID'
  | 'BOOKING_AFFILIATE_ID'
  | 'GETYOURGUIDE_PARTNER_ID';

interface ChatBackendEnv extends Partial<Record<StringEnvKey, string>> {
  CHAT_BACKEND: DurableObjectNamespace<ChatBackend>;
}

type DurableObjectProps = Record<string, never>;

const PASSTHROUGH_ENV_KEYS: StringEnvKey[] = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'UNSPLASH_ACCESS_KEY',
  'ANTHROPIC_API_KEY',
  'TRIP_CHAT_MODEL',
  'CLAUDE_CODE_EXECUTABLE',
  'CLAUDE_CONFIG_DIR',
  'OURTRIPS_CHAT_BACKEND_SECRET',
  'OPENTABLE_AFFILIATE_ID',
  'BOOKING_AFFILIATE_ID',
  'GETYOURGUIDE_PARTNER_ID',
];

export class ChatBackend extends Container<ChatBackendEnv> {
  defaultPort = BACKEND_PORT;
  sleepAfter = '30m';

  constructor(ctx: DurableObjectState<DurableObjectProps>, env: ChatBackendEnv) {
    super(ctx, env, {
      envVars: buildContainerEnv(env),
    });
  }
}

const worker = {
  async fetch(request: Request, env: ChatBackendEnv): Promise<Response> {
    const container = getContainer(env.CHAT_BACKEND, BACKEND_INSTANCE_NAME);
    return container.fetch(request);
  },
} satisfies ExportedHandler<ChatBackendEnv>;

export default worker;

function buildContainerEnv(env: ChatBackendEnv): Record<string, string> {
  const containerEnv: Record<string, string> = {
    NODE_ENV: 'production',
    PORT: String(BACKEND_PORT),
  };

  for (const key of PASSTHROUGH_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) {
      containerEnv[key] = value;
    }
  }

  return containerEnv;
}
