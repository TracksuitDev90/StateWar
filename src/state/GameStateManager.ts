import { GameState, Owner, CombatResult, RailwayState, MoveListener, UnitMoveEvent, GameEvent, GameEventListener } from "../types";
import { stateData } from "../data/states";
import { adjacencyGraph } from "../data/adjacency";
import { stateDefenseBonus } from "../data/stateDefense";
import { RAIL_BUILD_COST } from "../data/railways";
import { sound } from "../audio/SoundManager";

// States with aerial bombing capability.
export const AERIAL_STATES = new Set(["CA", "TX", "FL", "WA", "IL", "NY"]);
// Bomb tuning
const BOMB_COST_UNITS = 3;
const BOMB_WALL_DAMAGE = 35;
const BOMB_UNIT_KILL_BASE = 2;
const BOMB_UNIT_KILL_PCT = 0.25;
const BOMB_OVERDAMAGE_COOLDOWN = 25; // ticks
const BOMB_RANGE = 420; // raw map coordinate units (centroid-to-centroid)

const PLAYER_START = ["CA"];
const AI_START = ["NY"];
const STARTING_UNITS = 10;
const NEUTRAL_UNITS = 5;

// Wall constants
const WALL_UNITS_PER_HEALTH = 1;  // 1 unit absorbed = 1 wall health
const WALL_LEVEL1_MAX = 50;
const WALL_LEVEL2_MAX = 100;
const WALL_ABSORB_RATIO = 3;     // 3 attackers consumed per 1 wall health

// State name lookup
const stateNameMap: Record<string, string> = {};
for (const s of stateData) stateNameMap[s.id] = s.name;

function centroidOf(polygon: [number, number][]): [number, number] {
  let cx = 0, cy = 0;
  for (const [x, y] of polygon) { cx += x; cy += y; }
  return [cx / polygon.length, cy / polygon.length];
}

export class GameStateManager {
  public state: GameState = {};
  public railways: RailwayState[] = [];
  private moveListeners: MoveListener[] = [];
  private gameEventListeners: GameEventListener[] = [];

  onMove(listener: MoveListener): void {
    this.moveListeners.push(listener);
  }

  onGameEvent(listener: GameEventListener): void {
    this.gameEventListeners.push(listener);
  }

  private emitMove(event: UnitMoveEvent): void {
    for (const listener of this.moveListeners) listener(event);
  }

  emitGameEvent(message: string, owner: Owner): void {
    const event: GameEvent = { message, owner, timestamp: Date.now() };
    for (const listener of this.gameEventListeners) listener(event);
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

      this.state[s.id] = { owner, units, wallHealth: 0, bombCooldown: 0 };
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
    sound.moveUnits();
    return true;
  }

  /** Decrement bomb overdamage cooldowns. Called once per logic tick. */
  tickCooldowns(): void {
    for (const t of Object.values(this.state)) {
      if (t.bombCooldown > 0) t.bombCooldown--;
    }
  }

  isOverdamaged(stateId: string): boolean {
    return (this.state[stateId]?.bombCooldown ?? 0) > 0;
  }

  /** Can `fromId` (must be aerial-capable + owned) bomb `toId`? */
  canBomb(fromId: string, toId: string): boolean {
    const src = this.state[fromId];
    const dst = this.state[toId];
    if (!src || !dst) return false;
    if (fromId === toId) return false;
    if (!AERIAL_STATES.has(fromId)) return false;
    if (src.units <= BOMB_COST_UNITS) return false;
    return this.bombDistance(fromId, toId) <= BOMB_RANGE;
  }

  /** Find any owned aerial-capable state that can bomb the target. */
  findBomberFor(targetId: string, owner: Owner): string | null {
    for (const id of AERIAL_STATES) {
      const t = this.state[id];
      if (!t || t.owner !== owner) continue;
      if (this.canBomb(id, targetId)) return id;
    }
    return null;
  }

