import { GameState, Owner, CombatResult } from "../types";
import { stateData } from "../data/states";
import { adjacencyGraph } from "../data/adjacency";
import { stateDefenseBonus } from "../data/stateDefense";

const PLAYER_START = ["CA", "OR", "WA", "NV", "ID"];
const AI_START = ["NY", "PA", "NJ", "CT", "MA"];
const STARTING_UNITS = 5;
const NEUTRAL_UNITS = 2;

export class GameStateManager {
  public state: GameState = {};

  constructor() {
    for (const s of stateData) {
      let owner: Owner = "neutral";
      let units = NEUTRAL_UNITS;

      if (PLAYER_START.includes(s.id)) {
        owner = "player";
        units = STARTING_UNITS;
      } else if (AI_START.includes(s.id)) {
        owner = "ai";
        units = STARTING_UNITS;
      }

      this.state[s.id] = { owner, units };
    }
  }

  getOwner(stateId: string): Owner {
    return this.state[stateId].owner;
  }

  getUnits(stateId: string): number {
    return this.state[stateId].units;
  }

  getDefenseBonus(stateId: string): number {
    return stateDefenseBonus[stateId] ?? 1.0;
  }

  /** Move units between friendly states. Must leave at least 1 behind. */
  moveUnits(from: string, to: string, count: number): boolean {
    const src = this.state[from];
    const dst = this.state[to];
    if (!src || !dst) return false;
    if (src.owner !== dst.owner) return false;
    if (count < 1 || count >= src.units) return false;

    src.units -= count;
    dst.units += count;
    return true;
  }

  /**
   * Resolve combat: attacker sends `attackers` units against a target state.
   *
   * Combat math:
   * - Effective defense = floor(defenderUnits * defenseBonus)
   * - Each side inflicts casualties equal to a fraction of its strength.
   *   Attacker power  = attackers * 0.6  (attacking is harder)
   *   Defender power   = effectiveDefense * 0.7
   * - Casualties are rounded and clamped: each side loses at least 1.
   * - If defender reaches 0 or below, territory is captured.
   *   Surviving attackers = attackers - attackerLost move into the territory.
   * - If attacker is wiped out, defender keeps the territory with survivors.
   * - Minimum 1 unit remains on either side after combat.
   */
  resolveCombat(fromId: string, toId: string, attackers: number): CombatResult {
    const src = this.state[fromId];
    const dst = this.state[toId];
    const defBonus = this.getDefenseBonus(toId);
    const effectiveDefense = Math.floor(dst.units * defBonus);

    // Power: how many casualties each side inflicts
    const attackPower = attackers * 0.6;
    const defensePower = effectiveDefense * 0.7;

    // Casualties (each side loses what the other inflicts, minimum 1)
    let attackerLost = Math.max(1, Math.round(defensePower));
    let defenderLost = Math.max(1, Math.round(attackPower));

    // Clamp to actual units
    attackerLost = Math.min(attackerLost, attackers);
    defenderLost = Math.min(defenderLost, dst.units);

    const remainingAttackers = attackers - attackerLost;
    const remainingDefenders = dst.units - defenderLost;

    const captured = remainingDefenders <= 0;

    // Apply to game state
    src.units -= attackers; // attackers already left the source

    if (captured) {
      // Attacker takes the territory; at least 1 unit moves in
      dst.owner = src.owner;
      dst.units = Math.max(1, remainingAttackers);
    } else {
      // Defender holds; survivors remain
      dst.units = Math.max(1, remainingDefenders);
    }

    // Ensure source always has at least 1
    if (src.units < 1) src.units = 1;

    return {
      attackerLost,
      defenderLost,
      captured,
      remainingAttackers: Math.max(0, remainingAttackers),
      remainingDefenders: Math.max(0, remainingDefenders),
    };
  }

  /** Check if fromId can attack toId */
  canAttack(fromId: string, toId: string): boolean {
    const src = this.state[fromId];
    const dst = this.state[toId];
    if (!src || !dst) return false;
    if (src.owner === dst.owner) return false;
    if (src.units <= 1) return false;
    const neighbors = adjacencyGraph[fromId] ?? [];
    return neighbors.includes(toId);
  }

  /** Check if fromId can move units to toId (friendly) */
  canMove(fromId: string, toId: string): boolean {
    const src = this.state[fromId];
    const dst = this.state[toId];
    if (!src || !dst) return false;
    if (src.owner !== dst.owner) return false;
    if (src.units <= 1) return false;
    const neighbors = adjacencyGraph[fromId] ?? [];
    return neighbors.includes(toId);
  }
}
