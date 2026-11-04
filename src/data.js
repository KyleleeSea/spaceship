// Static game data: hulls, weapons, modules, orders, presets, settings.

export const VERSION = '1.0.0';
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const TURN_TICKS = 6;      // one lockstep turn = 100 ms
export const INPUT_DELAY = 2;     // turns of input latency hidden by lockstep
export const WORLD_W = 1800;
export const WORLD_H = 1000;
export const MAX_SHIPS = 6;

export const HULLS = {
  interceptor: { name: 'Interceptor', cost: 4, hp: 190, speed: 230, accel: 420, turn: 4.2, radius: 10, wslots: 1, mslots: 1,
    desc: 'Fast and fragile. Hard for railguns to hit.' },
  frigate: { name: 'Frigate', cost: 6, hp: 420, speed: 150, accel: 220, turn: 2.4, radius: 15, wslots: 2, mslots: 1,
    desc: 'Versatile workhorse. Two guns, one module.' },
  cruiser: { name: 'Cruiser', cost: 11, hp: 860, speed: 95, accel: 110, turn: 1.3, radius: 22, wslots: 3, mslots: 2,
    desc: 'Slow and tough. Three guns, two modules.' },
};

export const WEAPONS = {
  none: { name: '— empty —', cost: 0 },
  laser: { name: 'Pulse Laser', cost: 2, dmg: 5, cd: 0.18, range: 280, kind: 'beam', arcCos: -1,
    desc: 'Hitscan, high sustained damage. Armor shrugs it off.' },
  railgun: { name: 'Railgun', cost: 3, dmg: 40, cd: 1.6, range: 480, kind: 'slug', speed: 900, arcCos: 0.9659258262890683,
    desc: 'Fixed forward mount (30° arc). Cracks armor. Misses nimble ships.' },
  missile: { name: 'Missiles', cost: 3, dmg: 42, cd: 2.0, range: 600, kind: 'missile', speed: 340, turn: 3.2, life: 3.6, hp: 10, arcCos: -1,
    desc: 'Long range homing. Flak can shoot them down (3 hits).' },
  flak: { name: 'Flak Cannon', cost: 2, dmg: 4, cd: 0.15, range: 190, kind: 'flak', splash: 40, arcCos: -1,
    desc: 'Short range bursts hit everything nearby, missiles included. Useless vs armor.' },
};

export const MODULES = {
  none: { name: '— empty —', cost: 0 },
  shield: { name: 'Shield Generator', cost: 2, shield: 170, regen: 16, delay: 2.5, desc: '+170 shield, regenerates after 2.5s without damage.' },
  armor: { name: 'Armor Plating', cost: 2, armor: 3, hp: 50, speedPct: -0.1, desc: '-3 damage per hit (min 20%), +50 hp, -10% speed.' },
  engine: { name: 'Afterburner', cost: 2, speedPct: 0.3, turnPct: 0.3, desc: '+30% speed and turn rate.' },
  repair: { name: 'Repair Nanites', cost: 2, repair: 6, desc: 'Repairs 6 hp/s.' },
};

export const STANCES = {
  assault: { name: 'Assault', desc: 'Close to weapon range and orbit the target.' },
  kite: { name: 'Kite', desc: 'Stay at maximum range, back off if the enemy closes.' },
  brawl: { name: 'Brawl', desc: 'Get point blank. Great for flak and lasers.' },
  guard: { name: 'Guard ally', desc: 'Stick close to a friendly ship and fight whatever comes near.' },
  hold: { name: 'Hold position', desc: 'Stay near the start line, fight what comes in range.' },
};

export const TARGETS = {
  nearest: { name: 'Nearest' },
  weakest: { name: 'Weakest (lowest hp)' },
  dangerous: { name: 'Most dangerous (highest dps)' },
  largest: { name: 'Largest hull' },
  smallest: { name: 'Smallest hull' },
  focus: { name: 'Focus enemy #' },
};

export const RETREATS = [0, 25, 50];

export const DEFAULT_SETTINGS = {
  budget: [36, 36],
  pauses: 3,
  pauseLen: 30,
  liveOrders: false,
  timeLimit: 150,
  loserBonus: 2,
};

export const SETTING_LIMITS = {
  budget: [12, 80],
  pauses: [0, 6],
  pauseLen: [10, 60],
  timeLimit: [45, 300],
  loserBonus: [0, 8],
};

const O = (stance, target, retreat = 0, guard = 0, focus = 0) => ({ stance, target, retreat, guard, focus });

export const PRESETS = {
  balanced: { name: 'Balanced', ships: [
    { hull: 'frigate', weapons: ['laser', 'railgun'], modules: ['shield'], orders: O('assault', 'weakest', 25) },
    { hull: 'frigate', weapons: ['laser', 'flak'], modules: ['shield'], orders: O('brawl', 'weakest', 25) },
    { hull: 'interceptor', weapons: ['laser'], modules: ['engine'], orders: O('brawl', 'weakest', 50) },
  ] },
  swarm: { name: 'Swarm', ships: [
    { hull: 'interceptor', weapons: ['laser'], modules: ['engine'], orders: O('brawl', 'weakest', 25) },
    { hull: 'interceptor', weapons: ['laser'], modules: ['engine'], orders: O('brawl', 'weakest', 25) },
    { hull: 'interceptor', weapons: ['laser'], modules: ['none'], orders: O('assault', 'weakest', 25) },
    { hull: 'interceptor', weapons: ['laser'], modules: ['none'], orders: O('assault', 'weakest', 25) },
    { hull: 'interceptor', weapons: ['flak'], modules: ['shield'], orders: O('assault', 'smallest', 25) },
  ] },
  wall: { name: 'Iron Wall', ships: [
    { hull: 'cruiser', weapons: ['railgun', 'railgun', 'laser'], modules: ['armor', 'shield'], orders: O('assault', 'largest', 0) },
    { hull: 'frigate', weapons: ['flak', 'laser'], modules: ['repair'], orders: O('guard', 'smallest', 25, 0) },
  ] },
  artillery: { name: 'Artillery', ships: [
    { hull: 'frigate', weapons: ['missile', 'missile'], modules: ['shield'], orders: O('kite', 'largest', 25) },
    { hull: 'frigate', weapons: ['missile', 'missile'], modules: ['shield'], orders: O('kite', 'largest', 25) },
    { hull: 'interceptor', weapons: ['flak'], modules: ['engine'], orders: O('guard', 'smallest', 25, 0) },
  ] },
};
