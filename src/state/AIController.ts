import { GameStateManager, AERIAL_STATES, PLANE_COST_UNITS } from "./GameStateManager";
import { adjacencyGraph } from "../data/adjacency";
import { stateBonuses } from "../data/stateBonuses";

// AI decision-making runs once per logic tick.
// Heuristic rules:
//   1. Expand: attack weak neutral/enemy neighbors when we have a clear advantage
//   2. Reinforce: shore up border states that are exposed to enemy territory
//   3. Consolidate: move units from safe interior states toward the front line
//   4. Planes: build/use planes against the player's best walled states
//
// Rubber-banding: track player units-per-minute and slightly boost AI gen
// if the player is pulling too far ahead.

const AI_OWNER = "ai" as const;
const PLAYER_OWNER = "player" as const;

const ATTACK_THRESHOLD = 3.2;    // attack only with a clear 3.2× advantage (cautious)
const CONSOLIDATE_THRESHOLD = 16; // interior states above this send units forward (slow)
const WALL_BUILD_THRESHOLD = 30; // fortify borders when 30+ units

// Rubber-banding (mild)
const RUBBERBAND_CHECK_INTERVAL = 20; // check infrequently
const RUBBERBAND_MAX_BONUS = 0.08;    // very mild extra gen per state per tick

export class AIController {
  private gsm: GameStateManager;
  private tickCount = 0;
  private playerUnitsHistory: number[] = [];
  private aiUnitsHistory: number[] = [];
  public rubberBandBonus = 0; // extra gen/tick applied by LogicTick

  constructor(gsm: GameStateManager) {
    this.gsm = gsm;
  }

  /** Called once per logic tick */
  update(): void {
    this.tickCount++;
    this.updateRubberBand();

    // Get AI-owned states sorted by units (descending) for priority actions
    const aiStates = this.getOwnedStates();
    if (aiStates.length === 0) return;

    // Phase 1: Try to attack weak neighbors
    this.phaseAttack(aiStates);

    // Phase 2: Consolidate interior units toward borders
    this.phaseConsolidate(aiStates);

    // Phase 3: Fortify border states with walls
    this.phaseFortify(aiStates);

    // Phase 4: Planes — build and drop bombs on walled player states
    this.phasePlanes(aiStates);
  }

