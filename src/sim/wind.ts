// Vent (F-5, SPEC §6) : champ analytique = impulsions du curseur (anneau de WIND_SAMPLES, gaussiennes de
// WIND_RADIUS qui montent en WIND_RISE_S puis décroissent en WIND_DECAY_S) + brise « curl » lente.
// Le même calcul existe deux fois : en TSL (particules, balancement des tiges, sur GPU) et en JavaScript
// (instrumentation et tests). Les uniformes sont partagés par tous les matériaux.
import {
  BREEZE,
  SWAY_WIND_REF,
  WIND_DECAY_S,
  WIND_GAIN,
  WIND_MAX,
  WIND_RADIUS,
  WIND_RISE_S,
  WIND_SAMPLE_MIN_MS,
  WIND_SAMPLES,
} from '../constants';
import {
  Fn as t_Fn,
  Loop as t_Loop,
  exp as t_exp,
  float as t_float,
  int as t_int,
  length as t_length,
  max as t_max,
  sin as t_sin,
  cos as t_cos,
  uniform as t_uniform,
  uniformArray as t_uniformArray,
  vec2 as t_vec2,
  dot as t_dot,
} from 'three/tsl';
import { Vector4 } from 'three/webgpu';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const Fn: N = t_Fn, Loop: N = t_Loop, exp: N = t_exp, float: N = t_float, int: N = t_int, length: N = t_length, max: N = t_max;
const sin: N = t_sin, cos: N = t_cos, uniform: N = t_uniform, uniformArray: N = t_uniformArray, vec2: N = t_vec2, dot: N = t_dot;

/** Trois ondes de la brise : direction (unitaire), phase, part de l'amplitude. Échelle BREEZE.scale. */
const WAVES = [
  { k: [0.8, 0.6], ph: 0.3, w: 1.0, f: 1.0 },
  { k: [-0.45, 0.89], ph: 2.1, w: 0.7, f: 0.73 },
  { k: [0.96, -0.28], ph: 4.4, w: 0.5, f: 1.37 },
] as const;
const K_BREEZE = (2 * Math.PI) / BREEZE.scale;
const OMEGA = 2 * Math.PI * BREEZE.hz;
/** Amplitude de ψ pour qu'une onde donne ≈ BREEZE.speed uf/s ; plus une dérive moyenne lente vers la droite. */
const PSI_A = BREEZE.speed / (K_BREEZE * 1.6);
const DRIFT = [BREEZE.speed * 0.5, 0] as const;
const INV_2R2 = 1 / (2 * WIND_RADIUS * WIND_RADIUS);

export interface Impulse {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** temps du vent (s) : `event.timeStamp` / 1000 */
  t: number;
}

/** Uniformes partagés (anneau d'impulsions, temps du vent, échelles). */
export const windUniforms = {
  imp: uniformArray(Array.from({ length: WIND_SAMPLES }, () => new Vector4(-1e4, -1e4, 0, 0)), 'vec4'),
  impT: uniformArray(Array.from({ length: WIND_SAMPLES }, () => new Vector4(-1e3, 0, 0, 0)), 'vec4'),
  /** temps du vent (s), même base que `impT` */
  time: uniform(0),
  /** facteur de la brise (saison ; 0 en mode test sans `&fx=1`) */
  breeze: uniform(1),
  /** échelle globale (REDUCED_MOTION.wind = 0,3) */
  scale: uniform(1),
  /** échelle du balancement (REDUCED_MOTION.sway = 0,3) */
  sway: uniform(1),
};

/** Poids temporel d'une impulsion d'âge `age` (s). */
export function impulseWeight(age: number): number {
  if (age < 0 || age > 8) return 0;
  return (1 - Math.exp(-age / WIND_RISE_S)) * Math.exp(-age / WIND_DECAY_S);
}

