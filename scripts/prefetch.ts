// Build-time data fetch. Reads TEAM_ID and STRATZ_TOKEN from env (or .env.local),
// pulls everything from STRATZ, and writes data/team.json. The Next.js app
// imports that JSON directly — no runtime API.
//
// Usage:   npm run prefetch
//          TEAM_ID=9200913 npm run prefetch
//
// Configure via .env.local (auto-loaded):
//   STRATZ_TOKEN=eyJhbG...
//   TEAM_ID=9200913

import { promises as fs } from "node:fs";
import path from "node:path";
import { buildTeamReport } from "../lib/fetch-team-data";
import { UserError } from "../lib/errors";

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
  const teamId = Number(teamIdRaw);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    throw new UserError(`TEAM_ID must be a positive integer (got: ${teamIdRaw}).`);
  }

  process.stderr.write(`» fetching team ${teamId} from STRATZ...\n`);
  const t0 = Date.now();
  const report = await buildTeamReport(teamId, token);
  const ms = Date.now() - t0;
  process.stderr.write(
    `» fetched: ${report.teamName ?? "(unnamed)"}  ${report.players.length} players  ` +
      `${report.matchesAnalyzed} matches analyzed  (${ms}ms)\n`,
  );

  const outDir = path.resolve(process.cwd(), "data");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "team.json");
  await fs.writeFile(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stderr.write(`» wrote ${path.relative(process.cwd(), outPath)}\n`);
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
