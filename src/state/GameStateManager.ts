import { GameState, Owner, CombatResult, RailwayState } from "../types";
import { stateData } from "../data/states";
import { adjacencyGraph } from "../data/adjacency";
import { stateDefenseBonus } from "../data/stateDefense";
import { railwayRoutes, RAIL_UPGRADE_COSTS, RAIL_EXPRESS_BONUS } from "../data/railways";

const PLAYER_START = ["CA"];
const AI_START = ["NY"];
const STARTING_UNITS = 10;
const NEUTRAL_UNITS = 2;

export class GameStateManager {
  public state: GameState = {};
  public railways: RailwayState[] = [];

  constructor() {
    // Initialize railways as unbuilt
    for (const route of railwayRoutes) {
      this.railways.push({ from: route.from, to: route.to, level: 0, owner: "neutral" });
    }

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

  /** Check if fromId can attack toId — adjacency or railway */
  canAttack(fromId: string, toId: string): boolean {
    const src = this.state[fromId];
    const dst = this.state[toId];
    if (!src || !dst) return false;
    if (src.owner === dst.owner) return false;
    if (src.units <= 1) return false;
    const neighbors = adjacencyGraph[fromId] ?? [];
    if (neighbors.includes(toId)) return true;
    return this.canAttackViaRail(fromId, toId);
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
    // Check railway connections
    return this.hasActiveRailway(fromId, toId, src.owner);
  }

  /** Check if fromId can attack toId — includes railway links */
  canAttackViaRail(fromId: string, toId: string): boolean {
    const src = this.state[fromId];
    const dst = this.state[toId];
    if (!src || !dst) return false;
    if (src.owner === dst.owner) return false;
    if (src.units <= 1) return false;
    // Rail attacks: attacker must own the railway and both endpoints must exist
    return this.hasActiveRailway(fromId, toId, src.owner);
  }

  // ── Railway methods ──

  /** Find a railway between two states (direction-agnostic) */
  getRailway(a: string, b: string): RailwayState | undefined {
    return this.railways.find(
      r => (r.from === a && r.to === b) || (r.from === b && r.to === a)
    );
  }

  /** Check if an active (level >= 2) railway connects two states for a given owner */
  hasActiveRailway(fromId: string, toId: string, owner: Owner): boolean {
    const rail = this.getRailway(fromId, toId);
    if (!rail || rail.level < 2) return false; // level 1 is too slow for instant move
    return rail.owner === owner;
  }

  /** Get the express bonus multiplier if the railway is level 3, else 0 */
  getRailExpressBonus(fromId: string, toId: string): number {
    const rail = this.getRailway(fromId, toId);
    if (!rail || rail.level < 3) return 0;
    return RAIL_EXPRESS_BONUS;
  }

  /** Build or upgrade a railway. Costs units from the source state. Returns true if successful. */
  buildRailway(stateId: string, targetId: string): { success: boolean; message: string } {
    const src = this.state[stateId];
    if (!src) return { success: false, message: "Invalid state" };

    const rail = this.getRailway(stateId, targetId);
    if (!rail) return { success: false, message: "No railway route exists here" };

    const nextLevel = rail.level + 1;
    if (nextLevel > 3) return { success: false, message: "Railway already at max level" };

    const cost = RAIL_UPGRADE_COSTS[nextLevel];
    if (src.units <= cost) {
      return { success: false, message: `Need ${cost} units (have ${src.units}, must keep 1)` };
    }

    // Must own both endpoint states to build/upgrade
    const otherState = rail.from === stateId ? rail.to : rail.from;
    if (this.state[otherState].owner !== src.owner) {
      return { success: false, message: "Must own both endpoints to build" };
    }

    src.units -= cost;
    rail.level = nextLevel;
    rail.owner = src.owner;

    const levelNames = ["", "Slow Rail", "Standard Rail", "Express Rail"];
    return { success: true, message: `Built ${levelNames[nextLevel]} (−${cost} units)` };
  }

  /** Get all railways involving a state */
  getRailwaysForState(stateId: string): RailwayState[] {
    return this.railways.filter(r => r.from === stateId || r.to === stateId);
  }

  /** Get all buildable railway routes for a state (owner must own both endpoints) */
  getBuildableRailways(stateId: string): RailwayState[] {
    const src = this.state[stateId];
    if (!src) return [];
    return this.railways.filter(r => {
      if (r.level >= 3) return false;
      const isEndpoint = r.from === stateId || r.to === stateId;
      if (!isEndpoint) return false;
      const otherState = r.from === stateId ? r.to : r.from;
      return this.state[otherState].owner === src.owner;
    });
  }
}