/** Brise au point (x, y) et au temps t (uf/s), sans le facteur de saison. */
export function breezeAt(x: number, y: number, t: number): [number, number] {
  let vx = DRIFT[0];
  let vy = DRIFT[1];
  for (const w of WAVES) {
    const a = K_BREEZE * (w.k[0] * x + w.k[1] * y) + OMEGA * w.f * t + w.ph;
    const c = Math.cos(a) * PSI_A * K_BREEZE * w.w;
    // v = (∂ψ/∂y, −∂ψ/∂x) pour ψ = A sin(k·p + ωt)
    vx += c * w.k[1];
    vy -= c * w.k[0];
  }
  return [vx, vy];
}

/** Champ complet (JavaScript) : miroir exact de `windNode` (instrumentation, tests). */
export function windAt(imps: readonly Impulse[], x: number, y: number, t: number, breeze = 1, scale = 1): [number, number] {
  let vx = 0;
  let vy = 0;
  let wsum = 0;
  for (const i of imps) {
    const dx = x - i.x;
    const dy = y - i.y;
    const g = Math.exp(-(dx * dx + dy * dy) * INV_2R2) * impulseWeight(t - i.t);
    vx += i.vx * g;
    vy += i.vy * g;
    wsum += g;
  }
  // Impulses qui se recouvrent (16 en 0,5 s le long d'un geste) : moyenne pondérée, pas une somme,
  // sinon un geste lent donnerait déjà le plafond WIND_MAX.
  const norm = Math.max(1, wsum);
  vx /= norm;
  vy /= norm;
  const b = breezeAt(x, y, t);
  vx += b[0] * breeze;
  vy += b[1] * breeze;
  const m = Math.hypot(vx, vy);
  const k = m > WIND_MAX ? WIND_MAX / m : 1;
  return [vx * k * scale, vy * k * scale];
}

/** Déplacement de balancement (uf) d'un point de champ `sway` (0–1) d'une plante de pied (bx, by). */
export function swayAt(imps: readonly Impulse[], bx: number, by: number, sway: number, swayMax: number, t: number, breeze = 1, scale = 1, swayScale = 1): [number, number] {
  const w = windAt(imps, bx, by, t, breeze, scale);
  let dx = w[0] / SWAY_WIND_REF;
  let dy = w[1] / SWAY_WIND_REF;
  const m = Math.hypot(dx, dy);
  if (m > 1.2) {
    dx *= 1.2 / m;
    dy *= 1.2 / m;
  }
  const flutter = 1 + 0.15 * Math.sin(2 * Math.PI * 0.7 * t + bx * 0.05);
  const amp = swayMax * sway * swayScale * flutter;
  return [dx * amp, dy * amp * 0.35 + (dx * dx + dy * dy) * amp * 0.12];
}

/** Brise en TSL (uf/s). */
export function breezeNode(p: N, t: N): N {
  let vx: N = float(DRIFT[0]);
  let vy: N = float(DRIFT[1]);
  for (const w of WAVES) {
    const a = dot(p, vec2(w.k[0] * K_BREEZE, w.k[1] * K_BREEZE)).add(t.mul(OMEGA * w.f)).add(w.ph);
    const c = cos(a).mul(PSI_A * K_BREEZE * w.w);
    vx = vx.add(c.mul(w.k[1]));
    vy = vy.sub(c.mul(w.k[0]));
  }
  return vec2(vx, vy);
}

/** Champ de vent en TSL au point p (vec2, uf) : impulsions + brise, plafonné à WIND_MAX, × échelle. */
export const windNode: (p: N) => N = Fn(([p]: [N]) => {
  const t = windUniforms.time;
  const acc = vec2(0, 0).toVar();
  const wsum = float(0).toVar();
  Loop({ start: int(0), end: int(WIND_SAMPLES) }, ({ i }: { i: N }) => {
    const im = windUniforms.imp.element(i);
    const it = windUniforms.impT.element(i);
    const age = t.sub(it.x);
    const d = p.sub(im.xy);
    const g = exp(dot(d, d).mul(-INV_2R2));
    const wt = float(1).sub(exp(age.max(0).div(-WIND_RISE_S))).mul(exp(age.max(0).div(-WIND_DECAY_S)));
    const ok = age.greaterThanEqual(0).and(age.lessThan(8));
    const gw = g.mul(wt).mul(ok.select(float(1), float(0)));
    acc.addAssign(im.zw.mul(gw));
    wsum.addAssign(gw);
  });
  const v = acc.div(max(wsum, 1)).add(breezeNode(p, t).mul(windUniforms.breeze));
  const m = length(v);
  return v.mul(float(WIND_MAX).div(max(m, WIND_MAX))).mul(windUniforms.scale);
});

