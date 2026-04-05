import { GameStateManager } from "./GameStateManager";
import { adjacencyGraph } from "../data/adjacency";
import { stateBonuses } from "../data/stateBonuses";

// AI decision-making runs once per logic tick.
// Heuristic rules:
//   1. Expand: attack weak neutral/enemy neighbors when we have a clear advantage
//   2. Reinforce: shore up border states that are exposed to enemy territory
//   3. Consolidate: move units from safe interior states toward the front line
//   4. Build rails: invest in railways when flush with units
//
// Rubber-banding: track player units-per-minute and slightly boost AI gen
// if the player is pulling too far ahead.

const AI_OWNER = "ai" as const;
const PLAYER_OWNER = "player" as const;

const ATTACK_THRESHOLD = 1.8;    // attack if we have 1.8× the effective defense
const CONSOLIDATE_THRESHOLD = 8; // interior states above this send units forward
const RAIL_BUILD_THRESHOLD = 15; // only build rails when source state has 15+ units

// Rubber-banding
const RUBBERBAND_CHECK_INTERVAL = 10; // check every 10 ticks
const RUBBERBAND_MAX_BONUS = 0.3;     // max extra gen per state per tick

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

    // Phase 3: Build railways if we have spare units
    this.phaseBuildRails(aiStates);
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
        const attackers = units - 1;

        // Only attack if we have a clear advantage
        if (attackers < effectiveDef * ATTACK_THRESHOLD) continue;

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
      const neighbors = adjacencyGraph[stateId] ?? [];
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

  // ── Railway Phase ──

  private phaseBuildRails(aiStates: string[]): void {
    // Only build if AI is doing well (has 5+ states)
    if (aiStates.length < 5) return;

    for (const stateId of aiStates) {
      const units = this.gsm.getUnits(stateId);
      if (units < RAIL_BUILD_THRESHOLD) continue;

      // Find an AI-owned state that isn't already connected by rail
      for (const targetId of aiStates) {
        if (targetId === stateId) continue;
        if (this.gsm.getRailway(stateId, targetId)) continue;
        // Prefer connecting to border states
        if (!this.isBorderState(targetId)) continue;

        const result = this.gsm.buildRailway(stateId, targetId);
        if (result.success) return; // only one build per tick
      }
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
      const owner = this.gsm.getOwner(n);
      return owner !== AI_OWNER;
    });
  }

  private isBorderState(stateId: string): boolean {
    const neighbors = adjacencyGraph[stateId] ?? [];
    return neighbors.some(n => this.gsm.getOwner(n) !== AI_OWNER);
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
