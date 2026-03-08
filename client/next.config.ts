import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/*": ["./.cre/bin/**", "./.cre/workflows/**"],
  },
};

export default nextConfig;
