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
};

export default nextConfig;
