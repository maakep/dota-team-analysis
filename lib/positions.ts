// Dota positions 1-5. STRATZ uses these natively via MatchPlayerPositionType.

export type Position = 1 | 2 | 3 | 4 | 5;

export const ALL_POSITIONS: readonly Position[] = [1, 2, 3, 4, 5] as const;

export const POSITION_NAMES: Record<Position, string> = {
  1: "Carry",
  2: "Mid",
  3: "Offlane",
  4: "Soft Support",
  5: "Hard Support",
};

export function positionLabel(pos: Position): string {
  return `pos ${pos} (${POSITION_NAMES[pos].toLowerCase()})`;
}

export function positionShort(pos: Position): string {
  return `pos${pos}`;
}

export function stratzPositionEnum(pos: Position): string {
  return `POSITION_${pos}`;
}