  private bombDistance(a: string, b: string): number {
    const da = stateData.find(s => s.id === a);
    const db = stateData.find(s => s.id === b);
    if (!da || !db) return Infinity;
    const ca = centroidOf(da.polygons[0]);
    const cb = centroidOf(db.polygons[0]);
    return Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
  }

  /** Drop a bomb. Heavy wall damage, kills some units, may overdamage state. */
  dropBomb(fromId: string, toId: string): { success: boolean; message: string; wallDamage: number; unitsKilled: number; overdamaged: boolean } {
    const src = this.state[fromId];
    const dst = this.state[toId];
    if (!src || !dst) return { success: false, message: "Invalid", wallDamage: 0, unitsKilled: 0, overdamaged: false };
    if (!this.canBomb(fromId, toId)) return { success: false, message: "Out of range or no bomber", wallDamage: 0, unitsKilled: 0, overdamaged: false };

    src.units -= BOMB_COST_UNITS;

    const wallDamage = Math.min(dst.wallHealth, BOMB_WALL_DAMAGE);
    dst.wallHealth = Math.max(0, dst.wallHealth - BOMB_WALL_DAMAGE);

    const unitsKilled = Math.max(BOMB_UNIT_KILL_BASE, Math.floor(dst.units * BOMB_UNIT_KILL_PCT));
    const newUnits = dst.units - unitsKilled;
    let overdamaged = false;
    if (newUnits <= 0) {
      // Over-damaged: state survives with 1 unit but is locked from capture for a while.
      dst.units = 1;
      dst.bombCooldown = BOMB_OVERDAMAGE_COOLDOWN;
      overdamaged = true;
    } else {
      dst.units = newUnits;
      // Direct heavy hits also briefly daze the state
      if (unitsKilled >= 5) {
        dst.bombCooldown = Math.max(dst.bombCooldown, 8);
      }
    }

    sound.bomb();
    const dstName = stateNameMap[toId] ?? toId;
    const who = src.owner === "player" ? "You" : "AI";
    const tag = overdamaged ? " — OVERDAMAGED" : "";
    this.emitGameEvent(`${who} bombed ${dstName}${tag}`, src.owner);
    return {
      success: true,
      message: `Bombed ${dstName}: −${wallDamage} wall, −${unitsKilled} units${overdamaged ? " (overdamaged)" : ""}`,
      wallDamage,
      unitsKilled,
      overdamaged,
    };
  }

  /** Absorb units into wall defense. Returns amount of health added. */
  fortifyWall(stateId: string): { added: number; newHealth: number; level: number } {
    const t = this.state[stateId];
    if (!t) return { added: 0, newHealth: 0, level: 0 };

    const maxHealth = WALL_LEVEL2_MAX;
    const available = t.units - 1; // keep at least 1
    if (available <= 0) return { added: 0, newHealth: t.wallHealth, level: this.getWallLevel(stateId) };

    const room = maxHealth - t.wallHealth;
    const healthToAdd = Math.min(available * WALL_UNITS_PER_HEALTH, room);
    const unitsConsumed = Math.ceil(healthToAdd / WALL_UNITS_PER_HEALTH);

    t.units -= unitsConsumed;
    t.wallHealth += healthToAdd;

    const name = stateNameMap[stateId] ?? stateId;
    this.emitGameEvent(`${t.owner === "player" ? "You" : "AI"} fortified ${name}`, t.owner);
    sound.buildWall();

    return { added: healthToAdd, newHealth: t.wallHealth, level: this.getWallLevel(stateId) };
  }

  getWallLevel(stateId: string): number {
    const h = this.state[stateId]?.wallHealth ?? 0;
    if (h <= 0) return 0;
    if (h <= WALL_LEVEL1_MAX) return 1;
    return 2;
  }

  getWallHealth(stateId: string): number {
    return this.state[stateId]?.wallHealth ?? 0;
  }

