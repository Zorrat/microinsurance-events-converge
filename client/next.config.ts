import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./.cre/bin/**", "./.cre/lib/**", "./.cre/workflows/**"],
  },
};

export default nextConfig;
