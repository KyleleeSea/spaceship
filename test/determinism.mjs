// Runs the same battle twice with identical inputs and verifies identical hashes
// every turn; also runs one battle with scripted pause/orders commands through
// the lockstep driver from both "sides" and checks they agree.
import { createSim, simTick, hashSim, applyCommand, validateFleet } from '../src/sim.js';
import { Lockstep } from '../src/lockstep.js';
import { PRESETS, DEFAULT_SETTINGS, TURN_TICKS } from '../src/data.js';

const fleets = [PRESETS.wall.ships, PRESETS.swarm.ships];
for (const f of fleets) { const v = validateFleet(f, DEFAULT_SETTINGS.budget[0]); if (!v.ok) throw new Error(v.errors.join(' ')); }

function run(seed, script) {
  const sim = createSim(DEFAULT_SETTINGS, fleets, seed);
  const hashes = [];
  for (let tick = 0; tick < 60 * 200 && !sim.over; tick++) {
    if (tick % TURN_TICKS === 0) {
      const t = tick / TURN_TICKS;
      for (const [st, side, cmd] of script) if (st === t) applyCommand(sim, side, cmd);
    }
    simTick(sim);
    if (sim.tick % TURN_TICKS === 0) hashes.push(hashSim(sim));
  }
  return { sim, hashes };
}

const script = [
  [50, 0, { c: 'pause' }],
  [52, 0, { c: 'orders', i: 0, o: { stance: 'kite', target: 'weakest' } }],
  [55, 0, { c: 'resume' }],
  [120, 1, { c: 'pause' }],
  [125, 1, { c: 'orders', i: 2, o: { retreat: 50 } }],
  [130, 1, { c: 'resume' }],
];
let fails = 0;
for (const seed of [1, 42, 123456, 0xdeadbeef]) {
  const a = run(seed, script), b = run(seed, script);
  let ok = a.hashes.length === b.hashes.length;
  for (let i = 0; ok && i < a.hashes.length; i++) if (a.hashes[i] !== b.hashes[i]) ok = false;
  console.log(`seed ${seed}: ${ok ? 'OK' : 'MISMATCH'} turns=${a.hashes.length} winner=${a.sim.winner} ticks=${a.sim.tick} ships=${a.sim.ships.filter(s => s.alive).length}`);
  if (!ok) fails++;
}

// Lockstep: two drivers wired back to back.
{
  const simA = createSim(DEFAULT_SETTINGS, fleets, 7), simB = createSim(DEFAULT_SETTINGS, fleets, 7);
  let A, B;
  const inboxA = [], inboxB = [];
  A = new Lockstep({ sim: simA, localSide: 0, send: m => inboxB.push(JSON.parse(JSON.stringify(m))), onDesync: t => { console.log('A desync', t); fails++; } });
  B = new Lockstep({ sim: simB, localSide: 1, send: m => inboxA.push(JSON.parse(JSON.stringify(m))), onDesync: t => { console.log('B desync', t); fails++; } });
  let steps = 0;
  while (!simA.over && steps < 60 * 200) {
    if (A.turn === 40) A.queueCommand({ c: 'pause' });
    if (B.turn === 60) B.queueCommand({ c: 'orders', i: 0, o: { stance: 'brawl' } });
    // Deliver messages with random lag.
    if (Math.random() < 0.7) while (inboxA.length) A.onRemote(inboxA.shift());
    if (Math.random() < 0.7) while (inboxB.length) B.onRemote(inboxB.shift());
    const sa = A.step(), sb = B.step();
    if (!sa && !sb) { while (inboxA.length) A.onRemote(inboxA.shift()); while (inboxB.length) B.onRemote(inboxB.shift()); }
    steps++;
  }
  while (inboxA.length) A.onRemote(inboxA.shift());
  while (inboxB.length) B.onRemote(inboxB.shift());
  const same = hashSim(simA) === hashSim(simB) && simA.tick === simB.tick;
  console.log(`lockstep pair: ${same ? 'OK' : 'MISMATCH'} tickA=${simA.tick} tickB=${simB.tick} winner=${simA.winner} desynced=${A.desynced || B.desynced}`);
  if (!same) fails++;
}
if (fails) { console.log('FAILED'); process.exit(1); } else console.log('ALL OK');