  getWallMaxHealth(level: number): number {
    if (level <= 0) return 0;
    if (level === 1) return WALL_LEVEL1_MAX;
    return WALL_LEVEL2_MAX;
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
    const prevDstOwner: Owner = dst.owner;

    // Phase 1: Attackers must break through walls first
    let remainingAttackersAfterWall = attackers;
    let wallDamage = 0;
    if (dst.wallHealth > 0) {
      // Each wall health absorbs WALL_ABSORB_RATIO attackers
      const wallCapacity = dst.wallHealth * WALL_ABSORB_RATIO;
      const attackersUsedOnWall = Math.min(remainingAttackersAfterWall, wallCapacity);
      wallDamage = Math.ceil(attackersUsedOnWall / WALL_ABSORB_RATIO);
      remainingAttackersAfterWall -= attackersUsedOnWall;
      dst.wallHealth = Math.max(0, dst.wallHealth - wallDamage);
    }

    // Phase 2: Remaining attackers fight the garrison
    const effectiveDefense = Math.floor(dst.units * defBonus);
    let attackerLost: number;
    let defenderLost: number;
    let remainingAttackers: number;
    let remainingDefenders: number;

    if (remainingAttackersAfterWall <= 0) {
      // All attackers consumed by wall
      attackerLost = attackers;
      defenderLost = 0;
      remainingAttackers = 0;
      remainingDefenders = dst.units;
    } else {
      // Normal combat with surviving attackers
      const attackPower = remainingAttackersAfterWall * 0.6;
      const defensePower = effectiveDefense * 0.7;

      let aLost = Math.max(1, Math.round(defensePower));
      let dLost = Math.max(1, Math.round(attackPower));

      aLost = Math.min(aLost, remainingAttackersAfterWall);
      dLost = Math.min(dLost, dst.units);

      remainingAttackers = remainingAttackersAfterWall - aLost;
      remainingDefenders = dst.units - dLost;

      // Total attacker losses include those consumed by wall
      attackerLost = attackers - remainingAttackers;
      defenderLost = dLost;
    }

    let defendersEliminated = remainingDefenders <= 0;
    // Overdamaged states cannot be captured — survivors stall outside.
    if (defendersEliminated && dst.bombCooldown > 0) {
      defendersEliminated = false;
      remainingDefenders = 1;
      remainingAttackers = 0;
      attackerLost = attackers;
    }

    // Apply to game state
    if (!skipSourceDeduction) {
      src.units -= attackers;
      this.emitMove({ from: fromId, to: toId, count: attackers, owner: src.owner });
    }

    if (defendersEliminated) {
      if (remainingAttackers > 0) {
        // Surviving attackers claim the state directly
        dst.owner = src.owner;
        dst.units = remainingAttackers;
        dst.wallHealth = 0; // walls destroyed on capture
        dst.bombCooldown = 0;
      } else {
        // Exact wipe — no survivors, state goes neutral
        dst.owner = "neutral";
        dst.units = 1;
        dst.wallHealth = 0;
        dst.bombCooldown = 0;
      }
    } else {
      dst.units = Math.max(1, remainingDefenders);
    }

    if (src.units < 1) src.units = 1;

    // Emit game event for the feed
    const defenderName = stateNameMap[toId] ?? toId;
    const who = src.owner === "player" ? "You" : "AI";
    if (defendersEliminated) {
      this.emitGameEvent(`${who} captured ${defenderName}`, src.owner);
      if (src.owner === "player") {
        sound.acquireState();
      } else if (prevDstOwner === "player") {
        sound.loseState();
      } else {
        sound.acquireState();
      }
    } else {
      this.emitGameEvent(`${who} attacked ${defenderName} — repelled`, src.owner);
    }

    return {
      attackerLost,
      defenderLost,
      captured: defendersEliminated,
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
    if (dst.bombCooldown > 0) return false;
    const neighbors = adjacencyGraph[fromId] ?? [];
    if (neighbors.includes(toId)) return true;
    return this.hasRailway(fromId, toId, src.owner);
  }

  /** Check if fromId can move units to toId (friendly) — any owned state to any owned state */
  canMove(fromId: string, toId: string): boolean {
    const src = this.state[fromId];
    const dst = this.state[toId];
    if (!src || !dst) return false;
    if (src.owner !== dst.owner) return false;
    if (src.units <= 1) return false;
    return true;
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
