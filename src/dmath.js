// Deterministic math helpers.
// Lockstep requires bit-identical results on every peer. IEEE-754 guarantees
// +, -, *, / and sqrt are correctly rounded everywhere, but Math.sin/cos/atan2/pow
// are implementation-defined and differ between JS engines. So the simulation
// only ever uses basic ops plus these polynomial trig functions.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

// sin via range reduction to [-pi/2, pi/2] and a Taylor polynomial (Horner form).
export function dsin(x) {
  x = x - TAU * Math.floor((x + PI) / TAU); // now in [-pi, pi)
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156 * (1 - x2 / 210)))))));
}

export function dcos(x) {
  return dsin(x + HALF_PI);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function len(x, y) {
  return Math.sqrt(x * x + y * y);
}

// Rotate unit vector (dx,dy) toward unit vector (tx,ty) by at most one step,
// where c = cos(step), s = sin(step). Snaps when within one step.
export function rotateToward(dx, dy, tx, ty, c, s) {
  const dot = dx * tx + dy * ty;
  if (dot >= c) return [tx, ty];
  const cross = dx * ty - dy * tx;
  if (cross >= 0) return [dx * c - dy * s, dx * s + dy * c];
  return [dx * c + dy * s, -dx * s + dy * c];
}

// FNV-1a style mixing over 32-bit words; floats are hashed by their raw bits.
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
export function hashInt(h, v) {
  return Math.imul(h ^ (v >>> 0), 16777619) >>> 0;
}
export function hashFloat(h, v) {
  f64[0] = v;
  h = Math.imul(h ^ u32[0], 16777619) >>> 0;
  return Math.imul(h ^ u32[1], 16777619) >>> 0;
}
