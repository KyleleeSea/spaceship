// UI + orchestration: lobby, planning, battle screens; wires net <-> lockstep <-> sim <-> renderer.
import {
  VERSION, DT, TICK_RATE, HULLS, WEAPONS, MODULES, STANCES, TARGETS, RETREATS, PRESETS,
  DEFAULT_SETTINGS, MAX_SHIPS, SETTING_LIMITS,
} from './data.js';
import { createSim, validateFleet, fleetCost, shipCost, normalizeShipDef, shipStats, sanitizeSettings, fleetHealth } from './sim.js';
import { Lockstep } from './lockstep.js';
import { hostRoom, joinRoom, makeCode, normalizeCode, describeError } from './net.js';
import { createBotLink } from './bot.js';
import { createRenderer, TEAM } from './render.js';

const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const app = {
  screen: 'lobby', link: null, isHost: true, side: 0, bot: false,
  settings: sanitizeSettings(DEFAULT_SETTINGS),
  fleet: clone(PRESETS.balanced.ships).map(normalizeShipDef),
  oppFleet: null, myReady: false, oppReady: false,
  sim: null, ls: null, resultShown: false, score: [0, 0],
  waitingSince: 0, lastLogShown: 0,
};
const renderer = createRenderer($('game'));
window.BP = app; // debugging handle

// ---------------- screens ----------------
function showScreen(name) {
  app.screen = name;
  for (const s of ['lobby', 'plan', 'battle']) $('screen-' + s).hidden = s !== name;
  if (name === 'battle') requestAnimationFrame(() => renderer.resize());
}
function setTop(text) { $('topstatus').textContent = text; }
function lobbyStatus(text, isError) {
  const el = $('lobby-status'); el.textContent = text; el.classList.toggle('error', !!isError);
}

// ---------------- networking ----------------
const handlers = {
  onOpen(code) {
    $('host-box').hidden = false; $('host-code').textContent = code;
    lobbyStatus('Room open. Share the code or the invite link.');
    history.replaceState(null, '', `?room=${code}`);
  },
  onConnect() {
    app.link.send({ type: 'hello', version: VERSION });
    lobbyStatus('');
    goPlan();
  },
  onMessage(msg) {
    switch (msg.type) {
      case 'hello':
        if (msg.version !== VERSION) showBanner(`Version mismatch (you ${VERSION}, opponent ${msg.version}). Reload both pages.`);
        break;
      case 'settings':
        if (!app.isHost) { app.settings = sanitizeSettings(msg.settings); unreadyAll(); refreshPlan(); }
        break;
      case 'ready':
        app.oppFleet = msg.fleet; app.oppReady = true; refreshPlan();
        if (app.isHost) maybeStart();
        break;
      case 'unready':
        app.oppReady = false; refreshPlan(); break;
      case 'start':
        if (!app.isHost) startBattle(msg.seed, msg.settings, msg.fleets);
        break;
      case 'input':
        if (app.ls) app.ls.onRemote(msg);
        break;
      case 'rematch':
        if (!app.isHost) { app.settings = sanitizeSettings(msg.settings); goPlan(); }
        break;
      case 'leave':
        handlers.onClose('Opponent left the match.'); break;
      default: break;
    }
  },
  onClose(reason) {
    if (app.screen === 'lobby') { lobbyStatus(reason, true); return; }
    $('disc-sub').textContent = reason;
    $('overlay-disc').hidden = false;
    setTop('Disconnected');
  },
  onError(e) {
    const text = describeError(e);
    if (app.screen === 'lobby') { lobbyStatus(text, true); $('btn-host').disabled = false; $('btn-join').disabled = false; }
    else showBanner(text);
    if (e && e.type === 'peer-unavailable') { app.link && app.link.close(); app.link = null; }
  },
};

function showBanner(text) {
  const b = $('banner'); b.textContent = text; b.hidden = false;
}

