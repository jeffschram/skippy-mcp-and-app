import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: new URL("../..", import.meta.url).pathname,
  },
};

export default nextConfig;
