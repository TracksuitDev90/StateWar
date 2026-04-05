export type Owner = "player" | "ai" | "neutral";

export interface TerritoryState {
  owner: Owner;
  units: number;
}

export type GameState = Record<string, TerritoryState>;

export interface CombatResult {
  attackerLost: number;
  defenderLost: number;
  captured: boolean;
  remainingAttackers: number;
  remainingDefenders: number;
}

export interface RailwayState {
  from: string;
  to: string;
  level: number;  // 0 = not built, 1-3 = upgrade tiers
  owner: Owner;   // who built/controls it
}
