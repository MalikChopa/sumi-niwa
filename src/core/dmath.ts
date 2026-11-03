// Mathématiques déterministes (SPEC §4.1, ARCHITECTURE §1) : uniquement + − × ÷, `Math.round`, `Math.sqrt`
// (exacts en IEEE 754, donc identiques sur tout moteur conforme). Aucun `Math.sin`, `Math.cos`, `Math.atan2`,
// `Math.pow`, `**` : leurs résultats peuvent varier d'un moteur à l'autre. Le test de garde le vérifie.
// Précision mesurée par tests/unit/dmath.test.ts (exigence SPEC/ARCHITECTURE 12.1 : écart < 1e-9).

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

// Réduction d'angle de Cody et Waite : π/2 en deux morceaux (le premier tient sur 33 bits de mantisse,
// donc k × PIO2_HI est exact tant que |k| < 2^20).
const PIO2_HI = 1.5707963267341256; // 0x3FF921FB54400000
const PIO2_LO = 6.077100506506192e-11; // π/2 − PIO2_HI

/** Polynôme de Taylor du sinus sur [−π/4, π/4] (terme d'erreur < 3e-14). */
function sinPoly(r: number): number {
  const r2 = r * r;
  return (
    r *
    (1 +
      r2 *
        (-1 / 6 +
          r2 *
            (1 / 120 +
              r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800 + r2 * (1 / 6227020800 + r2 * (-1 / 1307674368000))))))))
  );
}

/** Polynôme de Taylor du cosinus sur [−π/4, π/4] (terme d'erreur < 2e-15). */
function cosPoly(r: number): number {
  const r2 = r * r;
  return (
    1 +
    r2 *
      (-1 / 2 +
        r2 *
          (1 / 24 +
            r2 *
              (-1 / 720 +
                r2 * (1 / 40320 + r2 * (-1 / 3628800 + r2 * (1 / 479001600 + r2 * (-1 / 87178291200 + r2 / 20922789888000)))))))
  );
}

/** Réduit x en (quadrant k mod 4, reste r dans [−π/4, π/4]). */
function reduce(x: number): [number, number] {
  const k = Math.round(x / HALF_PI);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  const q = ((k % 4) + 4) % 4;
  return [q, r];
}

export function sin(x: number): number {
  const [q, r] = reduce(x);
  if (q === 0) return sinPoly(r);
  if (q === 1) return cosPoly(r);
  if (q === 2) return -sinPoly(r);
  return -cosPoly(r);
}

export function cos(x: number): number {
  const [q, r] = reduce(x);
  if (q === 0) return cosPoly(r);
  if (q === 1) return -sinPoly(r);
  if (q === 2) return -cosPoly(r);
  return sinPoly(r);
}

const TAN_PI_8 = 0.41421356237309503; // √2 − 1
const PI_4 = 0.7853981633974483;

/** Série d'arctangente pour |z| ≤ tan(π/16) ≈ 0,199 (24 termes : erreur < 1e-17). */
function atanSeries(z: number): number {
  const z2 = z * z;
  let s = 0;
  for (let n = 23; n >= 0; n--) {
    const term = 1 / (2 * n + 1);
    s = (n % 2 === 0 ? term : -term) + z2 * s;
  }
  return z * s;
}

/** atan(z) pour z ≥ 0, par réductions exactes en arithmétique de base. */
function atanPos(z: number): number {
  let offset = 0;
  let t = z;
  if (t > 1) {
    t = 1 / t;
    offset = HALF_PI;
    return offset - atanPos(t);
  }
  // atan(t) = π/4 + atan((t − 1)/(t + 1)) quand t > tan(π/8)
  if (t > TAN_PI_8) {
    offset = PI_4;
    t = (t - 1) / (t + 1);
  }
  // atan(t) = 2 atan(t / (1 + √(1 + t²))) : |t| ≤ tan(π/8) → ≤ tan(π/16)
  const half = t / (1 + Math.sqrt(1 + t * t));
  return offset + 2 * atanSeries(half);
}

export function atan(z: number): number {
  return z < 0 ? -atanPos(-z) : atanPos(z);
}

/** atan2(y, x) dans ]−π, π]. */
export function atan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  if (x === 0) return y > 0 ? HALF_PI : -HALF_PI;
  const a = atan(y / x);
  if (x > 0) return a;
  return y >= 0 ? a + PI : a - PI;
}

/** √(x² + y²) (Math.hypot n'est pas dans la liste blanche). */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
