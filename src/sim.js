// Deterministic battle simulation. Pure data in, pure data out.
// Rules: no Math.sin/cos/atan2/pow/random, no Date, no object-key iteration
// order dependence. Everything the hash covers must be derived from inputs only.
import { dsin, dcos, clamp, rotateToward, hashInt, hashFloat } from './dmath.js';
import {
  HULLS, WEAPONS, MODULES, DT, TICK_RATE, WORLD_W, WORLD_H, MAX_SHIPS,
  STANCES, TARGETS, RETREATS, DEFAULT_SETTINGS, SETTING_LIMITS,
} from './data.js';

// ---------- RNG (mulberry32, state lives on the sim) ----------
export function rand(sim) {
  sim.rng = (sim.rng + 0x6D2B79F5) | 0;
  let t = Math.imul(sim.rng ^ (sim.rng >>> 15), 1 | sim.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------- Definitions / validation ----------
export function normalizeOrders(o) {
  o = o || {};
  const retreat = o.retreat | 0;
  return {
    stance: STANCES[o.stance] ? o.stance : 'assault',
    target: TARGETS[o.target] ? o.target : 'nearest',
    retreat: RETREATS.indexOf(retreat) >= 0 ? retreat : 0,
    guard: clamp(o.guard | 0, 0, MAX_SHIPS - 1),
    focus: clamp(o.focus | 0, 0, MAX_SHIPS - 1),
  };
}

export function normalizeShipDef(d) {
  d = d || {};
  const hullKey = HULLS[d.hull] ? d.hull : 'frigate';
  const hull = HULLS[hullKey];
  const weapons = [];
  for (let i = 0; i < hull.wslots; i++) {
    const k = d.weapons && d.weapons[i];
    weapons.push(WEAPONS[k] ? k : 'none');
  }
  const modules = [];
  for (let i = 0; i < hull.mslots; i++) {
    const k = d.modules && d.modules[i];
    modules.push(MODULES[k] ? k : 'none');
  }
  return { hull: hullKey, weapons, modules, orders: normalizeOrders(d.orders) };
}

export function shipCost(def) {
  let c = HULLS[def.hull].cost;
  for (const w of def.weapons) c += WEAPONS[w].cost;
  for (const m of def.modules) c += MODULES[m].cost;
  return c;
}

export function fleetCost(fleet) {
  let c = 0;
  for (const s of fleet) c += shipCost(s);
  return c;
}

export function validateFleet(fleet, budget) {
  const errors = [];
  if (!Array.isArray(fleet) || fleet.length === 0) return { ok: false, cost: 0, errors: ['Fleet needs at least one ship.'] };
  if (fleet.length > MAX_SHIPS) errors.push(`At most ${MAX_SHIPS} ships.`);
  const norm = fleet.map(normalizeShipDef);
  norm.forEach((s, i) => {
    if (!s.weapons.some(w => w !== 'none')) errors.push(`Ship ${i + 1} has no weapon.`);
  });
  const cost = fleetCost(norm);
  if (cost > budget) errors.push(`Fleet costs ${cost}, budget is ${budget}.`);
  return { ok: errors.length === 0, cost, errors, fleet: norm };
}

export function sanitizeSettings(s) {
  const d = DEFAULT_SETTINGS;
  s = s || {};
  const num = (v, lim, def) => {
    v = Number(v);
    if (!isFinite(v)) v = def;
    return clamp(Math.round(v), lim[0], lim[1]);
  };
  const b = Array.isArray(s.budget) ? s.budget : d.budget;
  return {
    budget: [num(b[0], SETTING_LIMITS.budget, d.budget[0]), num(b[1], SETTING_LIMITS.budget, d.budget[1])],
    pauses: num(s.pauses, SETTING_LIMITS.pauses, d.pauses),
    pauseLen: num(s.pauseLen, SETTING_LIMITS.pauseLen, d.pauseLen),
    liveOrders: !!s.liveOrders,
    timeLimit: num(s.timeLimit, SETTING_LIMITS.timeLimit, d.timeLimit),
    loserBonus: num(s.loserBonus, SETTING_LIMITS.loserBonus, d.loserBonus),
  };
}

export function shipStats(def) {
  const hull = HULLS[def.hull];
  let hp = hull.hp, shield = 0, regen = 0, delay = 0, armor = 0, speedPct = 0, turnPct = 0, repair = 0;
  for (const m of def.modules) {
    if (m === 'none') continue;
    const M = MODULES[m];
    hp += M.hp || 0; shield += M.shield || 0; regen += M.regen || 0;
    if ((M.delay || 0) > delay) delay = M.delay;
    armor += M.armor || 0; speedPct += M.speedPct || 0; turnPct += M.turnPct || 0; repair += M.repair || 0;
  }
  const weapons = def.weapons.filter(w => w !== 'none');
  let dps = 0, minRange = 1e9, maxRange = 0;
  for (const w of weapons) {
    const W = WEAPONS[w];
    dps += W.dmg / W.cd;
    if (W.range < minRange) minRange = W.range;
    if (W.range > maxRange) maxRange = W.range;
  }
  if (!weapons.length) { minRange = 150; maxRange = 150; }
  return {
    hp, shield, regen, delay, armor, repair, weapons, dps, minRange, maxRange,
    maxSpeed: hull.speed * (1 + speedPct),
    turn: hull.turn * (1 + turnPct),
    cost: shipCost(def),
  };
}

// ---------- Sim construction ----------
export function createSim(settings, fleets, seed) {
  settings = sanitizeSettings(settings);
  const sim = {
    tick: 0, battleTick: 0, rng: seed >>> 0, settings,
    paused: false, pausedBy: -1, pauseTicksLeft: 0,
    players: [
      { pausesLeft: settings.pauses, dmg: 0, lost: 0 },
      { pausesLeft: settings.pauses, dmg: 0, lost: 0 },
    ],
    ships: [], projectiles: [], fx: [], log: [],
    over: false, winner: -1, endTick: 0,
  };
  for (let side = 0; side < 2; side++) {
    const fleet = fleets[side].slice(0, MAX_SHIPS).map(normalizeShipDef);
    const n = fleet.length;
    for (let i = 0; i < n; i++) spawnShip(sim, side, i, fleet[i], n);
  }
  return sim;
}

function spawnShip(sim, side, idx, def, n) {
  const hull = HULLS[def.hull];
  const st = shipStats(def);
  const x = side === 0 ? 260 : WORLD_W - 260;
  const y = WORLD_H / 2 + (i2(idx) - (n - 1) / 2) * 95;
  const ship = {
    id: sim.ships.length, side, idx, hull: def.hull, name: hull.name + ' ' + (idx + 1),
    x, y, dx: side === 0 ? 1 : -1, dy: 0, speed: 0,
    hp: st.hp, maxHp: st.hp, shield: st.shield, maxShield: st.shield,
    regen: st.regen, delayTicks: Math.round(st.delay * TICK_RATE), armor: st.armor, repair: st.repair,
    maxSpeed: st.maxSpeed, accel: hull.accel, turnC: dcos(st.turn * DT), turnS: dsin(st.turn * DT),
    radius: hull.radius, dps: st.dps, minRange: st.minRange, maxRange: st.maxRange,
    weapons: st.weapons.map(k => ({ key: k, cd: 0 })),
    orders: def.orders, targetId: -1, retargetAt: 0,
    retreating: false, retreatUntil: 0, retreatCd: 0,
    orbit: ((idx & 1) ? 1 : -1) * (side === 0 ? 1 : -1), alive: true, homeX: x, homeY: y,
    lastHit: -100000, kills: 0, wantX: 0, wantY: 0, throttle: 0,
  };
  sim.ships.push(ship);
}
function i2(v) { return v; }

// ---------- Commands (lockstep inputs) ----------
export function applyCommand(sim, side, cmd) {
  if (!cmd || sim.over) return;
  switch (cmd.c) {
    case 'pause':
      if (!sim.paused && sim.players[side].pausesLeft > 0) {
        sim.paused = true; sim.pausedBy = side;
        sim.pauseTicksLeft = sim.settings.pauseLen * TICK_RATE;
        sim.players[side].pausesLeft--;
        sim.log.push({ tick: sim.battleTick, side, msg: 'paused' });
      }
      break;
    case 'resume':
      if (sim.paused && sim.pausedBy === side) {
        sim.paused = false; sim.pausedBy = -1; sim.pauseTicksLeft = 0;
        sim.log.push({ tick: sim.battleTick, side, msg: 'resumed' });
      }
      break;
    case 'orders': {
      const idx = cmd.i | 0;
      for (const s of sim.ships) {
        if (s.side === side && s.idx === idx) {
          const merged = { ...s.orders };
          const o = cmd.o || {};
          if (o.stance !== undefined) merged.stance = o.stance;
          if (o.target !== undefined) merged.target = o.target;
          if (o.retreat !== undefined) merged.retreat = o.retreat;
          if (o.guard !== undefined) merged.guard = o.guard;
          if (o.focus !== undefined) merged.focus = o.focus;
          s.orders = normalizeOrders(merged);
          s.retargetAt = 0; // re-evaluate target immediately
          break;
        }
      }
      break;
    }
    default: break;
  }
}

// ---------- Tick ----------
export function simTick(sim) {
  if (sim.over) return;
  sim.tick++;
  if (sim.paused) {
    sim.pauseTicksLeft--;
    if (sim.pauseTicksLeft <= 0) { sim.paused = false; sim.pausedBy = -1; sim.pauseTicksLeft = 0; }
    return;
  }
  sim.battleTick++;
  const ships = sim.ships;
  for (let i = 0; i < ships.length; i++) if (ships[i].alive) shipAI(sim, ships[i]);
  for (let i = 0; i < ships.length; i++) if (ships[i].alive) moveShip(sim, ships[i]);
  sim.pending = [];
  for (let i = 0; i < ships.length; i++) if (ships[i].alive) fireWeapons(sim, ships[i]);
  updateProjectiles(sim);
  // Apply all damage from this tick at once: whoever fires first in array order gets no edge.
  const pend = sim.pending;
  for (let i = 0; i < pend.length; i++) applyDamage(sim, pend[i].s, pend[i].amount, pend[i].attacker);
  sim.pending = null;
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (!s.alive) continue;
    if (s.shield < s.maxShield && sim.tick - s.lastHit > s.delayTicks) {
      s.shield += s.regen * DT; if (s.shield > s.maxShield) s.shield = s.maxShield;
    }
    if (s.repair > 0 && s.hp < s.maxHp) {
      s.hp += s.repair * DT; if (s.hp > s.maxHp) s.hp = s.maxHp;
    }
  }
  checkOver(sim);
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function nearestEnemy(sim, s) {
  let best = null, bd = 1e18;
  for (const e of sim.ships) {
    if (!e.alive || e.side === s.side) continue;
    const d = dist(s, e);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function pickTarget(sim, s) {
  const o = s.orders;
  let best = null, bs = -1e18;
  for (const e of sim.ships) {
    if (!e.alive || e.side === s.side) continue;
    const d = dist(s, e);
    let sc;
    switch (o.target) {
      case 'weakest': sc = -(e.hp + e.shield) - d * 0.01; break;
      case 'dangerous': sc = e.dps - d * 0.001; break;
      case 'largest': sc = e.radius * 1000 - d * 0.1; break;
      case 'smallest': sc = -e.radius * 1000 - d * 0.1; break;
      case 'focus': sc = e.idx === o.focus ? 1e9 : -d; break;
      default: sc = -d; break;
    }
    if (sc > bs) { bs = sc; best = e; }
  }
  return best;
}

function shipAI(sim, s) {
  const o = s.orders;
  // Retreat state machine.
  if (s.retreating) {
    if (sim.tick >= s.retreatUntil) { s.retreating = false; s.retreatCd = sim.tick + 12 * TICK_RATE; }
  } else if (o.retreat > 0 && sim.tick >= s.retreatCd && s.hp * 100 < s.maxHp * o.retreat) {
    s.retreating = true; s.retreatUntil = sim.tick + 5 * TICK_RATE;
    sim.fx.push({ t: 'text', x: s.x, y: s.y, msg: 'RETREAT', side: s.side });
  }
  // Targeting (re-evaluated every half second, or immediately on loss).
  let tgt = s.targetId >= 0 ? sim.ships[s.targetId] : null;
  if (!tgt || !tgt.alive || sim.tick >= s.retargetAt) {
    tgt = pickTarget(sim, s);
    s.targetId = tgt ? tgt.id : -1;
    s.retargetAt = sim.tick + 30;
  }
  let wx = 0, wy = 0, throttle = 1;

  const orbit = (t, desired, tanW) => {
    const ex = t.x - s.x, ey = t.y - s.y;
    let d = Math.sqrt(ex * ex + ey * ey); if (d < 0.001) d = 0.001;
    const ux = ex / d, uy = ey / d;
    // Near an arena edge, orbit whichever way leads back toward open space (with hysteresis).
    const em = 180;
    if (s.x < em || s.y < em || s.x > WORLD_W - em || s.y > WORLD_H - em) {
      const cx = WORLD_W / 2 - s.x, cy = WORLD_H / 2 - s.y;
      const cl = Math.sqrt(cx * cx + cy * cy) || 1;
      const sc = (-uy * cx + ux * cy) / cl;
      if (sc > 0.2 && s.orbit < 0) s.orbit = 1;
      else if (sc < -0.2 && s.orbit > 0) s.orbit = -1;
    }
    const tx = -uy * s.orbit, ty = ux * s.orbit;
    if (d > desired * 1.6 + 40) { wx = ux; wy = uy; }
    else {
      let err = (d - desired) / (desired > 40 ? desired : 40);
      err = clamp(err * 2.5, -1, 1);
      wx = ux * err + tx * tanW; wy = uy * err + ty * tanW;
    }
  };
  const leash = (ax, ay, R) => {
    const dax = ax - s.x, day = ay - s.y;
    const da = Math.sqrt(dax * dax + day * day);
    if (da > R) { wx = dax / da; wy = day / da; }
    else if (tgt && dist(s, tgt) <= s.maxRange * 1.1) orbit(tgt, 0.7 * s.minRange, 1.0);
    else if (da > 25) { wx = dax / da; wy = day / da; throttle = clamp(da / 80, 0.2, 1); }
    else {
      throttle = 0;
      if (tgt) { const d = dist(s, tgt) || 1; wx = (tgt.x - s.x) / d; wy = (tgt.y - s.y) / d; }
    }
  };

  if (s.retreating) {
    const hx = s.side === 0 ? -1 : 1;
    wx = hx * 1.2;
    const ne = nearestEnemy(sim, s);
    if (ne) { const d = dist(s, ne) || 1; wx += (s.x - ne.x) / d; wy += (s.y - ne.y) / d; }
    wy += (WORLD_H / 2 - s.y) / WORLD_H;
  } else if (tgt) {
    switch (o.stance) {
      case 'kite': orbit(tgt, 0.92 * s.maxRange, 0.8); break;
      case 'brawl': orbit(tgt, (0.3 * s.minRange < 60 ? 0.3 * s.minRange : 60) + tgt.radius, 1.0); break;
      case 'guard': {
        let ally = null;
        for (const a of sim.ships) if (a.alive && a.side === s.side && a.idx === o.guard && a !== s) { ally = a; break; }
        if (ally) leash(ally.x, ally.y, 150); else orbit(tgt, 0.7 * s.minRange, 1.0);
        break;
      }
      case 'hold': leash(s.homeX, s.homeY, 120); break;
      default: orbit(tgt, 0.7 * s.minRange, 1.0); break;
    }
  }
  // Separation from other ships.
  for (const o2 of sim.ships) {
    if (!o2.alive || o2 === s) continue;
    let dx = s.x - o2.x, dy = s.y - o2.y;
    const lim = s.radius + o2.radius + (o2.side === s.side ? 26 : 8);
    const d2 = dx * dx + dy * dy;
    if (d2 < lim * lim) {
      let d = Math.sqrt(d2);
      if (d < 0.001) { dx = 1; dy = 0; d = 1; }
      const f = (1 - d / lim) * 2.0;
      wx += dx / d * f; wy += dy / d * f;
      if (throttle < 0.3) throttle = 0.3;
    }
  }
  // Arena bounds.
  const m = 90;
  if (s.x < m) wx += (m - s.x) / m * 2;
  if (s.x > WORLD_W - m) wx -= (s.x - (WORLD_W - m)) / m * 2;
  if (s.y < m) wy += (m - s.y) / m * 2;
  if (s.y > WORLD_H - m) wy -= (s.y - (WORLD_H - m)) / m * 2;
  s.wantX = wx; s.wantY = wy; s.throttle = throttle;
}

function moveShip(sim, s) {
  let wx = s.wantX, wy = s.wantY;
  const wl = Math.sqrt(wx * wx + wy * wy);
  let target = 0;
  if (wl > 0.0001) {
    wx /= wl; wy /= wl;
    const r = rotateToward(s.dx, s.dy, wx, wy, s.turnC, s.turnS);
    s.dx = r[0]; s.dy = r[1];
    const l = Math.sqrt(s.dx * s.dx + s.dy * s.dy);
    s.dx /= l; s.dy /= l;
    const align = s.dx * wx + s.dy * wy;
    let f = (align + 1) / 2; if (f < 0.25) f = 0.25;
    target = s.maxSpeed * s.throttle * f;
  }
  const step = s.accel * DT;
  if (s.speed < target) { s.speed += step; if (s.speed > target) s.speed = target; }
  else if (s.speed > target) { s.speed -= step * 1.5; if (s.speed < target) s.speed = target; }
  s.x += s.dx * s.speed * DT;
  s.y += s.dy * s.speed * DT;
  s.x = clamp(s.x, s.radius, WORLD_W - s.radius);
  s.y = clamp(s.y, s.radius, WORLD_H - s.radius);
}

function inRangeArc(s, e, W) {
  const ex = e.x - s.x, ey = e.y - s.y;
  const d = Math.sqrt(ex * ex + ey * ey);
  if (d > W.range + e.radius) return false;
  if (W.arcCos > -1) {
    if (d < 0.001) return true;
    if ((s.dx * ex + s.dy * ey) / d < W.arcCos) return false;
  }
  return true;
}

function fireWeapons(sim, s) {
  const pref = s.targetId >= 0 ? sim.ships[s.targetId] : null;
  for (let wi = 0; wi < s.weapons.length; wi++) {
    const w = s.weapons[wi];
    if (w.cd > 0) { w.cd--; continue; }
    const W = WEAPONS[w.key];
    if (W.kind === 'flak') {
      // Point defense first: shoot the nearest incoming missile.
      let bm = null, bd = W.range;
      for (const p of sim.projectiles) {
        if (p.dead || p.kind !== 'missile' || p.side === s.side) continue;
        const d = dist(s, p);
        if (d < bd) { bd = d; bm = p; }
      }
      if (bm) { flakBurst(sim, s, bm.x, bm.y, W); w.cd = Math.round(W.cd * TICK_RATE); continue; }
    }
    let tgt = null;
    if (pref && pref.alive && inRangeArc(s, pref, W)) tgt = pref;
    else {
      let bd = 1e18;
      for (const e of sim.ships) {
        if (!e.alive || e.side === s.side) continue;
        if (!inRangeArc(s, e, W)) continue;
        const d = dist(s, e);
        if (d < bd) { bd = d; tgt = e; }
      }
    }
    if (!tgt) continue;
    w.cd = Math.round(W.cd * TICK_RATE);
    switch (W.kind) {
      case 'beam':
        damage(sim, tgt, W.dmg, s);
        sim.fx.push({ t: 'beam', x1: s.x, y1: s.y, x2: tgt.x, y2: tgt.y, side: s.side });
        break;
      case 'slug': {
        // Lead the target.
        const d = dist(s, tgt);
        const tt = d / W.speed;
        const px = tgt.x + tgt.dx * tgt.speed * tt, py = tgt.y + tgt.dy * tgt.speed * tt;
        let ax = px - s.x, ay = py - s.y;
        const al = Math.sqrt(ax * ax + ay * ay) || 1;
        ax /= al; ay /= al;
        // Still bound by the mount arc: blend with facing if the lead is outside it.
        if (s.dx * ax + s.dy * ay < W.arcCos) { ax = s.dx; ay = s.dy; }
        sim.projectiles.push({ kind: 'slug', side: s.side, owner: s.id, x: s.x + s.dx * s.radius, y: s.y + s.dy * s.radius,
          dx: ax, dy: ay, speed: W.speed, dmg: W.dmg, ttl: Math.round((W.range + 60) / W.speed * TICK_RATE), targetId: -1, r: 5, dead: false });
        sim.fx.push({ t: 'muzzle', x: s.x, y: s.y, side: s.side });
        break;
      }
      case 'missile': {
        let ax = tgt.x - s.x, ay = tgt.y - s.y;
        const al = Math.sqrt(ax * ax + ay * ay) || 1;
        ax /= al; ay /= al;
        // Slight random launch angle so volleys spread deterministically.
        const ang = (rand(sim) - 0.5) * 1.2;
        const c = dcos(ang), sn = dsin(ang);
        const rx = ax * c - ay * sn, ry = ax * sn + ay * c;
        sim.projectiles.push({ kind: 'missile', side: s.side, owner: s.id, x: s.x, y: s.y, dx: rx, dy: ry,
          speed: W.speed, dmg: W.dmg, ttl: Math.round(W.life * TICK_RATE), targetId: tgt.id,
          turnC: dcos(W.turn * DT), turnS: dsin(W.turn * DT), r: 6, hp: W.hp, dead: false });
        break;
      }
      case 'flak':
        flakBurst(sim, s, tgt.x, tgt.y, W);
        break;
      default: break;
    }
  }
}

function flakBurst(sim, s, x, y, W) {
  const r2 = W.splash * W.splash;
  for (const e of sim.ships) {
    if (!e.alive || e.side === s.side) continue;
    const dx = e.x - x, dy = e.y - y;
    const rr = W.splash + e.radius;
    if (dx * dx + dy * dy <= rr * rr) damage(sim, e, W.dmg, s);
  }
  for (const p of sim.projectiles) {
    if (p.dead || p.side === s.side || p.kind !== 'missile') continue;
    const dx = p.x - x, dy = p.y - y;
    if (dx * dx + dy * dy <= r2) { p.hp -= W.dmg; if (p.hp <= 0) { p.dead = true; sim.fx.push({ t: 'pop', x: p.x, y: p.y }); } }
  }
  sim.fx.push({ t: 'flak', x, y, x1: s.x, y1: s.y, side: s.side, r: W.splash });
}

function updateProjectiles(sim) {
  const ps = sim.projectiles;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.dead) continue;
    if (p.kind === 'missile') {
      let t = p.targetId >= 0 ? sim.ships[p.targetId] : null;
      if (!t || !t.alive) {
        t = null; let bd = 1e18;
        for (const e of sim.ships) {
          if (!e.alive || e.side === p.side) continue;
          const d = dist(p, e); if (d < bd) { bd = d; t = e; }
        }
        p.targetId = t ? t.id : -1;
      }
      if (t) {
        let ax = t.x - p.x, ay = t.y - p.y;
        const al = Math.sqrt(ax * ax + ay * ay);
        if (al > 0.001) {
          ax /= al; ay /= al;
          const r = rotateToward(p.dx, p.dy, ax, ay, p.turnC, p.turnS);
          p.dx = r[0]; p.dy = r[1];
          const l = Math.sqrt(p.dx * p.dx + p.dy * p.dy); p.dx /= l; p.dy /= l;
        }
      }
    }
    p.x += p.dx * p.speed * DT;
    p.y += p.dy * p.speed * DT;
    p.ttl--;
    if (p.ttl <= 0 || p.x < -50 || p.y < -50 || p.x > WORLD_W + 50 || p.y > WORLD_H + 50) {
      p.dead = true; if (p.kind === 'missile') sim.fx.push({ t: 'pop', x: p.x, y: p.y });
      continue;
    }
    for (const e of sim.ships) {
      if (!e.alive || e.side === p.side) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const rr = e.radius + p.r;
      if (dx * dx + dy * dy <= rr * rr) {
        damage(sim, e, p.dmg, sim.ships[p.owner]);
        sim.fx.push({ t: 'hit', x: p.x, y: p.y, big: p.kind === 'missile' });
        p.dead = true;
        break;
      }
    }
  }
  // Compact (filter preserves order => deterministic).
  let w = 0;
  for (let i = 0; i < ps.length; i++) if (!ps[i].dead) ps[w++] = ps[i];
  ps.length = w;
}

function damage(sim, s, amount, attacker) {
  sim.pending.push({ s, amount, attacker });
}

function applyDamage(sim, s, amount, attacker) {
  if (!s.alive) return;
  s.lastHit = sim.tick;
  let dealt = 0;
  if (s.shield > 0) {
    const a = amount < s.shield ? amount : s.shield;
    s.shield -= a; amount -= a; dealt += a;
  }
  if (amount > 0) {
    let d = amount - s.armor;
    const mn = amount * 0.2;
    if (d < mn) d = mn;
    s.hp -= d; dealt += d;
    if (s.hp <= 0) {
      s.hp = 0; s.alive = false; s.speed = 0;
      sim.players[s.side].lost++;
      if (attacker) attacker.kills++;
      sim.fx.push({ t: 'boom', x: s.x, y: s.y, r: s.radius, side: s.side });
      sim.log.push({ tick: sim.battleTick, side: s.side, msg: s.name + ' destroyed' });
    }
  }
  if (attacker) sim.players[attacker.side].dmg += dealt;
}

function checkOver(sim) {
  let a0 = 0, a1 = 0, f0 = 0, m0 = 0, f1 = 0, m1 = 0;
  for (const s of sim.ships) {
    if (s.side === 0) { m0 += s.maxHp + s.maxShield; if (s.alive) { a0++; f0 += s.hp + s.shield; } }
    else { m1 += s.maxHp + s.maxShield; if (s.alive) { a1++; f1 += s.hp + s.shield; } }
  }
  let winner = -1;
  if (a0 === 0 && a1 === 0) winner = 2;
  else if (a0 === 0) winner = 1;
  else if (a1 === 0) winner = 0;
  else if (sim.battleTick >= sim.settings.timeLimit * TICK_RATE) {
    const r0 = f0 / m0, r1 = f1 / m1;
    winner = r0 > r1 ? 0 : r1 > r0 ? 1 : 2;
  }
  if (winner >= 0) { sim.over = true; sim.winner = winner; sim.endTick = sim.tick; }
}

// ---------- Hash for desync detection ----------
export function hashSim(sim) {
  let h = 2166136261;
  h = hashInt(h, sim.tick); h = hashInt(h, sim.rng);
  h = hashInt(h, sim.paused ? 1 : 0); h = hashInt(h, sim.pauseTicksLeft);
  h = hashInt(h, sim.players[0].pausesLeft); h = hashInt(h, sim.players[1].pausesLeft);
  for (const s of sim.ships) {
    h = hashInt(h, s.alive ? 1 : 0);
    h = hashFloat(h, s.x); h = hashFloat(h, s.y); h = hashFloat(h, s.dx); h = hashFloat(h, s.dy);
    h = hashFloat(h, s.hp); h = hashFloat(h, s.shield); h = hashFloat(h, s.speed);
    h = hashInt(h, s.targetId);
  }
  h = hashInt(h, sim.projectiles.length);
  for (const p of sim.projectiles) { h = hashFloat(h, p.x); h = hashFloat(h, p.y); }
  return h >>> 0;
}

export function fleetHealth(sim, side) {
  let f = 0, m = 0;
  for (const s of sim.ships) if (s.side === side) { m += s.maxHp + s.maxShield; if (s.alive) f += s.hp + s.shield; }
  return m > 0 ? f / m : 0;
}
