import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A stray lockfile in a parent folder otherwise makes Next guess the wrong workspace root.
  outputFileTracingRoot: path.join(__dirname),
  // Let phones load the dev server through an ngrok tunnel (dev only; ignored in production).
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.io"],
};

export default nextConfig;
