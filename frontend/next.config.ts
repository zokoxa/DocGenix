import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "three",
    "three-render-objects",
    "three-forcegraph",
    "3d-force-graph",
    "react-force-graph-3d",
  ],
};

export default nextConfig;
