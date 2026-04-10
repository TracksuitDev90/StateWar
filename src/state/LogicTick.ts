import { GameStateManager } from "./GameStateManager";
import { AIController } from "./AIController";
import { Owner } from "../types";
import { stateBonuses } from "../data/stateBonuses";

const TICK_INTERVAL_MS = 1000;
const BASE_GEN_PER_STATE = 0.15;
const GEN_CAP = 99;
const AI_TICK_INTERVAL = 7; // AI acts every 7 ticks — deliberate pace

export type TickCallback = () => void;
export type VictoryCallback = (winner: Owner) => void;

export class LogicTick {
  private gsm: GameStateManager;
  private ai: AIController;
  private timerId: number | null = null;
  private accumulators: Record<string, number> = {};
  private onTick: TickCallback;
  private onVictory: VictoryCallback | null = null;
  private tickCount = 0;
  private victoryFired = false;

  constructor(gsm: GameStateManager, onTick: TickCallback) {
    this.gsm = gsm;
    this.ai = new AIController(gsm);
    this.onTick = onTick;

    for (const id of Object.keys(gsm.state)) {
      this.accumulators[id] = 0;
    }
  }

  setVictoryCallback(cb: VictoryCallback): void {
    this.onVictory = cb;
  }

  start(): void {
    if (this.timerId !== null) return;
    this.timerId = window.setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private tick(): void {
    this.tickCount++;
    this.gsm.tickCooldowns();

    // Unit generation for all owned states
    for (const [id, territory] of Object.entries(this.gsm.state)) {
      if (territory.owner === "neutral") continue;
      if (territory.units >= GEN_CAP) continue;

      const bonus = stateBonuses[id]?.genBonus ?? 0;
      let genRate = BASE_GEN_PER_STATE + bonus;

      // AI generates slightly slower to give player an advantage
      if (territory.owner === "ai") {
        genRate *= 0.85;
        genRate += this.ai.rubberBandBonus;
      }

      this.accumulators[id] += genRate;

      if (this.accumulators[id] >= 1) {
        const whole = Math.floor(this.accumulators[id]);
        this.accumulators[id] -= whole;
        territory.units = Math.min(GEN_CAP, territory.units + whole);
      }
    }

    // AI acts every few ticks to feel more natural
    if (this.tickCount % AI_TICK_INTERVAL === 0) {
      this.ai.update();
    }

    this.onTick();

    // Check for victory after state changes
    if (!this.victoryFired && this.onVictory) {
      const winner = this.gsm.checkVictory();
      if (winner) {
        this.victoryFired = true;
        this.stop();
        this.onVictory(winner);
      }
    }
  }

  getGenRate(stateId: string): number {
    const territory = this.gsm.state[stateId];
    if (!territory || territory.owner === "neutral") return 0;
    const bonus = stateBonuses[stateId]?.genBonus ?? 0;
    let rate = BASE_GEN_PER_STATE + bonus;
    if (territory.owner === "ai") {
      rate *= 0.85;
      rate += this.ai.rubberBandBonus;
    }
    return rate;
  }

  countStates(owner: Owner): number {
    return Object.values(this.gsm.state).filter(t => t.owner === owner).length;
  }

  countUnits(owner: Owner): number {
    return Object.values(this.gsm.state)
      .filter(t => t.owner === owner)
      .reduce((sum, t) => sum + t.units, 0);
  }

  getRubberBandBonus(): number {
    return this.ai.rubberBandBonus;
  }
}
