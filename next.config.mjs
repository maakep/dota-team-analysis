/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No runtime server work — all data is baked at build time via scripts/prefetch.ts.
  // Static export is fine but we leave it as a normal Next build so dev mode just works.
};

export default nextConfig;
