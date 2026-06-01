import type { NextConfig } from "next";
import packageJson from "./package.json";

const supabaseHostname = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  devIndicators: false,
  typescript: {
    tsconfigPath: 'tsconfig.build.json',
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      ...(supabaseHostname
        ? [
            {
              protocol: 'https' as const,
              hostname: supabaseHostname,
              pathname: '/storage/v1/object/public/**',
            },
          ]
        : []),
    ],
  },
  // Force-include only the Linux x64 Claude CLI executable for the chat route.
  // Including the whole native package pushes the function over Vercel's
  // 250 MB unzipped limit.
  outputFileTracingExcludes: {
    '/api/trips/[id]/chat': [
      './node_modules/@anthropic-ai/claude-agent-sdk-darwin-*/**',
      './node_modules/@anthropic-ai/claude-agent-sdk-win32-*/**',
      './node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64*/**',
      './node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/**',
    ],
  },
  outputFileTracingIncludes: {
    '/api/trips/[id]/chat': [
      './node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude',
    ],
  },
};

export default nextConfig;
