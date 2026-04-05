import { GameStateManager } from "./GameStateManager";
import { Owner } from "../types";
import { stateBonuses } from "../data/stateBonuses";

const TICK_INTERVAL_MS = 1000;
const BASE_GEN_PER_STATE = 0.3; // base units generated per owned state per tick
const GEN_CAP = 99; // max units per state

export type TickCallback = () => void;

export class LogicTick {
  private gsm: GameStateManager;
  private timerId: number | null = null;
  private accumulators: Record<string, number> = {};
  private onTick: TickCallback;

  constructor(gsm: GameStateManager, onTick: TickCallback) {
    this.gsm = gsm;
    this.onTick = onTick;

    // Initialize fractional accumulators for every state
    for (const id of Object.keys(gsm.state)) {
      this.accumulators[id] = 0;
    }
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
    for (const [id, territory] of Object.entries(this.gsm.state)) {
      if (territory.owner === "neutral") continue;
      if (territory.units >= GEN_CAP) continue;

      const bonus = stateBonuses[id]?.genBonus ?? 0;
      const genRate = BASE_GEN_PER_STATE + bonus;

      this.accumulators[id] += genRate;

      // When accumulator reaches 1+, convert to whole units
      if (this.accumulators[id] >= 1) {
        const whole = Math.floor(this.accumulators[id]);
        this.accumulators[id] -= whole;
        territory.units = Math.min(GEN_CAP, territory.units + whole);
      }
    }

    this.onTick();
  }

  /** Get the effective gen rate for a state (for UI display) */
  getGenRate(stateId: string): number {
    const territory = this.gsm.state[stateId];
    if (!territory || territory.owner === "neutral") return 0;
    const bonus = stateBonuses[stateId]?.genBonus ?? 0;
    return BASE_GEN_PER_STATE + bonus;
  }

  /** Count total states owned by a given owner */
  countStates(owner: Owner): number {
    return Object.values(this.gsm.state).filter(t => t.owner === owner).length;
  }

  /** Count total units owned by a given owner */
  countUnits(owner: Owner): number {
    return Object.values(this.gsm.state)
      .filter(t => t.owner === owner)
      .reduce((sum, t) => sum + t.units, 0);
  }
}
