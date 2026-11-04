// Writes the radial pattern for the simulation: run through esbuild, see README
import fs from "node:fs";
import { createCrackPattern } from "../src/crackPattern";

// a big ball spreads its load: fewer cracks, and nothing tiny at the impact
const big = process.argv[3] === "big";

const shards = createCrackPattern({
  seed: 7,
  halfWidth: 1.25,
  halfHeight: 1.25,
  impact: [0.04, 0.02],
  radials: big ? 9 : 12,
  radialJitter: 0.6,
  kink: 0.4,
  ringStart: big ? 0.2 : 0.05,
  ringGrowth: big ? 1.75 : 1.5,
  ringGrowthOuter: big ? 1.85 : 1.62,
  ringJitter: 0.14,
  ringDrop: 0.25,
  forks: big ? 0.15 : 0.3,
  secondary: big ? 0.1 : 0.3,
  hole: 0,
});
fs.writeFileSync(process.argv[2], JSON.stringify(shards.map((s) => s.points)));
console.log(`${shards.length} shards`);
