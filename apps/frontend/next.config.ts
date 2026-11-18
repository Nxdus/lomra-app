import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the desktop app bundle.
  output: "standalone",
  allowedDevOrigins: ["100.75.254.110"],
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