function leaveToLobby() {
  try { app.link && app.link.send({ type: 'leave' }); } catch (_) { /* ignore */ }
  try { app.link && app.link.close(); } catch (_) { /* ignore */ }
  app.link = null; app.sim = null; app.ls = null; app.myReady = app.oppReady = false; app.oppFleet = null;
  app.score = [0, 0];
  $('overlay-disc').hidden = true; $('overlay-result').hidden = true; $('banner').hidden = true;
  $('host-box').hidden = true; $('btn-host').disabled = false; $('btn-join').disabled = false;
  history.replaceState(null, '', location.pathname);
  setTop('');
  showScreen('lobby');
}

$('btn-host').onclick = () => {
  const code = makeCode();
  app.isHost = true; app.side = 0; app.bot = false;
  $('btn-host').disabled = true;
  lobbyStatus('Creating room…');
  app.link = hostRoom(code, handlers);
};
$('btn-copy').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${$('host-code').textContent}`;
  try { await navigator.clipboard.writeText(url); $('btn-copy').textContent = 'Copied!'; setTimeout(() => $('btn-copy').textContent = 'Copy invite link', 1500); }
  catch (_) { prompt('Invite link:', url); }
};
$('btn-join').onclick = () => {
  const code = normalizeCode($('join-code').value);
  if (code.length !== 5) { lobbyStatus('Enter a 5-character code.', true); return; }
  app.isHost = false; app.side = 1; app.bot = false;
  $('btn-join').disabled = true;
  lobbyStatus('Connecting…');
  app.link = joinRoom(code, handlers);
};
$('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
$('btn-bot').onclick = () => {
  app.isHost = true; app.side = 0; app.bot = true;
  app.link = createBotLink({ onMessage: m => handlers.onMessage(m), getSim: () => app.sim });
  goPlan();
};

// ---------------- planning ----------------
function goPlan() {
  app.sim = null; app.ls = null; app.resultShown = false;
  app.myReady = false; app.oppReady = false; app.oppFleet = null;
  $('overlay-result').hidden = true; $('overlay-pause').hidden = true; $('overlay-wait').hidden = true; $('banner').hidden = true;
  setTop(app.bot ? 'Practice vs AI' : (app.isHost ? `Room ${$('host-code').textContent} · you are host` : 'Connected · you are guest'));
  buildCodex();
  showScreen('plan');
  refreshPlan();
}

function unreadyAll() { app.myReady = false; app.oppReady = false; }

function refreshPlan() {
  const s = app.settings;
  $('set-budget0').value = s.budget[0]; $('set-budget1').value = s.budget[1];
  $('set-pauses').value = s.pauses; $('set-pauselen').value = s.pauseLen; $('set-time').value = s.timeLimit;
  $('set-bonus').value = s.loserBonus; $('set-live').checked = s.liveOrders;
  for (const id of ['set-budget0', 'set-budget1', 'set-pauses', 'set-pauselen', 'set-time', 'set-bonus', 'set-live']) $(id).disabled = !app.isHost;
  $('settings-note').textContent = app.isHost ? 'You set the rules. Changing them un-readies both players.' : 'The host sets the rules.';
  $('score-line').innerHTML = `<span class="t0">Cyan ${app.score[0]}</span> — <span class="t1">${app.score[1]} Amber</span>`;
  $('side-tag').textContent = app.side === 0 ? 'CYAN' : 'AMBER';
  $('side-tag').style.color = TEAM[app.side].main;
  renderFleetBuilder();
  const btn = $('btn-ready');
  btn.textContent = app.myReady ? 'Ready ✓ (click to edit)' : 'Ready';
  btn.classList.toggle('armed', app.myReady);
  $('opp-status').textContent = app.oppReady ? 'Opponent is ready.' : 'Opponent is drafting…';
}

for (const id of ['set-budget0', 'set-budget1', 'set-pauses', 'set-pauselen', 'set-time', 'set-bonus', 'set-live']) {
  $(id).addEventListener('change', () => {
    if (!app.isHost) return;
    app.settings = sanitizeSettings({
      budget: [$('set-budget0').value, $('set-budget1').value], pauses: $('set-pauses').value, pauseLen: $('set-pauselen').value,
      timeLimit: $('set-time').value, loserBonus: $('set-bonus').value, liveOrders: $('set-live').checked,
    });
    if (app.myReady) app.link.send({ type: 'unready' });
    unreadyAll();
    app.link.send({ type: 'settings', settings: app.settings });
    refreshPlan();
  });
}

document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
  app.fleet = clone(PRESETS[b.dataset.preset].ships).map(normalizeShipDef);
  fleetChanged();
});
$('btn-add-ship').onclick = () => {
  if (app.fleet.length >= MAX_SHIPS) return;
  app.fleet.push(normalizeShipDef({ hull: 'interceptor', weapons: ['laser'], modules: ['none'] }));
  fleetChanged();
};
function fleetChanged() {
  if (app.myReady) { app.myReady = false; app.link.send({ type: 'unready' }); }
  refreshPlan();
}

function opt(sel, items, value, labelOf) {
  for (const k of items) {
    const o = document.createElement('option'); o.value = k; o.textContent = labelOf(k); if (k === value) o.selected = true; sel.appendChild(o);
  }
  return sel;
}

// Orders controls, shared by planner and battle panel.
function buildOrders(container, orders, myCount, oppCount, selfIdx, onChange) {
  container.innerHTML = '';
  const mk = (label, el) => { const l = document.createElement('label'); l.textContent = label; l.appendChild(el); container.appendChild(l); return el; };
  const stance = opt(document.createElement('select'), Object.keys(STANCES), orders.stance, k => STANCES[k].name);
  mk('Stance', stance);
  const target = opt(document.createElement('select'), Object.keys(TARGETS), orders.target, k => TARGETS[k].name);
  mk('Target', target);
  const retreat = opt(document.createElement('select'), RETREATS.map(String), String(orders.retreat), k => k === '0' ? 'Never retreat' : `Retreat under ${k}% hp`);
  mk('Retreat', retreat);
  let guard = null, focus = null;
  const refreshAux = () => {
    if (guard) { guard.parentElement.remove(); guard = null; }
    if (focus) { focus.parentElement.remove(); focus = null; }
    if (stance.value === 'guard') {
      const allies = []; for (let i = 0; i < myCount; i++) if (i !== selfIdx) allies.push(String(i));
      if (allies.length) {
        guard = opt(document.createElement('select'), allies, String(allies.includes(String(orders.guard)) ? orders.guard : allies[0]), k => `Ally #${+k + 1}`);
        mk('Guard', guard);
        guard.onchange = () => { orders.guard = +guard.value; onChange({ guard: orders.guard }); };
        if (String(orders.guard) !== guard.value) { orders.guard = +guard.value; onChange({ guard: orders.guard }); }
      }
    }
    if (target.value === 'focus') {
      const foes = []; for (let i = 0; i < (oppCount || MAX_SHIPS); i++) foes.push(String(i));
      focus = opt(document.createElement('select'), foes, String(Math.min(orders.focus, foes.length - 1)), k => `Enemy #${+k + 1}`);
      mk('Focus', focus);
      focus.onchange = () => { orders.focus = +focus.value; onChange({ focus: orders.focus }); };
    }
  };
  stance.onchange = () => { orders.stance = stance.value; onChange({ stance: orders.stance }); refreshAux(); };
  target.onchange = () => { orders.target = target.value; onChange({ target: orders.target }); refreshAux(); };
  retreat.onchange = () => { orders.retreat = +retreat.value; onChange({ retreat: orders.retreat }); };
  refreshAux();
  return { setEnabled(on) { container.querySelectorAll('select').forEach(s => s.disabled = !on); } };
}

