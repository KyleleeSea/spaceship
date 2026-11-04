// Canvas renderer. Purely cosmetic: may use Math.random and real time freely,
// because nothing here feeds back into the simulation.
import { WORLD_W, WORLD_H } from './data.js';

const SHAPES = {
  interceptor: [[14, 0], [-9, 8], [-5, 0], [-9, -8]],
  frigate: [[18, 0], [6, 9], [-12, 9], [-15, 0], [-12, -9], [6, -9]],
  cruiser: [[28, 0], [14, 11], [-8, 15], [-24, 9], [-24, -9], [-8, -15], [14, -11]],
};
export const TEAM = [
  { main: '#4fd1ff', dark: '#15506b', glow: 'rgba(79,209,255,', name: 'CYAN' },
  { main: '#ffa14f', dark: '#6b3a15', glow: 'rgba(255,161,79,', name: 'AMBER' },
];

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const stars = [];
  for (let i = 0; i < 220; i++) stars.push({ x: Math.random() * WORLD_W, y: Math.random() * WORLD_H, r: Math.random() * 1.4 + 0.3, a: Math.random() * 0.5 + 0.2 });
  let particles = [];
  let scale = 1, dpr = 1;

  function resize() {
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    scale = Math.min(w / WORLD_W, h / WORLD_H);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(WORLD_W * scale * dpr);
    canvas.height = Math.floor(WORLD_H * scale * dpr);
    canvas.style.width = Math.floor(WORLD_W * scale) + 'px';
    canvas.style.height = Math.floor(WORLD_H * scale) + 'px';
  }

  function spark(x, y, color, n, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = Math.random() * speed;
      particles.push({ kind: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size: size * (0.5 + Math.random()) });
    }
  }

  function pullFx(sim) {
    // If rendering stalled (hidden tab), drop the backlog instead of bursting hundreds of effects.
    if (sim.fx.length > 80) sim.fx.splice(0, sim.fx.length - 80);
    for (const f of sim.fx) {
      switch (f.t) {
        case 'beam': particles.push({ kind: 'beam', x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, color: TEAM[f.side].main, life: 0.07, max: 0.07 }); spark(f.x2, f.y2, TEAM[f.side].main, 2, 60, 0.25, 1.5); break;
        case 'flak': particles.push({ kind: 'ring', x: f.x, y: f.y, r: f.r * 0.7, color: TEAM[f.side].main, life: 0.1, max: 0.1 }); spark(f.x, f.y, '#ffd9a0', 3, 90, 0.2, 1.5); particles.push({ kind: 'beam', x1: f.x1, y1: f.y1, x2: f.x, y2: f.y, color: 'rgba(255,255,255,0.35)', life: 0.04, max: 0.04 }); break;
        case 'muzzle': spark(f.x, f.y, '#ffffff', 3, 80, 0.15, 2); break;
        case 'hit': spark(f.x, f.y, '#ffe9a8', f.big ? 14 : 6, f.big ? 220 : 120, 0.4, 2); if (f.big) particles.push({ kind: 'ring', x: f.x, y: f.y, r: 26, color: '#ffd27f', life: 0.25, max: 0.25 }); break;
        case 'pop': spark(f.x, f.y, '#ff8c5a', 6, 90, 0.3, 1.5); break;
        case 'boom': spark(f.x, f.y, TEAM[f.side].main, 30, 260, 0.9, 2.5); spark(f.x, f.y, '#ffffff', 12, 140, 0.5, 2); particles.push({ kind: 'ring', x: f.x, y: f.y, r: f.r * 3.5, color: '#ffffff', life: 0.5, max: 0.5 }); break;
        case 'text': particles.push({ kind: 'text', x: f.x, y: f.y - 30, msg: f.msg, color: TEAM[f.side].main, life: 1.2, max: 1.2 }); break;
        default: break;
      }
    }
    sim.fx.length = 0;
  }

  function poly(pts, x, y, dx, dy) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i][0], py = pts[i][1];
      const rx = x + px * dx - py * dy, ry = y + px * dy + py * dx;
      if (i === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
    }
    ctx.closePath();
  }

  function render(sim, mySide, dt) {
    pullFx(sim);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    // Background.
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    const g = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, 100, WORLD_W / 2, WORLD_H / 2, 1100);
    g.addColorStop(0, 'rgba(40,60,110,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    for (const s of stars) { ctx.fillStyle = `rgba(255,255,255,${s.a})`; ctx.fillRect(s.x, s.y, s.r, s.r); }
    // Home edges.
    for (let side = 0; side < 2; side++) {
      const x0 = side === 0 ? 0 : WORLD_W - 120;
      const gg = ctx.createLinearGradient(x0, 0, x0 + 120, 0);
      const c = TEAM[side].glow;
      gg.addColorStop(side === 0 ? 0 : 1, c + '0.18)'); gg.addColorStop(side === 0 ? 1 : 0, c + '0)');
      ctx.fillStyle = gg; ctx.fillRect(x0, 0, 120, WORLD_H);
      ctx.fillStyle = c + '0.6)'; ctx.font = 'bold 22px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = side === 0 ? 'left' : 'right';
      ctx.fillText(side === mySide ? 'YOU' : 'ENEMY', side === 0 ? 18 : WORLD_W - 18, 34);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, WORLD_W - 2, WORLD_H - 2);

    // Target lines for own ships.
    ctx.lineWidth = 1;
    for (const s of sim.ships) {
      if (!s.alive || s.side !== mySide || s.targetId < 0) continue;
      const t = sim.ships[s.targetId]; if (!t || !t.alive) continue;
      ctx.strokeStyle = TEAM[mySide].glow + '0.12)';
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    }

    // Projectiles.
    for (const p of sim.projectiles) {
      const c = TEAM[p.side].main;
      if (p.kind === 'slug') {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(p.x - p.dx * 14, p.y - p.dy * 14); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.strokeStyle = c; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x - p.dx * 30, p.y - p.dy * 30); ctx.lineTo(p.x - p.dx * 14, p.y - p.dy * 14); ctx.stroke();
      } else {
        ctx.fillStyle = c;
        poly([[7, 0], [-5, 4], [-5, -4]], p.x, p.y, p.dx, p.dy); ctx.fill();
        ctx.fillStyle = `rgba(255,200,120,${0.5 + Math.random() * 0.5})`;
        ctx.beginPath(); ctx.arc(p.x - p.dx * 8, p.y - p.dy * 8, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Ships.
    for (const s of sim.ships) {
      if (!s.alive) continue;
      const T = TEAM[s.side];
      // Engine glow.
      if (s.speed > 5) {
        const L = 6 + s.speed / 12;
        const gg = ctx.createLinearGradient(s.x, s.y, s.x - s.dx * L * 2, s.y - s.dy * L * 2);
        gg.addColorStop(0, T.glow + '0.7)'); gg.addColorStop(1, T.glow + '0)');
        ctx.strokeStyle = gg; ctx.lineWidth = s.radius * 0.6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s.x - s.dx * s.radius * 0.7, s.y - s.dy * s.radius * 0.7); ctx.lineTo(s.x - s.dx * L * 2, s.y - s.dy * L * 2); ctx.stroke();
        ctx.lineCap = 'butt';
      }
      // Shield bubble.
      if (s.maxShield > 0) {
        const f = s.shield / s.maxShield;
        const hitRecent = sim.tick - s.lastHit < 8 && s.shield > 0;
        ctx.strokeStyle = hitRecent ? 'rgba(255,255,255,0.9)' : `rgba(150,220,255,${0.12 + f * 0.55})`;
        ctx.lineWidth = hitRecent ? 3 : 1.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.radius + 7, 0, Math.PI * 2); ctx.stroke();
      }
      // Hull.
      const sh = SHAPES[s.hull];
      const sc = s.radius / (s.hull === 'interceptor' ? 10 : s.hull === 'frigate' ? 15 : 22);
      const pts = sh.map(p => [p[0] * sc, p[1] * sc]);
      poly(pts, s.x, s.y, s.dx, s.dy);
      ctx.fillStyle = T.dark; ctx.fill();
      ctx.strokeStyle = T.main; ctx.lineWidth = 2; ctx.stroke();
      if (s.retreating) {
        ctx.fillStyle = '#ffe066'; ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('↩', s.x, s.y - s.radius - 20);
      }
      // Bars.
      const bw = s.radius * 2.6, bx = s.x - bw / 2, by = s.y - s.radius - 14;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
      ctx.fillStyle = T.main; ctx.fillRect(bx, by, bw * (s.hp / s.maxHp), 4);
      if (s.maxShield > 0) { ctx.fillStyle = '#9fe0ff'; ctx.fillRect(bx, by - 4, bw * (s.shield / s.maxShield), 2.5); }
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(s.idx + 1), s.x, s.y + s.radius + 16);
    }

    // Particles.
    const alive = [];
    for (const p of particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      const a = Math.max(0, p.life / p.max);
      if (p.kind === 'dot') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96;
        ctx.globalAlpha = a; ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.kind === 'beam') {
        ctx.globalAlpha = a; ctx.strokeStyle = p.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
      } else if (p.kind === 'ring') {
        ctx.globalAlpha = a; ctx.strokeStyle = p.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.3 - a * 0.3), 0, Math.PI * 2); ctx.stroke();
      } else if (p.kind === 'text') {
        p.y -= 20 * dt;
        ctx.globalAlpha = a; ctx.fillStyle = p.color; ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(p.msg, p.x, p.y);
      }
      alive.push(p);
    }
    ctx.globalAlpha = 1;
    particles = alive;
    if (particles.length > 1500) particles.splice(0, particles.length - 1500);
  }

  return { render, resize };
}
