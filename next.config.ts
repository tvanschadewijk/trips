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
    // Force build-time inlining of the public Google Maps config. ItineraryMap
    // imports `@googlemaps/js-api-loader`, which references the `process` global
    // and makes Turbopack pull a `process` polyfill into that client chunk. That
    // polyfill defeats Next's automatic `process.env.NEXT_PUBLIC_*` inlining, so
    // the reads compile to a runtime `process.env` lookup that is `undefined` in
    // the browser and the map silently falls back. Declaring them here forces a
    // literal substitution at build time (same mechanism as APP_VERSION above).
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
    NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? '',
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
    // Next 16 normalizes App Router route-handler trace keys differently than
    // the public route path; matching the stable segment keeps this scoped to
    // /api/trips/[id]/chat without falling back to a global include.
    'chat': [
      './node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude',
    ],
  },
};

export default nextConfig;
