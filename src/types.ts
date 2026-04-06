export type Owner = "player" | "ai" | "neutral";

export interface TerritoryState {
  owner: Owner;
  units: number;
  wallHealth: number;  // 0 = no wall, 1-50 = level 1, 51-100 = level 2
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
  owner: Owner;   // who built/controls it
}

export interface UnitMoveEvent {
  from: string;
  to: string;
  count: number;
  owner: Owner;
}

export type MoveListener = (event: UnitMoveEvent) => void;

export interface GameEvent {
  message: string;
  owner: Owner;
  timestamp: number;
}

export type GameEventListener = (event: GameEvent) => void;
