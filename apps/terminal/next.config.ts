import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Monorepo note: node_modules (incl. next/) is installed at the workspace root.
  // Turbopack must be pointed at that root so it can resolve next/package.json.
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
};

export default nextConfig;
