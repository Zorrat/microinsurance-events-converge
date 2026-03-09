import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./.cre/bin/**", "./.cre/lib/**", "./.cre/workflows/**"],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./.cre/workflows/**/node_modules/**",
      "./.cre/workflows/**/test/**",
      "./.cre/workflows/**/test-payloads/**",
    ],
  },
};

export default nextConfig;
