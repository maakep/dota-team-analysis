import Link from "next/link";

interface TeamEntry {
  teamId: number;
  teamName: string | null;
  teamTag: string | null;
}

/** Horizontal tab bar for switching between scouted teams. Rendered only when
 *  the manifest has more than one team. Uses plain Next.js <Link> for static
 *  navigation — each team is a pre-rendered page. */
export function TeamSwitcher({
  teams,
  currentTeamId,
}: {
  teams: TeamEntry[];
  currentTeamId: number;
}) {
  return (
    <nav className="mb-6 flex items-center gap-1 overflow-x-auto rounded-lg border border-ink-700 bg-ink-800 p-1">
      {teams.map((t) => {
        const isCurrent = t.teamId === currentTeamId;
        const label = t.teamTag
          ? `${t.teamTag}`
          : t.teamName
            ? t.teamName
            : `Team ${t.teamId}`;
        const subtitle = t.teamTag && t.teamName ? t.teamName : null;
        return (
          <Link
            key={t.teamId}
            href={`/${t.teamId}/`}
            className={`relative flex min-w-0 shrink-0 items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              isCurrent
                ? "bg-accent-flex/15 text-ink-100 ring-1 ring-accent-flex/30"
                : "text-ink-300 hover:bg-ink-700/50 hover:text-ink-100"
            }`}
            aria-current={isCurrent ? "page" : undefined}
          >
            <span className="truncate font-semibold">{label}</span>
            {subtitle && (
              <span className="hidden truncate text-[11px] text-ink-400 sm:inline">
                {subtitle}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
