import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./.cre/bin/**", "./.cre/workflows/**"],
  },
};

export default nextConfig;
