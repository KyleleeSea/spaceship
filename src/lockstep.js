// Lockstep driver. Both peers run the identical simulation; the only thing
// exchanged is the list of commands each player issued per turn. Turn t is
// simulated only when both players' commands for t are known. Commands issued
// now are scheduled for turn (current + INPUT_DELAY), which hides latency.
import { TURN_TICKS, INPUT_DELAY } from './data.js';
import { simTick, applyCommand, hashSim } from './sim.js';

export class Lockstep {
  constructor({ sim, send, localSide, delay = INPUT_DELAY, onDesync }) {
    this.sim = sim;
    this.send = send;
    this.local = localSide;
    this.remote = 1 - localSide;
    this.delay = delay;
    this.onDesync = onDesync || (() => {});
    this.queue = [];
    this.inputs = [new Map(), new Map()];
    for (let t = 0; t < delay; t++) { this.inputs[0].set(t, []); this.inputs[1].set(t, []); }
    this.sentUpTo = delay - 1;
    this.hashes = new Map();
    this.remoteHashes = new Map();
    this.desynced = false;
    this.remoteTurn = -1;   // highest remote turn received
    this.waiting = false;
  }

  queueCommand(cmd) { this.queue.push(cmd); }

  get turn() { return Math.floor(this.sim.tick / TURN_TICKS); }

  onRemote(msg) {
    if (typeof msg.t !== 'number' || !Array.isArray(msg.cmds)) return;
    if (!this.inputs[this.remote].has(msg.t)) this.inputs[this.remote].set(msg.t, msg.cmds);
    if (msg.t > this.remoteTurn) this.remoteTurn = msg.t;
    if (typeof msg.ht === 'number' && msg.ht >= 0) {
      this.remoteHashes.set(msg.ht, msg.h >>> 0);
      this.checkHash(msg.ht);
    }
  }

  checkHash(t) {
    if (this.desynced) return;
    const a = this.hashes.get(t), b = this.remoteHashes.get(t);
    if (a === undefined || b === undefined) return;
    if (a !== b) { this.desynced = true; this.onDesync(t); }
    // Drop old entries to keep memory bounded.
    if (t > 20) { this.hashes.delete(t - 20); this.remoteHashes.delete(t - 20); }
  }

  // Advance one tick. Returns false if blocked on remote input.
  step() {
    const sim = this.sim;
    const t = Math.floor(sim.tick / TURN_TICKS);
    if (sim.tick % TURN_TICKS === 0) {
      // Publish our commands for the future turn exactly once per turn.
      while (this.sentUpTo < t + this.delay) {
        this.sentUpTo++;
        const cmds = this.queue.splice(0);
        this.inputs[this.local].set(this.sentUpTo, cmds);
        const ht = t - 1;
        this.send({ type: 'input', t: this.sentUpTo, cmds, ht, h: ht >= 0 ? (this.hashes.get(ht) || 0) : 0 });
      }
      const rc = this.inputs[this.remote].get(t);
      if (!rc) { this.waiting = true; return false; }
      this.waiting = false;
      const lc = this.inputs[this.local].get(t) || [];
      const c0 = this.local === 0 ? lc : rc, c1 = this.local === 0 ? rc : lc;
      for (const c of c0) applyCommand(sim, 0, c);
      for (const c of c1) applyCommand(sim, 1, c);
      // Free inputs older than a few turns.
      this.inputs[0].delete(t - 4); this.inputs[1].delete(t - 4);
    }
    simTick(sim);
    if (sim.tick % TURN_TICKS === 0) {
      this.hashes.set(t, hashSim(sim));
      this.checkHash(t);
    }
    return true;
  }
}
