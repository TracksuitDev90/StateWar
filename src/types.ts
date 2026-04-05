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