/** Déplacement de balancement en TSL (miroir de `swayAt`). */
export function swayNode(base: N, sway: N, swayMax: N): N {
  const w = windNode(base).div(SWAY_WIND_REF);
  const m = length(w);
  const d = w.mul(float(1.2).div(max(m, 1.2)));
  const t = windUniforms.time;
  const flutter = sin(t.mul(2 * Math.PI * 0.7).add(base.x.mul(0.05))).mul(0.15).add(1);
  const amp = swayMax.mul(sway).mul(windUniforms.sway).mul(flutter);
  return vec2(d.x.mul(amp), d.y.mul(amp).mul(0.35).add(dot(d, d).mul(amp).mul(0.12)));
}

/**
 * Source de vent : anneau d'impulsions alimenté par le pointeur (déplacement sans bouton, ou geste annulé).
 * `pending` garde les impulsions pas encore montrées, pour mesurer la réponse (WIND_RESPONSE_MS).
 */
export class Wind {
  readonly impulses: Impulse[] = [];
  private head = 0;
  private lastSample: { x: number; y: number; stamp: number } | null = null;
  private lastMove: { x: number; y: number; stamp: number } | null = null;
  /** impulsions ajoutées depuis la dernière image : `event.timeStamp` (ms) */
  pending: number[] = [];

  /** Déplacement du pointeur (x, y en uf, `stamp` = event.timeStamp en ms). */
  move(x: number, y: number, stamp: number): void {
    const prev = this.lastMove;
    this.lastMove = { x, y, stamp };
    if (!this.lastSample || stamp - this.lastSample.stamp > 250) {
      // Pointeur immobile depuis longtemps : la vitesse part du dernier mouvement seulement.
      this.lastSample = prev && stamp - prev.stamp <= 250 ? prev : { x, y, stamp };
      if (this.lastSample.stamp === stamp) return;
    }
    const dtMs = stamp - this.lastSample.stamp;
    if (dtMs < WIND_SAMPLE_MIN_MS) return;
    const vx = ((x - this.lastSample.x) / dtMs) * 1000;
    const vy = ((y - this.lastSample.y) / dtMs) * 1000;
    this.lastSample = { x, y, stamp };
    let ix = vx * WIND_GAIN;
    let iy = vy * WIND_GAIN;
    const m = Math.hypot(ix, iy);
    if (m < 1) return;
    if (m > WIND_MAX) {
      ix *= WIND_MAX / m;
      iy *= WIND_MAX / m;
    }
    this.add({ x, y, vx: ix, vy: iy, t: stamp / 1000 });
    this.pending.push(stamp);
  }

  add(i: Impulse): void {
    if (this.impulses.length < WIND_SAMPLES) this.impulses.push(i);
    else this.impulses[this.head] = i;
    this.head = (this.head + 1) % WIND_SAMPLES;
  }

  /** Écrit l'anneau dans les uniformes ; `nowS` = temps du vent (performance.now() / 1000). */
  upload(nowS: number): void {
    windUniforms.time.value = nowS;
    const a = windUniforms.imp.array as Vector4[];
    const b = windUniforms.impT.array as Vector4[];
    for (let k = 0; k < WIND_SAMPLES; k++) {
      const i = this.impulses[k];
      if (i) {
        a[k]!.set(i.x, i.y, i.vx, i.vy);
        b[k]!.set(i.t, 0, 0, 0);
      } else {
        a[k]!.set(-1e4, -1e4, 0, 0);
        b[k]!.set(-1e3, 0, 0, 0);
      }
    }
  }

  clear(): void {
    this.impulses.length = 0;
    this.head = 0;
    this.pending = [];
  }
}
