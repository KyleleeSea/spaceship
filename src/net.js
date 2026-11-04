// WebRTC transport via PeerJS. The host's peer id is derived from a short room
// code; the guest connects to it. One reliable, ordered JSON data channel.
const PREFIX = 'sbp-v1-';
const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

export function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)];
  return c;
}

export function normalizeCode(c) {
  return String(c || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function peerAvailable(h) {
  if (typeof Peer === 'undefined') {
    h.onError({ type: 'no-peerjs', message: 'PeerJS library failed to load (offline?). Practice mode still works.' });
    return false;
  }
  return true;
}

function wire(conn, h, state) {
  conn.on('open', () => { state.open = true; h.onConnect(); });
  conn.on('data', d => { if (d && typeof d === 'object') h.onMessage(d); });
  conn.on('close', () => { state.open = false; h.onClose('Connection closed.'); });
  conn.on('error', e => h.onError(e));
}

export function hostRoom(code, h) {
  if (!peerAvailable(h)) return null;
  const state = { open: false };
  let conn = null;
  const peer = new Peer(PREFIX + code.toLowerCase(), { config: ICE, debug: 1 });
  peer.on('open', () => h.onOpen(code));
  peer.on('connection', c => {
    if (conn && state.open) { try { c.close(); } catch (_) { /* ignore */ } return; }
    conn = c; wire(c, h, state);
  });
  peer.on('error', e => h.onError(e));
  peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch (_) { /* ignore */ } });
  return {
    send: m => { if (conn && state.open) conn.send(m); },
    close: () => { try { conn && conn.close(); } catch (_) { /* ignore */ } try { peer.destroy(); } catch (_) { /* ignore */ } },
    get connected() { return state.open; },
  };
}

export function joinRoom(code, h) {
  if (!peerAvailable(h)) return null;
  const state = { open: false };
  let conn = null;
  const peer = new Peer(undefined, { config: ICE, debug: 1 });
  peer.on('open', () => {
    conn = peer.connect(PREFIX + code.toLowerCase(), { reliable: true, serialization: 'json' });
    wire(conn, h, state);
  });
  peer.on('error', e => h.onError(e));
  return {
    send: m => { if (conn && state.open) conn.send(m); },
    close: () => { try { conn && conn.close(); } catch (_) { /* ignore */ } try { peer.destroy(); } catch (_) { /* ignore */ } },
    get connected() { return state.open; },
  };
}

export function describeError(e) {
  const t = e && e.type;
  switch (t) {
    case 'unavailable-id': return 'That room code is already taken. Try again.';
    case 'peer-unavailable': return 'No room with that code is open.';
    case 'network': return 'Cannot reach the signaling server. Check your connection.';
    case 'server-error': return 'Signaling server error. Try again in a moment.';
    case 'browser-incompatible': return 'This browser does not support WebRTC.';
    case 'no-peerjs': return e.message;
    default: return (e && e.message) ? e.message : 'Connection error.';
  }
}
