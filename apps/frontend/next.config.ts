import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the desktop app bundle.
  output: "standalone",
  allowedDevOrigins: process.env.LOMRA_DEV_ORIGIN ? [process.env.LOMRA_DEV_ORIGIN] : undefined,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
