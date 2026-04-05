// Per-state defense bonus: multiplier applied to defending units.
// Higher = harder to capture. Based loosely on geographic defensibility.
// Default is 1.0; mountains/coasts/small states get a bonus.

export const stateDefenseBonus: Record<string, number> = {
  AL: 1.0,
  AK: 1.5, // remote, difficult terrain
  AZ: 1.1, // desert
  AR: 1.0,
  CA: 1.1, // mountains + coast
  CO: 1.3, // Rocky Mountains
  CT: 1.0,
  DE: 0.9, // tiny, flat
  FL: 1.1, // peninsula
  GA: 1.0,
  HI: 1.5, // island — very hard to invade
  ID: 1.2, // mountains
  IL: 1.0,
  IN: 1.0,
  IA: 1.0,
  KS: 0.9, // flat plains
  KY: 1.1, // Appalachian foothills
  LA: 1.0,
  ME: 1.2, // remote corner, rugged coast
  MD: 1.0,
  MA: 1.0,
  MI: 1.2, // Great Lakes chokepoints
  MN: 1.0,
  MS: 1.0,
  MO: 1.0,
  MT: 1.2, // mountains, low density
  NE: 0.9, // flat
  NV: 1.1, // desert
  NH: 1.1, // mountains
  NJ: 1.0,
  NM: 1.1, // desert
  NY: 1.0,
  NC: 1.0,
  ND: 0.9, // flat
  OH: 1.0,
  OK: 1.0,
  OR: 1.1, // Cascades
  PA: 1.0,
  RI: 0.9, // tiny
  SC: 1.0,
  SD: 0.9, // flat
  TN: 1.1, // Appalachian
  TX: 1.1, // vast, difficult logistics
  UT: 1.2, // mountains + desert
  VT: 1.1, // Green Mountains
  VA: 1.0,
  WA: 1.1, // Cascades
  WV: 1.3, // Appalachian Mountains, very rugged
  WI: 1.0,
  WY: 1.2, // mountains, sparse
};