function statsLine(def) {
  const st = shipStats(def);
  const r = st.minRange === st.maxRange ? `${st.maxRange}` : `${st.minRange}–${st.maxRange}`;
  return `HP ${st.hp}${st.shield ? ` + ${st.shield} shield` : ''}${st.armor ? ` · Armor ${st.armor}` : ''} · Speed ${Math.round(st.maxSpeed)} · DPS ${st.dps.toFixed(0)} · Range ${r}${st.repair ? ` · Repair ${st.repair}/s` : ''}`;
}

function renderFleetBuilder() {
  const list = $('ship-list'); list.innerHTML = '';
  const budget = app.settings.budget[app.side];
  const v = validateFleet(app.fleet, budget);
  $('fleet-cost').textContent = v.cost; $('fleet-budget').textContent = budget;
  $('fleet-cost').parentElement.classList.toggle('over', v.cost > budget);
  $('fleet-errors').textContent = v.errors.join(' ');
  $('btn-ready').disabled = !v.ok && !app.myReady;
  $('btn-add-ship').disabled = app.fleet.length >= MAX_SHIPS;
  app.fleet.forEach((def, i) => {
    const card = document.createElement('div'); card.className = 'ship-card';
    const head = document.createElement('div'); head.className = 'ship-head';
    const num = document.createElement('span'); num.className = 'ship-num'; num.textContent = '#' + (i + 1); head.appendChild(num);
    const hull = opt(document.createElement('select'), Object.keys(HULLS), def.hull, k => `${HULLS[k].name} (${HULLS[k].cost})`);
    hull.title = HULLS[def.hull].desc;
    hull.onchange = () => { app.fleet[i] = normalizeShipDef({ ...def, hull: hull.value }); fleetChanged(); };
    head.appendChild(hull);
    const cost = document.createElement('span'); cost.className = 'cost'; cost.textContent = `${shipCost(def)} pts`; head.appendChild(cost);
    const x = document.createElement('button'); x.className = 'ghost small x'; x.textContent = '✕'; x.title = 'Remove ship';
    x.onclick = () => { app.fleet.splice(i, 1); fleetChanged(); }; head.appendChild(x);
    card.appendChild(head);
    const ws = document.createElement('div'); ws.className = 'slots';
    ws.innerHTML = '<span class="lbl">Weapons</span>';
    def.weapons.forEach((w, wi) => {
      const sel = opt(document.createElement('select'), Object.keys(WEAPONS), w, k => k === 'none' ? WEAPONS[k].name : `${WEAPONS[k].name} (${WEAPONS[k].cost})`);
      sel.title = WEAPONS[w].desc || '';
      sel.onchange = () => { def.weapons[wi] = sel.value; fleetChanged(); }; ws.appendChild(sel);
    });
    card.appendChild(ws);
    const ms = document.createElement('div'); ms.className = 'slots';
    ms.innerHTML = '<span class="lbl">Modules</span>';
    def.modules.forEach((m, mi) => {
      const sel = opt(document.createElement('select'), Object.keys(MODULES), m, k => k === 'none' ? MODULES[k].name : `${MODULES[k].name} (${MODULES[k].cost})`);
      sel.title = MODULES[m].desc || '';
      sel.onchange = () => { def.modules[mi] = sel.value; fleetChanged(); }; ms.appendChild(sel);
    });
    card.appendChild(ms);
    const st = document.createElement('div'); st.className = 'stats'; st.textContent = statsLine(def); card.appendChild(st);
    const od = document.createElement('div'); od.className = 'orders'; card.appendChild(od);
    buildOrders(od, def.orders, app.fleet.length, app.oppFleet ? app.oppFleet.length : 0, i, () => { if (app.screen === 'plan' && app.myReady) fleetChanged(); });
    list.appendChild(card);
  });
}

