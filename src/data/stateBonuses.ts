// Unique per-state bonuses that affect unit generation.
// genBonus: extra units generated per tick (added to the base rate).
// Thematically tied to each state's economic/strategic importance.

export interface StateBonus {
  genBonus: number;
  description: string;
}

export const stateBonuses: Record<string, StateBonus> = {
  CA: { genBonus: 0.5, description: "Tech Hub: +0.5 gen/tick" },
  TX: { genBonus: 0.5, description: "Energy Capital: +0.5 gen/tick" },
  NY: { genBonus: 0.4, description: "Financial Center: +0.4 gen/tick" },
  FL: { genBonus: 0.3, description: "Tourism Revenue: +0.3 gen/tick" },
  IL: { genBonus: 0.3, description: "Transport Hub: +0.3 gen/tick" },
  PA: { genBonus: 0.2, description: "Industrial Base: +0.2 gen/tick" },
  OH: { genBonus: 0.2, description: "Manufacturing: +0.2 gen/tick" },
  GA: { genBonus: 0.2, description: "Logistics Hub: +0.2 gen/tick" },
  MI: { genBonus: 0.2, description: "Auto Industry: +0.2 gen/tick" },
  WA: { genBonus: 0.3, description: "Tech & Trade: +0.3 gen/tick" },
  CO: { genBonus: 0.2, description: "Aerospace: +0.2 gen/tick" },
  VA: { genBonus: 0.2, description: "Military Bases: +0.2 gen/tick" },
  AK: { genBonus: 0.3, description: "Oil Reserves: +0.3 gen/tick" },
  HI: { genBonus: 0.1, description: "Pacific Outpost: +0.1 gen/tick" },
};
