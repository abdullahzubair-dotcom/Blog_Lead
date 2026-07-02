import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  serverExternalPackages: ["playwright", "playwright-core", "jsdom", "@mozilla/readability"],
};

export default nextConfig;