$('btn-ready').onclick = () => {
  if (app.myReady) { app.myReady = false; app.link.send({ type: 'unready' }); refreshPlan(); return; }
  const v = validateFleet(app.fleet, app.settings.budget[app.side]);
  if (!v.ok) { refreshPlan(); return; }
  app.fleet = v.fleet; app.myReady = true;
  app.link.send({ type: 'ready', fleet: app.fleet });
  refreshPlan();
  if (app.isHost) maybeStart();
};

function maybeStart() {
  if (!app.isHost || !app.myReady || !app.oppReady || app.sim) return;
  const ov = validateFleet(app.oppFleet, app.settings.budget[1]);
  if (!ov.ok) { $('opp-status').textContent = 'Opponent fleet is invalid: ' + ov.errors.join(' '); app.oppReady = false; return; }
  const seed = (Math.random() * 4294967296) >>> 0;
  const fleets = [app.fleet, ov.fleet];
  app.link.send({ type: 'start', seed, settings: app.settings, fleets });
  startBattle(seed, app.settings, fleets);
}

// ---------------- battle ----------------
let battleOrderCtls = [];
function startBattle(seed, settings, fleets) {
  app.settings = sanitizeSettings(settings);
  const v0 = validateFleet(fleets[0], app.settings.budget[0]), v1 = validateFleet(fleets[1], app.settings.budget[1]);
  if (!v0.ok || !v1.ok) { showBanner('Invalid fleets at start: ' + [...v0.errors, ...v1.errors].join(' ')); }
  app.sim = createSim(app.settings, [v0.fleet, v1.fleet], seed);
  app.ls = new Lockstep({
    sim: app.sim, localSide: app.side, send: m => app.link.send(m),
    onDesync: t => showBanner(`Desync detected at turn ${t}. The two simulations have diverged; results may differ.`),
  });
  app.resultShown = false; app.lastLogShown = 0; app.waitingSince = 0;
  $('battle-log').innerHTML = '';
  buildBattleOrders();
  $('orders-hint').innerHTML = app.settings.liveOrders ? 'Live orders are on: change orders any time.' : 'Pause to change orders. <kbd>Space</kbd> pauses/resumes.';
  showScreen('battle');
  setTop((app.bot ? 'Practice vs AI' : 'P2P lockstep') + ` · seed ${seed}`);
  acc = 0; last = performance.now();
}

