import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  // Keep the Agent SDK and its native CLI binary out of Next's bundling
  // so the platform-specific `claude` binary stays resolvable at runtime
  // on Vercel. Without this, Next bundles the SDK into the serverless
  // function and the binary is missing — surfaced as
  // "Native CLI binary for linux-x64 not found".
  serverExternalPackages: [
    '@anthropic-ai/claude-agent-sdk',
    '@anthropic-ai/claude-agent-sdk-linux-x64',
    '@anthropic-ai/claude-agent-sdk-linux-arm64',
  ],
  // Force-include the platform binary in the trace output for the chat
  // route so Vercel actually ships the file. Trace-by-import alone misses
  // optional native deps that aren't statically imported.
  outputFileTracingIncludes: {
    '/api/trips/[id]/chat': [
      './node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**',
    ],
  },
};

export default nextConfig;
