import { GameState, Owner } from "../types";
import { stateData } from "../data/states";

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

  /** Move units from one state to an adjacent friendly state. Returns true if successful. */
  moveUnits(from: string, to: string, count: number): boolean {
    const src = this.state[from];
    const dst = this.state[to];
    if (!src || !dst) return false;
    if (src.owner !== dst.owner) return false;
    if (count < 1 || count >= src.units) return false; // must leave at least 1

    src.units -= count;
    dst.units += count;
    return true;
  }
}
