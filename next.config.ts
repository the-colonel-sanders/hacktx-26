import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A stray lockfile in a parent folder otherwise makes Next guess the wrong workspace root.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
