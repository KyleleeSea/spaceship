// Round-robin every preset vs every preset across seeds; prints win rates and durations.
import { createSim, simTick } from '../src/sim.js';
import { PRESETS, DEFAULT_SETTINGS, TICK_RATE } from '../src/data.js';
const keys = Object.keys(PRESETS);
const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('', 11) + keys.map(k => pad(k, 22)).join(''));
const totals = {};
for (const a of keys) {
  let row = pad(a, 11);
  for (const b of keys) {
    let w = 0, l = 0, d = 0, dur = 0;
    for (const seed of seeds) {
      const sim = createSim(DEFAULT_SETTINGS, [PRESETS[a].ships, PRESETS[b].ships], seed);
      while (!sim.over) simTick(sim);
      if (sim.winner === 0) w++; else if (sim.winner === 1) l++; else d++;
      dur += sim.battleTick / TICK_RATE;
    }
    totals[a] = (totals[a] || 0) + w; totals[b] = (totals[b] || 0) + l;
    row += pad(`${w}-${l}-${d} ${(dur / seeds.length).toFixed(0)}s`, 22);
  }
  console.log(row);
}
console.log('wins:', totals);
