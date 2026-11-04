// A local opponent that speaks the same message protocol as a remote peer.
// It lets practice mode exercise the exact lockstep code path used online.
import { PRESETS, DEFAULT_SETTINGS } from './data.js';
import { validateFleet, normalizeShipDef, fleetCost, shipCost, fleetHealth, sanitizeSettings } from './sim.js';

export function botFleet(budget) {
  const keys = Object.keys(PRESETS);
  let fleet = JSON.parse(JSON.stringify(PRESETS[keys[Math.floor(Math.random() * keys.length)]].ships)).map(normalizeShipDef);
  // Trim modules, then ships, until it fits the budget.
  let guard = 0;
  while (fleetCost(fleet) > budget && guard++ < 50) {
    let trimmed = false;
    for (const s of fleet) {
      const mi = s.modules.findIndex(m => m !== 'none');
      if (mi >= 0) { s.modules[mi] = 'none'; trimmed = true; break; }
    }
    if (!trimmed) {
      if (fleet.length > 1) fleet.pop();
      else { const wi = s0(fleet).weapons.findIndex((w, i) => w !== 'none' && i > 0); if (wi > 0) fleet[0].weapons[wi] = 'none'; else break; }
    }
  }
  // Spend leftovers on modules if possible.
  for (const s of fleet) {
    for (let i = 0; i < s.modules.length; i++) {
      if (s.modules[i] === 'none' && fleetCost(fleet) + 2 <= budget) s.modules[i] = Math.random() < 0.5 ? 'shield' : 'engine';
    }
  }
  const v = validateFleet(fleet, budget);
  return v.ok ? v.fleet : [normalizeShipDef({ hull: 'interceptor', weapons: ['laser'] })];
}
function s0(f) { return f[0]; }

export function createBotLink({ onMessage, getSim }) {
  let settings = sanitizeSettings(DEFAULT_SETTINGS);
  let st = null;
  const reply = (m, delay) => { if (delay) setTimeout(() => onMessage(m), delay); else onMessage(m); };

  function think(turn) {
    const sim = getSim();
    if (!sim || sim.over || !st) return [];
    const cmds = [];
    const mine = fleetHealth(sim, 1), theirs = fleetHealth(sim, 0);
    if (st.phase === 0) {
      // Losing? Burn a pause and regroup: focus fire on the weakest, cautious retreats.
      if (!sim.paused && sim.players[1].pausesLeft > 0 && mine < 0.65 && mine < theirs - 0.1 && turn > 30) {
        cmds.push({ c: 'pause' }); st.phase = 1; st.resumeAt = turn + 15;
      }
    } else if (st.phase === 1) {
      if (sim.paused && sim.pausedBy === 1) {
        for (const s of sim.ships) {
          if (s.side !== 1 || !s.alive) continue;
          const o = { target: 'weakest', retreat: 25 };
          if (s.orders.stance === 'hold') o.stance = 'assault';
          cmds.push({ c: 'orders', i: s.idx, o });
        }
        st.phase = 2;
      } else if (turn > st.resumeAt + 10) st.phase = 0; // pause was refused (race); try again later
    } else if (st.phase === 2) {
      if (turn >= st.resumeAt) { cmds.push({ c: 'resume' }); st.phase = 3; }
    } else if (st.phase === 3) {
      // Late game: if far ahead, everyone goes aggressive.
      if (!st.allIn && mine > theirs + 0.3) {
        st.allIn = true;
        for (const s of sim.ships) if (s.side === 1 && s.alive) cmds.push({ c: 'orders', i: s.idx, o: { stance: 'assault', retreat: 0 } });
      }
    }
    return cmds;
  }

  return {
    isBot: true,
    get connected() { return true; },
    send(msg) {
      switch (msg.type) {
        case 'settings': settings = sanitizeSettings(msg.settings); break;
        case 'rematch': settings = sanitizeSettings(msg.settings); break;
        case 'ready': reply({ type: 'ready', fleet: botFleet(settings.budget[1]) }, 350); break;
        case 'start': st = { phase: 0, resumeAt: 0, allIn: false }; break;
        case 'input': reply({ type: 'input', t: msg.t, cmds: think(msg.t), ht: -1, h: 0 }); break;
        default: break;
      }
    },
    close() {},
  };
}