  private phasePlanes(aiStates: string[]): void {
    // Try to build a plane at a well-supplied owned aerial state
    for (const id of aiStates) {
      if (!AERIAL_STATES.has(id)) continue;
      if (this.gsm.getPlanesAt(id).length > 0) continue;
      if (this.gsm.getUnits(id) <= PLANE_COST_UNITS + 15) continue; // need cushion
      this.gsm.producePlane(id);
      break;
    }

    // Use any available plane to bomb the player's best walled state
    const planes = this.gsm.getPlanesFor("ai");
    if (planes.length === 0) return;

    let bestTarget: string | null = null;
    let bestScore = -1;
    for (const [id, t] of Object.entries(this.gsm.state)) {
      if (t.owner !== "player") continue;
      const score = this.gsm.getWallHealth(id) * 2 + t.units;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = id;
      }
    }
    if (!bestTarget) return;
    const plane = planes[0];
    this.gsm.dropBomb(plane.homeId, bestTarget);
  }

  // ── Attack Phase ──

  private phaseAttack(aiStates: string[]): void {
    // Evaluate all possible attacks, pick the best one per tick
    let bestAttack: { from: string; to: string; score: number } | null = null;

    for (const stateId of aiStates) {
      const units = this.gsm.getUnits(stateId);
      if (units <= 2) continue; // need units to attack

      const neighbors = this.getAttackableNeighbors(stateId);
      for (const target of neighbors) {
        const defUnits = this.gsm.getUnits(target);
        const defBonus = this.gsm.getDefenseBonus(target);
        const effectiveDef = Math.floor(defUnits * defBonus);
        const wallHealth = this.gsm.getWallHealth(target);
        const attackers = units - 1;

        // Account for wall: need 3 attackers per wall health, plus enough to beat defenders
        const wallCost = wallHealth * 3;
        const effectiveNeeded = effectiveDef * ATTACK_THRESHOLD + wallCost;
        if (attackers < effectiveNeeded) continue;

        // Score: prefer weaker targets, bonus states, and enemy states over neutral
        let score = attackers / Math.max(1, effectiveDef);
        if (this.gsm.getOwner(target) === PLAYER_OWNER) score += 2; // prioritize attacking player
        if (this.isStrategicState(target)) score += 1;

        if (!bestAttack || score > bestAttack.score) {
          bestAttack = { from: stateId, to: target, score };
        }
      }
    }

    if (bestAttack) {
      const attackers = this.gsm.getUnits(bestAttack.from) - 1;
      this.gsm.resolveCombat(bestAttack.from, bestAttack.to, attackers);
    }
  }

  // ── Consolidate Phase ──

  private phaseConsolidate(aiStates: string[]): void {
    // Move units from safe interior states toward border states that need reinforcement
    for (const stateId of aiStates) {
      const units = this.gsm.getUnits(stateId);
      if (units <= CONSOLIDATE_THRESHOLD) continue;

      // Is this an interior state? (all neighbors are AI-owned)
      if (this.isBorderState(stateId)) continue;

      // Find the weakest AI neighbor that's a border state
      const neighbors = (adjacencyGraph[stateId] ?? []).filter(n => this.gsm.activeStates.has(n));
      let weakestBorder: string | null = null;
      let weakestUnits = Infinity;

      for (const n of neighbors) {
        if (this.gsm.getOwner(n) !== AI_OWNER) continue;
        if (!this.isBorderState(n)) continue;
        const nUnits = this.gsm.getUnits(n);
        if (nUnits < weakestUnits) {
          weakestUnits = nUnits;
          weakestBorder = n;
        }
      }

      // If no border neighbor, find any AI neighbor closer to a border
      if (!weakestBorder) {
        for (const n of neighbors) {
          if (this.gsm.getOwner(n) !== AI_OWNER) continue;
          const nUnits = this.gsm.getUnits(n);
          if (nUnits < weakestUnits) {
            weakestUnits = nUnits;
            weakestBorder = n;
          }
        }
      }

      if (weakestBorder) {
        const moveCount = units - 2; // keep 2 behind
        if (moveCount > 0) {
          this.gsm.moveUnits(stateId, weakestBorder, moveCount);
        }
      }
    }
  }

  // ── Fortify Phase ──

  private phaseFortify(aiStates: string[]): void {
    // Fortify border states that have enough units and face player threats
    for (const stateId of aiStates) {
      const units = this.gsm.getUnits(stateId);
      if (units < WALL_BUILD_THRESHOLD) continue;
      if (!this.isBorderState(stateId)) continue;

      // Only fortify if facing player-owned neighbors (within active level)
      const neighbors = (adjacencyGraph[stateId] ?? []).filter(n => this.gsm.activeStates.has(n));
      const facesPlayer = neighbors.some(n => this.gsm.getOwner(n) === PLAYER_OWNER);
      if (!facesPlayer) continue;

      // Don't over-fortify — only if wall level < 2
      const wallLevel = this.gsm.getWallLevel(stateId);
      if (wallLevel >= 2) continue;

      this.gsm.fortifyWall(stateId);
      return; // one fortification per tick
    }
  }

  // ── Rubber-banding ──

  private updateRubberBand(): void {
    // Track unit counts
    const playerUnits = this.totalUnits(PLAYER_OWNER);
    const aiUnits = this.totalUnits(AI_OWNER);

    this.playerUnitsHistory.push(playerUnits);
    this.aiUnitsHistory.push(aiUnits);

    // Keep last 60 ticks (1 minute)
    if (this.playerUnitsHistory.length > 60) this.playerUnitsHistory.shift();
    if (this.aiUnitsHistory.length > 60) this.aiUnitsHistory.shift();

    if (this.tickCount % RUBBERBAND_CHECK_INTERVAL !== 0) return;

    // Compare units-per-minute growth
    const playerStates = this.countStates(PLAYER_OWNER);
    const aiStateCount = this.countStates(AI_OWNER);

    if (aiStateCount === 0) {
      this.rubberBandBonus = 0;
      return;
    }

    // Ratio of player advantage
    const playerTotal = playerUnits + playerStates * 5; // weight territory ownership
    const aiTotal = aiUnits + aiStateCount * 5;
    const ratio = playerTotal / Math.max(1, aiTotal);

    // Scale bonus: kicks in when player is 1.5x ahead, maxes at 3x ahead
    if (ratio > 1.5) {
      const t = Math.min(1, (ratio - 1.5) / 1.5);
      this.rubberBandBonus = t * RUBBERBAND_MAX_BONUS;
    } else {
      this.rubberBandBonus = 0;
    }
  }

  // ── Helpers ──

  private getOwnedStates(): string[] {
    return Object.entries(this.gsm.state)
      .filter(([_, t]) => t.owner === AI_OWNER)
      .sort(([_, a], [__, b]) => b.units - a.units)
      .map(([id]) => id);
  }

  private getAttackableNeighbors(stateId: string): string[] {
    const neighbors = adjacencyGraph[stateId] ?? [];
    return neighbors.filter(n => {
      if (!this.gsm.activeStates.has(n)) return false;
      const owner = this.gsm.getOwner(n);
      return owner !== AI_OWNER;
    });
  }

  private isBorderState(stateId: string): boolean {
    const neighbors = adjacencyGraph[stateId] ?? [];
    return neighbors.some(n => this.gsm.activeStates.has(n) && this.gsm.getOwner(n) !== AI_OWNER);
  }

  private isStrategicState(stateId: string): boolean {
    return stateId in stateBonuses;
  }

  private totalUnits(owner: "player" | "ai"): number {
    return Object.values(this.gsm.state)
      .filter(t => t.owner === owner)
      .reduce((sum, t) => sum + t.units, 0);
  }

  private countStates(owner: "player" | "ai"): number {
    return Object.values(this.gsm.state).filter(t => t.owner === owner).length;
  }
}
