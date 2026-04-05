import { GameState, Owner, CombatResult, RailwayState, MoveListener, UnitMoveEvent } from "../types";
import { stateData } from "../data/states";
import { adjacencyGraph } from "../data/adjacency";
import { stateDefenseBonus } from "../data/stateDefense";
import { RAIL_BUILD_COST } from "../data/railways";

const PLAYER_START = ["CA"];
const AI_START = ["NY"];
const STARTING_UNITS = 10;
const NEUTRAL_UNITS = 5;

export class GameStateManager {
  public state: GameState = {};
  public railways: RailwayState[] = [];
  private moveListeners: MoveListener[] = [];

  onMove(listener: MoveListener): void {
    this.moveListeners.push(listener);
  }

  private emitMove(event: UnitMoveEvent): void {
    for (const listener of this.moveListeners) listener(event);
  }

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
    this.emitMove({ from, to, count, owner: src.owner });
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
  resolveCombat(fromId: string, toId: string, attackers: number, skipSourceDeduction = false): CombatResult {
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
    if (!skipSourceDeduction) {
      src.units -= attackers;
      this.emitMove({ from: fromId, to: toId, count: attackers, owner: src.owner });
    }

    if (captured) {
      dst.owner = src.owner;
      dst.units = Math.max(1, remainingAttackers);
    } else {
      dst.units = Math.max(1, remainingDefenders);
    }

    if (src.units < 1) src.units = 1;

    return {
      attackerLost,
      defenderLost,
      captured,
      remainingAttackers: Math.max(0, remainingAttackers),
      remainingDefenders: Math.max(0, remainingDefenders),
    };
  }

  /** Check if fromId can attack toId — adjacency or railway */
  canAttack(fromId: string, toId: string): boolean {
    const src = this.state[fromId];
    const dst = this.state[toId];
    if (!src || !dst) return false;
    if (src.owner === dst.owner) return false;
    if (src.units <= 1) return false;
    const neighbors = adjacencyGraph[fromId] ?? [];
    if (neighbors.includes(toId)) return true;
    return this.hasRailway(fromId, toId, src.owner);
  }

  /** Check if fromId can move units to toId (friendly) — includes railway links */
  canMove(fromId: string, toId: string): boolean {
    const src = this.state[fromId];
    const dst = this.state[toId];
    if (!src || !dst) return false;
    if (src.owner !== dst.owner) return false;
    if (src.units <= 1) return false;
    const neighbors = adjacencyGraph[fromId] ?? [];
    if (neighbors.includes(toId)) return true;
    return this.hasRailway(fromId, toId, src.owner);
  }

  // ── Railway methods ──

  /** Find a railway between two states (direction-agnostic) */
  getRailway(a: string, b: string): RailwayState | undefined {
    return this.railways.find(
      r => (r.from === a && r.to === b) || (r.from === b && r.to === a)
    );
  }

  /** Check if a railway connects two states for a given owner */
  hasRailway(fromId: string, toId: string, owner: Owner): boolean {
    const rail = this.getRailway(fromId, toId);
    if (!rail) return false;
    return rail.owner === owner;
  }

  /** Build a railway between two owned states. Costs units from source. */
  buildRailway(stateId: string, targetId: string): { success: boolean; message: string } {
    const src = this.state[stateId];
    const dst = this.state[targetId];
    if (!src || !dst) return { success: false, message: "Invalid state" };

    // Check if rail already exists
    const existing = this.getRailway(stateId, targetId);
    if (existing) return { success: false, message: "Rail already built here" };

    // Must own both states
    if (dst.owner !== src.owner) {
      return { success: false, message: "Must own both states to build a rail" };
    }

    if (src.units <= RAIL_BUILD_COST) {
      return { success: false, message: `Need ${RAIL_BUILD_COST + 1}+ units (have ${src.units})` };
    }

    src.units -= RAIL_BUILD_COST;
    this.railways.push({ from: stateId, to: targetId, owner: src.owner });

    return { success: true, message: `Rail built to ${targetId} (−${RAIL_BUILD_COST} units)` };
  }

  /** Get all railways involving a state */
  getRailwaysForState(stateId: string): RailwayState[] {
    return this.railways.filter(r => r.from === stateId || r.to === stateId);
  }
}
