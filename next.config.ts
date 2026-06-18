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
};

export default nextConfig;
