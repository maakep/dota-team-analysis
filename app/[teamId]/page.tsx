import { readFileSync } from "node:fs";
import path from "node:path";
import type { TeamReport } from "@/lib/types";
import { TeamDashboard } from "@/components/TeamDashboard";

interface TeamManifest {
  teams: Array<{ teamId: number; teamName: string | null; teamTag: string | null }>;
}

function loadManifest(): TeamManifest {
  const raw = readFileSync(path.join(process.cwd(), "data", "teams.json"), "utf8");
  return JSON.parse(raw) as TeamManifest;
}

function loadTeamReport(teamId: number): TeamReport {
  const raw = readFileSync(
    path.join(process.cwd(), "data", `team-${teamId}.json`),
    "utf8",
  );
  return JSON.parse(raw) as TeamReport;
}

export function generateStaticParams(): Array<{ teamId: string }> {
  const manifest = loadManifest();
  return manifest.teams.map((t) => ({ teamId: String(t.teamId) }));
}

export default function TeamPage({
  params,
}: {
  params: { teamId: string };
}) {
  const teamId = Number(params.teamId);
  const data = loadTeamReport(teamId);
  const manifest = loadManifest();

  return (
    <TeamDashboard
      data={data}
      teams={manifest.teams}
      currentTeamId={teamId}
    />
  );
}
