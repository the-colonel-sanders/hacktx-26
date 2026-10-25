import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A stray lockfile in a parent folder otherwise makes Next guess the wrong workspace root.
  outputFileTracingRoot: path.join(__dirname),
  // Let phones load the dev server through an ngrok tunnel or at the laptop's address on the local
  // network (`npm run dev:https`). Dev only; ignored in production.
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok-free.dev",
    "*.ngrok.app",
    "*.ngrok.io",
    "192.168.*.*",
    "10.*.*.*",
    "172.*.*.*",
  ],
};

export default nextConfig;
