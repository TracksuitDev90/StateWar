// Railway routes: fast-travel edges between specific states.
// These connect non-adjacent states, allowing long-distance moves.
// Each route can be upgraded from level 0 (not built) to level 3.
//
// Level 0: not built (no connection)
// Level 1: slow rail   — moves take 1 tick delay, costs 5 units to build
// Level 2: standard    — instant move, costs 8 units to upgrade
// Level 3: express     — instant move + 20% more units arrive, costs 12 units to upgrade

export interface RailwayRoute {
  from: string;
  to: string;
}

// Predefined routes that can be built — major cross-country corridors
export const railwayRoutes: RailwayRoute[] = [
  // Transcontinental corridors
  { from: "CA", to: "AZ" },  // already adjacent, but rail makes it faster at lv3
  { from: "CA", to: "TX" },  // West Coast to South
  { from: "TX", to: "FL" },  // Gulf Coast line
  { from: "WA", to: "MN" },  // Northern Pacific
  { from: "WA", to: "MT" },  // Pacific Northwest inland

  // East-West trunk lines
  { from: "NY", to: "IL" },  // Northeast to Midwest
  { from: "IL", to: "CO" },  // Midwest to Rockies
  { from: "CO", to: "CA" },  // Rockies to West Coast
  { from: "GA", to: "TX" },  // Southeast to South

  // North-South corridors
  { from: "NY", to: "FL" },  // East Coast express
  { from: "IL", to: "TX" },  // Midwest to South
  { from: "MN", to: "MO" },  // Upper Midwest to mid-South
  { from: "PA", to: "GA" },  // Appalachian corridor

  // Strategic links
  { from: "OH", to: "VA" },  // Industrial to Military
  { from: "MI", to: "NY" },  // Great Lakes to Northeast
];

export const RAIL_BUILD_COST = 5;
export const RAIL_UPGRADE_COSTS: Record<number, number> = {
  1: 5,   // build level 1
  2: 8,   // upgrade to level 2
  3: 12,  // upgrade to level 3
};

export const RAIL_EXPRESS_BONUS = 0.2; // 20% more units arrive at level 3
