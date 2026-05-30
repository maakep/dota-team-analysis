// Build-time data fetch. Reads TEAM_ID and STRATZ_TOKEN from env (or .env.local),
// pulls everything from STRATZ, and writes per-team JSON files + a manifest.
//
// Usage:   npm run prefetch
//          TEAM_ID=9200913 npm run prefetch
//          TEAM_ID=9200913,1234567 npm run prefetch
//
// Configure via .env.local (auto-loaded):
//   STRATZ_TOKEN=eyJhbG...
//   TEAM_ID=9200913          (single team)
//   TEAM_ID=9200913,1234567  (comma-separated for multiple teams)
//
// Output:
//   data/teams.json          — manifest listing all teams
//   data/team-{id}.json      — full TeamReport per team
//   data/team.json           — kept as alias of the first team (backwards compat)

import { promises as fs } from "node:fs";
import path from "node:path";
import { buildTeamReport } from "../lib/fetch-team-data";
import { UserError } from "../lib/errors";
import type { TeamReport } from "../lib/types";

/** Manifest written to data/teams.json. Consumed by Next.js at build time
 *  for generateStaticParams() and the team switcher component. */
interface TeamManifest {
  teams: Array<{
    teamId: number;
    teamName: string | null;
    teamTag: string | null;
  }>;
}

async function loadDotenv(): Promise<void> {
  // Tiny .env loader — avoids adding a dep just for build.
  const candidates = [".env.local", ".env"];
  for (const f of candidates) {
    try {
      const raw = await fs.readFile(path.resolve(process.cwd(), f), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
        if (!m) continue;
        const [, k, vRaw] = m;
        if (!k) continue;
        if (process.env[k] !== undefined) continue; // existing env wins
        let v = vRaw ?? "";
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        process.env[k] = v;
      }
    } catch {
      // file missing — fine
    }
  }
}

function parseTeamIds(raw: string): number[] {
  const ids: number[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) {
      throw new UserError(
        `Each TEAM_ID must be a positive integer (got: "${trimmed}" in "${raw}").`,
      );
    }
    ids.push(n);
  }
  if (ids.length === 0) {
    throw new UserError(
      `TEAM_ID is empty. Set it in .env.local (e.g. TEAM_ID=9200913 or TEAM_ID=9200913,1234567).`,
    );
  }
  return ids;
}

async function main(): Promise<void> {
  await loadDotenv();

  const token = process.env["STRATZ_TOKEN"]?.trim();
  if (!token) {
    throw new UserError(
      "STRATZ_TOKEN is missing. Put it in .env.local (see .env.local.example) or export it.",
    );
  }
  const teamIdRaw = process.env["TEAM_ID"]?.trim();
  if (!teamIdRaw) {
    throw new UserError(
      "TEAM_ID is missing. Set it in .env.local (e.g. TEAM_ID=9200913).",
    );
  }
  const teamIds = parseTeamIds(teamIdRaw);

  const outDir = path.resolve(process.cwd(), "data");
  await fs.mkdir(outDir, { recursive: true });

  const manifest: TeamManifest = { teams: [] };
  let firstReport: TeamReport | null = null;

  // Fetch teams sequentially to avoid rate-limit issues with STRATZ/OpenDota.
  for (const teamId of teamIds) {
    process.stderr.write(`\n» fetching team ${teamId} from STRATZ...\n`);
    const t0 = Date.now();
    const report = await buildTeamReport(teamId, token);
    const ms = Date.now() - t0;
    process.stderr.write(
      `» fetched: ${report.teamName ?? "(unnamed)"}  ${report.players.length} players  ` +
        `${report.matchesAnalyzed} matches analyzed  (${ms}ms)\n`,
    );

    // Write per-team JSON.
    const teamPath = path.join(outDir, `team-${teamId}.json`);
    await fs.writeFile(teamPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    process.stderr.write(`» wrote ${path.relative(process.cwd(), teamPath)}\n`);

    manifest.teams.push({
      teamId: report.teamId,
      teamName: report.teamName,
      teamTag: report.teamTag,
    });

    if (!firstReport) firstReport = report;
  }

  // Write manifest.
  const manifestPath = path.join(outDir, "teams.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  process.stderr.write(`» wrote ${path.relative(process.cwd(), manifestPath)}\n`);

  // Backwards compat: also write data/team.json as the first team.
  if (firstReport) {
    const legacyPath = path.join(outDir, "team.json");
    await fs.writeFile(legacyPath, JSON.stringify(firstReport, null, 2) + "\n", "utf8");
    process.stderr.write(`» wrote ${path.relative(process.cwd(), legacyPath)} (legacy alias)\n`);
  }

  process.stderr.write(`\n» done: ${manifest.teams.length} team(s) fetched.\n`);
}

main().catch((err: unknown) => {
  if (err instanceof UserError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(err.exitCode);
  }
  const e = err as { message?: string; stack?: string };
  process.stderr.write(`error: ${e?.message ?? String(err)}\n`);
  if (process.env["DOTA_DEBUG"]) process.stderr.write((e?.stack ?? "") + "\n");
  process.exit(1);
});