function buildBattleOrders() {
  const box = $('battle-orders'); box.innerHTML = ''; battleOrderCtls = [];
  const mine = app.sim.ships.filter(s => s.side === app.side);
  const oppCount = app.sim.ships.length - mine.length;
  mine.forEach(ship => {
    const card = document.createElement('div'); card.className = 'ship-card'; card.dataset.ship = ship.id;
    const head = document.createElement('div'); head.className = 'ship-head';
    head.innerHTML = `<span class="ship-num">#${ship.idx + 1}</span><span>${ship.name}</span><span class="cost">${ship.weapons.map(w => WEAPONS[w.key].name).join(', ')}</span>`;
    card.appendChild(head);
    const od = document.createElement('div'); od.className = 'orders'; card.appendChild(od);
    const local = clone(ship.orders);
    const ctl = buildOrders(od, local, mine.length, oppCount, ship.idx, partial => {
      app.ls.queueCommand({ c: 'orders', i: ship.idx, o: partial });
    });
    battleOrderCtls.push({ ctl, ship, card });
    box.appendChild(card);
  });
}

function canEditOrders() {
  const sim = app.sim;
  return !!sim && !sim.over && (sim.paused || sim.settings.liveOrders);
}

function togglePause() {
  const sim = app.sim; if (!sim || sim.over) return;
  if (sim.paused) { if (sim.pausedBy === app.side) app.ls.queueCommand({ c: 'resume' }); }
  else if (sim.players[app.side].pausesLeft > 0) app.ls.queueCommand({ c: 'pause' });
}
$('btn-pause').onclick = togglePause;
$('btn-resume-overlay').onclick = togglePause;
window.addEventListener('keydown', e => {
  if (app.screen !== 'battle' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
});

function updateHud() {
  const sim = app.sim;
  const remaining = Math.max(0, sim.settings.timeLimit - sim.battleTick / TICK_RATE);
  $('hud-time').textContent = fmtTime(remaining);
  $('bar0').style.width = (fleetHealth(sim, 0) * 100).toFixed(1) + '%';
  $('bar1').style.width = (fleetHealth(sim, 1) * 100).toFixed(1) + '%';
  const me = sim.players[app.side].pausesLeft, op = sim.players[1 - app.side].pausesLeft;
  $('hud-pauses').textContent = `you ${me} · opponent ${op}`;
  const btn = $('btn-pause');
  if (sim.paused) {
    btn.textContent = sim.pausedBy === app.side ? `Resume (${Math.ceil(sim.pauseTicksLeft / TICK_RATE)}s)` : `Opponent paused (${Math.ceil(sim.pauseTicksLeft / TICK_RATE)}s)`;
    btn.disabled = sim.pausedBy !== app.side;
  } else { btn.textContent = `Pause (${me} left)`; btn.disabled = me <= 0 || sim.over; }
  const ov = $('overlay-pause');
  if (sim.paused && !sim.over) {
    ov.hidden = false;
    $('pause-title').textContent = sim.pausedBy === app.side ? 'YOU PAUSED' : 'OPPONENT PAUSED';
    $('pause-sub').textContent = `${Math.ceil(sim.pauseTicksLeft / TICK_RATE)}s left · both sides may rewrite orders now`;
    $('btn-resume-overlay').hidden = sim.pausedBy !== app.side;
  } else ov.hidden = true;
  const edit = canEditOrders();
  for (const { ctl, ship, card } of battleOrderCtls) { ctl.setEnabled(edit && ship.alive); card.classList.toggle('dead', !ship.alive); }
  while (app.lastLogShown < sim.log.length) {
    const e = sim.log[app.lastLogShown++];
    const d = document.createElement('div');
    d.innerHTML = `<span class="${e.side === 0 ? 't0' : 't1'}">${fmtTime(e.tick / TICK_RATE)}</span> ${e.side === app.side ? 'You' : 'Enemy'}: ${e.msg}`;
    $('battle-log').prepend(d);
  }
  const waiting = app.ls.waiting && !app.bot;
  if (waiting) { if (!app.waitingSince) app.waitingSince = performance.now(); }
  else app.waitingSince = 0;
  $('overlay-wait').hidden = !(app.waitingSince && performance.now() - app.waitingSince > 400);
}

function showResult() {
  const sim = app.sim; app.resultShown = true;
  const w = sim.winner;
  if (w === 0 || w === 1) app.score[w]++;
  const mine = w === app.side, draw = w === 2;
  $('result-title').textContent = draw ? 'DRAW' : mine ? 'VICTORY' : 'DEFEAT';
  $('result-title').style.color = draw ? '#fff' : mine ? '#5be28a' : '#ff5c7a';
  $('result-sub').textContent = sim.battleTick >= sim.settings.timeLimit * TICK_RATE ? 'Time limit reached: decided on remaining fleet strength.' : `Battle lasted ${fmtTime(sim.battleTick / TICK_RATE)}.`;
  const p = sim.players, me = app.side, op = 1 - me;
  $('result-stats').innerHTML = `
    <div>Damage dealt</div><div>${p[me].dmg.toFixed(0)} vs ${p[op].dmg.toFixed(0)}</div>
    <div>Ships lost</div><div>${p[me].lost} vs ${p[op].lost}</div>
    <div>Fleet remaining</div><div>${(fleetHealth(sim, me) * 100).toFixed(0)}% vs ${(fleetHealth(sim, op) * 100).toFixed(0)}%</div>
    <div>Score</div><div><span class="t0">Cyan ${app.score[0]}</span> — <span class="t1">${app.score[1]} Amber</span></div>`;
  const bonus = sim.settings.loserBonus;
  $('btn-rematch').hidden = !app.isHost;
  $('btn-rematch').textContent = (!draw && bonus > 0) ? `Rematch (loser +${bonus} pts)` : 'Rematch';
  if (!app.isHost) $('result-sub').textContent += ' Waiting for the host to start a rematch.';
  $('overlay-result').hidden = false;
}
$('btn-rematch').onclick = () => {
  if (!app.isHost || !app.sim) return;
  const w = app.sim.winner, s = clone(app.settings);
  if ((w === 0 || w === 1) && s.loserBonus > 0) s.budget[1 - w] = Math.min(SETTING_LIMITS.budget[1], s.budget[1 - w] + s.loserBonus);
  app.settings = sanitizeSettings(s);
  app.link.send({ type: 'rematch', settings: app.settings });
  goPlan();
};
$('btn-leave').onclick = leaveToLobby;
$('btn-disc-leave').onclick = leaveToLobby;

// ---------------- main loop ----------------
let last = performance.now(), acc = 0;
function advance(dt) {
  acc += dt;
  let guard = 0;
  while (acc >= DT && guard++ < 20) {
    if (app.ls.step()) acc -= DT;
    else { if (acc > DT * 3) acc = DT * 3; break; }
  }
}
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  if (app.screen === 'battle' && app.sim && app.ls) {
    advance(dt);
    renderer.render(app.sim, app.side, dt);
    updateHud();
    if (app.sim.over && !app.resultShown) showResult();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Browsers throttle requestAnimationFrame in background or hidden tabs. A timer
// keeps the lockstep moving so an alt-tabbed player does not freeze the opponent;
// rAF only adds rendering on top of the same clock.
setInterval(() => {
  if (app.screen !== 'battle' || !app.sim || !app.ls) return;
  const now = performance.now();
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  advance(dt);
}, 100);
window.addEventListener('resize', () => { if (app.screen === 'battle') renderer.resize(); });
window.addEventListener('beforeunload', () => { try { app.link && app.link.send({ type: 'leave' }); } catch (_) { /* ignore */ } });

// ---------------- codex ----------------
function buildCodex() {
  const li = (k, v) => `<li><b>${k}</b> — ${v}</li>`;
  $('codex-weapons').innerHTML = Object.keys(WEAPONS).filter(k => k !== 'none').map(k => { const W = WEAPONS[k]; return li(`${W.name} (${W.cost})`, `${W.dmg} dmg every ${W.cd}s, range ${W.range}. ${W.desc}`); }).join('');
  $('codex-modules').innerHTML = Object.keys(MODULES).filter(k => k !== 'none').map(k => li(`${MODULES[k].name} (${MODULES[k].cost})`, MODULES[k].desc)).join('');
  $('codex-hulls').innerHTML = Object.keys(HULLS).map(k => { const H = HULLS[k]; return li(`${H.name} (${H.cost})`, `${H.hp} hp, speed ${H.speed}, ${H.wslots} weapon${H.wslots > 1 ? 's' : ''}, ${H.mslots} module${H.mslots > 1 ? 's' : ''}. ${H.desc}`); }).join('');
  $('codex-stances').innerHTML = Object.keys(STANCES).map(k => li(STANCES[k].name, STANCES[k].desc)).join('');
}

// ---------------- boot ----------------
(function boot() {
  const room = normalizeCode(new URLSearchParams(location.search).get('room'));
  if (room.length === 5) { $('join-code').value = room; $('join-code').focus(); lobbyStatus(`Invite for room ${room}. Press Join.`); }
  if (typeof Peer === 'undefined') lobbyStatus('Could not load the WebRTC library (offline?). Practice mode still works.', true);
})();
