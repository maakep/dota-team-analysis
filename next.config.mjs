/** @type {import('next').NextConfig} */
// We deploy to GitHub Pages at https://maakep.github.io/dota-team-analysis/,
// which means every asset must be prefixed with the repo subpath. The
// `BASE_PATH` env var lets us override this (or set it to empty) when
// previewing locally or hosting somewhere else. The CI workflow exports
// `BASE_PATH=/dota-team-analysis` before `next build`.
const basePath = process.env.BASE_PATH ?? "";

const nextConfig = {
  reactStrictMode: true,
  // `output: "export"` emits a fully static `out/` directory after `next
  // build` — that's what GitHub Pages serves. All data is baked at build
  // time via scripts/prefetch.ts so there's no runtime server work.
  output: "export",
  // The static exporter can't run Next's image optimizer (it requires a
  // server). We only use plain `<img>` tags pointing at the Steam CDN, so
  // this is a no-op safety net.
  images: { unoptimized: true },
  // Pages serves the site under /dota-team-analysis on github.io, so all
  // Next-managed assets need this prefix.
  basePath,
  // Forces trailing slashes so direct hits like /dota-team-analysis/ work
  // identically to /dota-team-analysis on Pages.
  trailingSlash: true,
};

export default nextConfig;
