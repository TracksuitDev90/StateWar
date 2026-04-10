// Level definitions for region-based progression.
// Each level is a small contiguous group of states the player must conquer
// before moving to the next region — similar to state.io's level structure.

export interface LevelConfig {
  id: number;
  name: string;
  states: string[];        // state IDs in this level
  playerStart: string[];   // player starting states
  aiStart: string[];       // AI starting states
  startingUnits: number;   // units each side starts with
  neutralUnits: number;    // units for neutral states
}

export const levels: LevelConfig[] = [
  {
    id: 1,
    name: "Pacific Coast",
    states: ["CA", "OR", "WA", "NV"],
    playerStart: ["CA"],
    aiStart: ["WA"],
    startingUnits: 10,
    neutralUnits: 4,
  },
  {
    id: 2,
    name: "Mountain West",
    states: ["AZ", "UT", "CO", "NM", "ID"],
    playerStart: ["AZ"],
    aiStart: ["ID"],
    startingUnits: 10,
    neutralUnits: 5,
  },
  {
    id: 3,
    name: "Great Plains",
    states: ["TX", "OK", "KS", "NE", "WY"],
    playerStart: ["TX"],
    aiStart: ["WY"],
    startingUnits: 12,
    neutralUnits: 5,
  },
  {
    id: 4,
    name: "Northern Frontier",
    states: ["MT", "ND", "SD", "MN", "IA"],
    playerStart: ["IA"],
    aiStart: ["MT"],
    startingUnits: 12,
    neutralUnits: 6,
  },
  {
    id: 5,
    name: "Deep South",
    states: ["LA", "AR", "MS", "AL", "TN", "MO"],
    playerStart: ["MO"],
    aiStart: ["LA"],
    startingUnits: 12,
    neutralUnits: 6,
  },
  {
    id: 6,
    name: "Southeast",
    states: ["FL", "GA", "SC", "NC", "VA"],
    playerStart: ["FL"],
    aiStart: ["VA"],
    startingUnits: 14,
    neutralUnits: 6,
  },
  {
    id: 7,
    name: "Heartland",
    states: ["IL", "IN", "WI", "MI", "OH", "KY"],
    playerStart: ["IL"],
    aiStart: ["OH"],
    startingUnits: 14,
    neutralUnits: 7,
  },
  {
    id: 8,
    name: "Mid-Atlantic",
    states: ["PA", "WV", "MD", "DE", "NJ", "NY"],
    playerStart: ["NY"],
    aiStart: ["WV"],
    startingUnits: 14,
    neutralUnits: 7,
  },
  {
    id: 9,
    name: "New England",
    states: ["CT", "MA", "RI", "VT", "NH", "ME"],
    playerStart: ["MA"],
    aiStart: ["ME"],
    startingUnits: 16,
    neutralUnits: 8,
  },
  {
    id: 10,
    name: "Final Showdown",
    states: [
      "CA","OR","WA","NV","AZ","UT","CO","NM","ID",
      "TX","OK","KS","NE","WY","MT","ND","SD","MN","IA",
      "LA","AR","MS","AL","TN","MO","FL","GA","SC","NC","VA",
      "IL","IN","WI","MI","OH","KY","PA","WV","MD","DE","NJ","NY",
      "CT","MA","RI","VT","NH","ME",
    ],
    playerStart: ["CA"],
    aiStart: ["NY"],
    startingUnits: 10,
    neutralUnits: 5,
  },
];
