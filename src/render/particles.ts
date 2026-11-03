// F-6 : particules (SPEC §2.2, §3, §6). Deux tableaux : `P_MOTES` (brume fine d'encre portée par le vent) et
// `P_CARRIERS` (pétales, feuilles, érables, flocons qui tombent, se posent dans la bande du sol, laissent parfois
// une tache, puis repartent). Disposition : A = (x, y, vx, vy) en uf et uf/s ; B = (angle, taille, vie, code) avec
// code = type + 8 × état + 64 × variante. Même code en `complet` (WebGPU) et en `reduit` (compute émulé de Three
// sous WebGL2, vérifié par la sonde du J3) ; seuls les compteurs atomiques (tests, bench) sont réservés à WebGPU.
import { DoubleSide, Mesh, MeshBasicNodeMaterial, NormalBlending, PlaneGeometry, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, AddEquation, type WebGPURenderer } from 'three/webgpu';
import {
  Fn as t_Fn,
  If as t_If,
  abs as t_abs,
  atan as t_atan,
  atomicAdd as t_atomicAdd,
  clamp as t_clamp,
  cos as t_cos,
  exp as t_exp,
  float as t_float,
  floor as t_floor,
  fract as t_fract,
  hash as t_hash,
  instanceIndex as t_instanceIndex,
  instancedArray as t_instancedArray,
  length as t_length,
  max as t_max,
  min as t_min,
  mix as t_mix,
  mod as t_mod,
  pow as t_pow,
  positionGeometry as t_positionGeometry,
  select as t_select,
  sin as t_sin,
  smoothstep as t_smoothstep,
  uniform as t_uniform,
  uint as t_uint,
  varying as t_varying,
  vec2 as t_vec2,
  vec3 as t_vec3,
  vec4 as t_vec4,
} from 'three/tsl';
import {
  CARRIER_FADE_S,
  CARRIER_FALL,
  CARRIER_REST_S,
  CARRIER_SPIN,
  CARRIER_SWING_HZ,
  CARRIER_SWING_UF,
  COL_ERABLE,
  COL_ERABLE_VAR,
  COL_ETE,
  COL_HIVER,
  COL_SAKURA,
  GROUND_Y_MAX,
  GROUND_Y_MIN,
  INK_INJECT,
  MOTE_ALPHA,
  MOTE_DRAG,
  MOTE_MARGIN,
  MOTE_SIZE,
  MOTE_STRETCH_S,
  SHEET_H,
  SHEET_W,
  STAIN_ALPHA,
  STAIN_PROB,
  STAIN_RADIUS_K,
} from '../constants';
import { windNode } from '../sim/wind';
import { inkUniforms } from './ink';
import { additive } from './ink-grid';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const Fn: N = t_Fn, If: N = t_If, abs: N = t_abs, atan: N = t_atan, atomicAdd: N = t_atomicAdd, clamp: N = t_clamp, cos: N = t_cos;
const exp: N = t_exp, float: N = t_float, floor: N = t_floor, fract: N = t_fract, hash: N = t_hash, instanceIndex: N = t_instanceIndex;
const instancedArray: N = t_instancedArray, length: N = t_length, max: N = t_max, min: N = t_min, mix: N = t_mix, mod: N = t_mod, pow: N = t_pow;
const positionGeometry: N = t_positionGeometry, select: N = t_select, sin: N = t_sin, smoothstep: N = t_smoothstep, uniform: N = t_uniform;
const uint: N = t_uint, varying: N = t_varying, vec2: N = t_vec2, vec3: N = t_vec3, vec4: N = t_vec4;

function rgb(hex: string): N {
  const n = parseInt(hex.slice(1), 16);
  return vec3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Bruit de valeur lissé 0–1 (même principe que ink.ts). */
function vnoise(p: N): N {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const k = (dx: number, dy: number) => hash(i.x.add(dx).add(512).add(i.y.add(dy).add(512).mul(2048)));
  return mix(mix(k(0, 0), k(1, 0), u.x), mix(k(0, 1), k(1, 1), u.x), u.y);
}

/** Réglage du J3 après capture : grains × 1,8 et opacité × 0,4 (voile au lieu d'un sel de points). */
const MOTE_SIZE_K = 1.8;
const MOTE_VEIL = 0.4;

const decode = (code: N) => ({ type: mod(code, 8), etat: mod(floor(code.div(8)), 8), variante: floor(code.div(64)) });
const encode = (type: N, etat: N | number, variante: N) => float(type).add(float(etat).mul(8)).add(float(variante).mul(64));

export interface ParticleCounts {
  motes: number;
  carriers: number;
}

export interface ParticleOptions {
  maxMotes: number;
  maxCarriers: number;
  /** compteurs atomiques des poses et des taches (WebGPU seulement) */
  counters: boolean;
  /** graine des tirages initiaux */
  seed: number;
}

/** PRNG simple (initialisation des tampons seulement ; les particules sont libres, SPEC « taches libres »). */
function mulberry(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Particles {
  readonly motesMesh: Mesh;
  readonly carriersMesh: Mesh;
  /** Taches (vers `RT_STAIN`) et eau des poses (vers `RT_WET_INPUT`) : mêmes porteurs, autres matériaux. */
  readonly stainStamp: Mesh;
  readonly wetStamp: Mesh;
  readonly uniforms = {
    dt: uniform(1 / 60),
    time: uniform(0),
    frame: uniform(0),
    /** type des nouveaux porteurs selon la saison (1 pétale, 2 feuille, 3 érable, 4 flocon) */
    seasonType: uniform(1),
    /** mouvement réduit : brume × 0,25 (opacité), chute × 0,6 */
    mist: uniform(1),
    fall: uniform(1),
    /** J4, saisons (SPEC §5) : chute relative à l'automne, part active des porteurs, opacité de la brume relative au J3 */
    seasonFall: uniform(1),
    part: uniform(1),
    seasonMist: uniform(1),
    /** couleur de la brume : sumi, qui vire au gris bleuté avec le poids de l'hiver (calculée côté CPU) */
    mistColor: uniform(vec3(0.118, 0.141, 0.188)),
  };
  readonly computeMotes: N;
  readonly computeCarriers: N;
  private readonly counterBuf: N | null;
  private readonly carrierA: N;
  private readonly carrierB: N;
  private readonly moteA: N;
  private readonly moteB: N;
  readonly max: ParticleCounts;
  active: ParticleCounts = { motes: 0, carriers: 0 };

  constructor(private readonly renderer: WebGPURenderer, opts: ParticleOptions) {
    this.max = { motes: opts.maxMotes, carriers: opts.maxCarriers };
    const rnd = mulberry(opts.seed >>> 0);
    // --- Brume : répartie sur la feuille (et sa marge), vitesses nulles, phase de vie au hasard.
    const ma = new Float32Array(opts.maxMotes * 4);
    const mb = new Float32Array(opts.maxMotes * 4);
    for (let i = 0; i < opts.maxMotes; i++) {
      ma[i * 4] = -MOTE_MARGIN + rnd() * (SHEET_W + 2 * MOTE_MARGIN);
      ma[i * 4 + 1] = -MOTE_MARGIN + rnd() * (SHEET_H + 2 * MOTE_MARGIN);
      mb[i * 4] = rnd() * 6.283;
      mb[i * 4 + 1] = MOTE_SIZE[0] + rnd() * (MOTE_SIZE[1] - MOTE_SIZE[0]);
      mb[i * 4 + 2] = 1;
      mb[i * 4 + 3] = 0;
    }
    // --- Porteurs : déjà en chute à des hauteurs réparties (régime établi dès la première image).
    const ca = new Float32Array(opts.maxCarriers * 4);
    const cb = new Float32Array(opts.maxCarriers * 4);
    for (let i = 0; i < opts.maxCarriers; i++) {
      ca[i * 4] = -100 + rnd() * (SHEET_W + 200);
      ca[i * 4 + 1] = -SHEET_H + rnd() * (SHEET_H + GROUND_Y_MIN - 10);
      cb[i * 4] = rnd() * 6.283;
      cb[i * 4 + 1] = 0;
      cb[i * 4 + 2] = 0;
      cb[i * 4 + 3] = 1 + 64 * Math.floor(rnd() * 3); // type posé à l'initialisation (saison) par le compute
    }
    this.moteA = instancedArray(ma, 'vec4');
    const moteB = instancedArray(mb, 'vec4');
    this.moteB = moteB;
    this.carrierA = instancedArray(ca, 'vec4');
    this.carrierB = instancedArray(cb, 'vec4');
    this.counterBuf = opts.counters ? instancedArray(new Uint32Array(2), 'uint').toAtomic() : null;
    const U = this.uniforms;

    // ------------------------------------------------------------------ compute : brume
    const moteA = this.moteA;
    this.computeMotes = Fn(() => {
      const a = moteA.element(instanceIndex);
      const b = moteB.element(instanceIndex);
      const p = a.xy.toVar();
      const v = a.zw.toVar();
      const seed = float(instanceIndex);
      // Petite turbulence propre à chaque grain (≈ 3 uf/s), pour que la brume ne glisse pas d'un bloc.
      const ph = hash(instanceIndex).mul(6.283);
      const jitter = vec2(sin(U.time.mul(0.7).add(ph)), cos(U.time.mul(0.53).add(ph.mul(1.7)))).mul(3);
      const w = windNode(p).add(jitter);
      const k = float(1).sub(exp(U.dt.mul(-MOTE_DRAG)));
      v.assign(v.add(w.sub(v).mul(k)));
      p.assign(p.add(v.mul(U.dt)));
      const life = b.z.toVar();
      // Sortie de la feuille (marge 50 uf) : réapparition du côté d'où vient le vent (rebouclage), en fondu.
      const W2 = SHEET_W + 2 * MOTE_MARGIN;
      const H2 = SHEET_H + 2 * MOTE_MARGIN;
      const out = p.x.lessThan(-MOTE_MARGIN).or(p.x.greaterThan(SHEET_W + MOTE_MARGIN)).or(p.y.lessThan(-MOTE_MARGIN)).or(p.y.greaterThan(SHEET_H + MOTE_MARGIN));
      If(out, () => {
        p.assign(vec2(fract(p.x.add(MOTE_MARGIN).div(W2)).mul(W2).sub(MOTE_MARGIN), fract(p.y.add(MOTE_MARGIN).div(H2)).mul(H2).sub(MOTE_MARGIN)));
        life.assign(0);
        void seed;
      });
      life.assign(min(life.add(U.dt), 1));
      a.assign(vec4(p, v));
      b.z.assign(life);
    })().compute(opts.maxMotes);

    // ------------------------------------------------------------------ compute : porteurs
    const carrierA = this.carrierA;
    const carrierB = this.carrierB;
    const counters = this.counterBuf;
    this.computeCarriers = Fn(() => {
      const a = carrierA.element(instanceIndex);
      const b = carrierB.element(instanceIndex);
      const i = float(instanceIndex);
      const p = a.xy.toVar();
      const v = a.zw.toVar();
      const ang = b.x.toVar();
      const life = b.z.toVar();
      const d = decode(b.w);
      const type = d.type.toVar();
      const etat = d.etat.toVar();
      const variante = d.variante;
      const size = b.y.toVar();
      const h1 = hash(instanceIndex.mul(3).add(1));
      const h2 = hash(instanceIndex.mul(7).add(2));
      const h3 = hash(instanceIndex.mul(13).add(5));
      // Taille selon le type (uf) ; posée au premier passage (taille 0 à l'initialisation).
      // Profondeur (0 loin … 1 près) : la plupart des porteurs sont petits et pâles, quelques-uns proches et nets ;
      // une averse de porteurs tous pareils ferait des confettis (réglage du J3 après capture).
      const depth = pow(hash(instanceIndex.mul(29).add(17)), 1.6);
      If(size.lessThan(0.1), () => {
        type.assign(U.seasonType);
        size.assign(mix(2.6, 4.2, h1).mul(depth.mul(0.6).add(0.4)).mul(select(type.greaterThan(2.5).and(type.lessThan(3.5)), float(1.25), float(1))));
      });
      If(etat.equal(0), () => {
        const fall = mix(CARRIER_FALL[0], CARRIER_FALL[1], h1).mul(depth.mul(0.5).add(0.5)).mul(U.fall).mul(U.seasonFall);
        const w = windNode(p);
        const hz = mix(CARRIER_SWING_HZ[0], CARRIER_SWING_HZ[1], h2);
        // Oscillation latérale de CARRIER_SWING_UF : vitesse = dérivée de A sin(2πft).
        const swing = cos(U.time.mul(hz.mul(6.283)).add(h3.mul(6.283))).mul(hz.mul(6.283 * CARRIER_SWING_UF));
        const target = vec2(w.x.mul(0.8).add(swing), w.y.mul(0.5).add(fall));
        v.assign(v.add(target.sub(v).mul(min(U.dt.mul(2.5), 1))));
        p.assign(p.add(v.mul(U.dt)));
        const spin = mix(CARRIER_SPIN[0], CARRIER_SPIN[1], h2).mul(select(h3.greaterThan(0.5), float(1), float(-1)));
        ang.assign(ang.add(spin.mul(U.dt)));
        If(p.x.lessThan(-120).or(p.x.greaterThan(SHEET_W + 120)), () => {
          p.x.assign(fract(p.x.add(120).div(SHEET_W + 240)).mul(SHEET_W + 240).sub(120));
        });
        // CARRIER_LAND : hauteur de pose tirée dans la bande du sol par hachage de l'indice.
        const landY = mix(GROUND_Y_MIN, GROUND_Y_MAX, hash(instanceIndex.mul(17).add(11)));
        If(p.y.greaterThanEqual(landY), () => {
          p.y.assign(landY);
          v.assign(vec2(0, 0));
          const stain = hash(instanceIndex.add(U.frame.mul(7919))).lessThan(STAIN_PROB);
          etat.assign(select(stain, float(4), float(2)));
          life.assign(mix(CARRIER_REST_S[0], CARRIER_REST_S[1], hash(instanceIndex.add(U.frame.mul(104729)))));
          if (counters) {
            atomicAdd(counters.element(0), uint(1));
            If(stain, () => {
              atomicAdd(counters.element(1), uint(1));
            });
          }
        });
      })
        .ElseIf(etat.equal(2).or(etat.equal(4)), () => {
          etat.assign(1);
          life.assign(life.sub(U.dt));
        })
        .ElseIf(etat.equal(1), () => {
          life.assign(life.sub(U.dt));
          If(life.lessThan(-CARRIER_FADE_S), () => {
            // Réapparition en haut, au-dessus de la feuille, type de la saison courante.
            const r1 = hash(instanceIndex.add(U.frame.mul(31)));
            const r2 = hash(instanceIndex.add(U.frame.mul(57)).add(3));
            p.assign(vec2(mix(-100, SHEET_W + 100, r1), mix(-30, -140, r2)));
            v.assign(vec2(0, 0));
            etat.assign(0);
            life.assign(0);
            type.assign(U.seasonType);
          });
        });
      a.assign(vec4(p, v));
      b.assign(vec4(ang, size, life, encode(type, etat, variante)));
      void i;
    })().compute(opts.maxCarriers);

    this.motesMesh = this.buildMotesMesh(moteB);
    this.carriersMesh = this.buildCarriersMesh();
    this.stainStamp = this.buildStamp('stain');
    this.wetStamp = this.buildStamp('wet');
  }

  private buildMotesMesh(moteB: N): Mesh {
    const a = this.moteA.element(instanceIndex);
    const b = moteB.element(instanceIndex);
    const U = this.uniforms;
    const corner = positionGeometry.xy; // −0,5 … 0,5
    const sp = length(a.zw);
    const dir = select(sp.greaterThan(0.5), a.zw.div(max(sp, 1e-3)), vec2(1, 0));
    const size = b.y.mul(MOTE_SIZE_K);
    const len = size.add(sp.mul(MOTE_STRETCH_S).min(4));
    const off = vec2(dir.x.mul(corner.x.mul(len)).sub(dir.y.mul(corner.y.mul(size))), dir.y.mul(corner.x.mul(len)).add(dir.x.mul(corner.y.mul(size))));
    const pos = a.xy.add(off);
    // Brume en bancs : opacité modulée par un bruit lent qui dérive avec la brise ; plus visible où le vent souffle.
    const n1 = vnoise(a.xy.div(310).add(vec2(U.time.mul(-0.012), U.time.mul(0.004))));
    const n2 = vnoise(a.xy.div(95).add(vec2(U.time.mul(0.02), 3.1)));
    const bank = smoothstep(0.38, 0.85, n1.mul(0.75).add(n2.mul(0.25)));
    const stir = clamp(sp.div(160), 0, 1);
    const base = mix(MOTE_ALPHA[0], MOTE_ALPHA[1], hash(instanceIndex.add(7)));
    // Brume : des grains plus gros et plus pâles que la valeur de départ, qui se recouvrent en voile (pas en sel).
    const alpha = base.mul(MOTE_VEIL).mul(bank.mul(0.9).add(stir.mul(0.3)).add(0.04)).mul(b.z).mul(U.mist).mul(U.seasonMist);
    const vA = varying(alpha, 'vMoteA');
    const vC = varying(corner, 'vMoteC');
    const mat = new MeshBasicNodeMaterial();
    const v = inkUniforms.view;
    mat.vertexNode = vec4(pos.x.sub(SHEET_W / 2).mul(v.x), float(SHEET_H / 2).sub(pos.y).mul(v.y), 0, 1);
    const r = length(vC.mul(2));
    // Brume : sumi, qui vire au gris bleuté en hiver (SPEC §5, brume « hiver »).
    mat.colorNode = vec4(U.mistColor, float(1).sub(smoothstep(0.35, 1, r)).mul(vA).mul(inkUniforms.fade));
    mat.transparent = true;
    mat.blending = NormalBlending;
    mat.depthTest = false;
    mat.depthWrite = false;
    // Le repère feuille (y vers le bas) retourne le quad : sans DoubleSide il serait éliminé (face arrière).
    mat.side = DoubleSide;
    const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
    mesh.frustumCulled = false;
    (mesh as unknown as { count: number }).count = 0;
    return mesh;
  }

  private buildCarriersMesh(): Mesh {
    const a = this.carrierA.element(instanceIndex);
    const b = this.carrierB.element(instanceIndex);
    const d = decode(b.w);
    const corner = positionGeometry.xy;
    const size = b.y;
    // Basculement 3D suggéré : largeur apparente qui varie avec l'angle (le porteur tourne sur lui-même).
    const tilt = abs(cos(b.x.mul(0.7).add(hash(instanceIndex).mul(3)))).mul(0.75).add(0.25);
    // Flocons (J4) : un peu plus grands et plus soutenus, un flocon gris clair sur du papier crème ne se voyait pas.
    const ext = size.mul(select(d.type.greaterThan(3.5), float(1.8), float(1.3)));
    const lx = corner.x.mul(ext.mul(2));
    const ly = corner.y.mul(ext.mul(2));
    const c = cos(b.x);
    const s = sin(b.x);
    const pos = a.xy.add(vec2(lx.mul(c).sub(ly.mul(s).mul(tilt)), lx.mul(s).add(ly.mul(c).mul(tilt))));
    // Opacité : pleine en vol et au sol, fondu de CARRIER_FADE_S à la fin du repos.
    const resting = d.etat.equal(1).or(d.etat.equal(2)).or(d.etat.equal(4));
    const fade = select(resting.and(b.z.lessThan(0)), float(1).add(b.z.div(CARRIER_FADE_S)), float(1));
    const vL = varying(corner.mul(2.6), 'vCarL'); // −1,3 … 1,3 en unités de taille
    const vType = varying(d.type, 'vCarType');
    const vVar = varying(d.variante, 'vCarVar');
    // Part active (SPEC §5) : chaque porteur est visible si son rang haché est sous la part de la saison (fondu continu).
    const shown = clamp(this.uniforms.part.sub(hash(instanceIndex.mul(41).add(23))).mul(10), 0, 1);
    const vFade = varying(clamp(fade, 0, 1).mul(select(size.greaterThan(0.1), float(1), float(0))).mul(shown), 'vCarFade');
    // Perspective atmosphérique : les porteurs lointains (petits) sont pâles ; posés au sol, ils sont nets.
    const depth = pow(hash(instanceIndex.mul(29).add(17)), 1.6);
    const vDepth = varying(select(resting, float(0.85), depth.mul(depth).mul(0.7).add(0.18)), 'vCarDepth');
    const mat = new MeshBasicNodeMaterial();
    const v = inkUniforms.view;
    mat.vertexNode = vec4(pos.x.sub(SHEET_W / 2).mul(v.x), float(SHEET_H / 2).sub(pos.y).mul(v.y), 0, 1);
    // Formes : pétale (goutte), feuille d'été (lentille), érable (étoile à 5 pointes), flocon (disque doux).
    const x = vL.x;
    const y = vL.y;
    const r = length(vL);
    const petal = float(1).sub(smoothstep(-0.12, 0.12, length(vec2(x.add(0.25), y.mul(1.5))).sub(float(0.75).sub(x.mul(0.2)))));
    const lens = float(1).sub(smoothstep(-0.12, 0.12, abs(y).sub(pow(clamp(float(1).sub(x.mul(x)), 0, 1), 0.8).mul(0.42))));
    const th = atan(y, x);
    const lobes = abs(cos(th.mul(2.5)));
    const maple = float(1).sub(smoothstep(-0.12, 0.12, r.sub(float(0.45).add(lobes.mul(lobes).mul(0.55)))));
    const flake = exp(r.mul(r).mul(-2.2));
    const t = vType;
    const cov = select(t.lessThan(1.5), petal, select(t.lessThan(2.5), lens, select(t.lessThan(3.5), maple, flake)));
    const erable = select(vVar.lessThan(0.5), rgb(COL_ERABLE), select(vVar.lessThan(1.5), rgb(COL_ERABLE_VAR[0]), rgb(COL_ERABLE_VAR[1])));
    const col = select(t.lessThan(1.5), rgb(COL_SAKURA), select(t.lessThan(2.5), rgb(COL_ETE), select(t.lessThan(3.5), erable, rgb(COL_HIVER).mul(0.8))));
    // Pigment qui s'éclaircit vers le bord (lavis), comme les fleurs des plantes.
    const shade = float(1).sub(r.mul(0.22));
    const alpha = cov.mul(select(t.lessThan(3.5), float(0.75), float(1.0))).mul(vFade).mul(vDepth.mul(select(t.lessThan(3.5), float(1), float(1.5)))).mul(inkUniforms.fade);
    mat.colorNode = vec4(col.mul(shade.mul(0.15).add(0.85)), alpha);
    mat.transparent = true;
    mat.blending = NormalBlending;
    mat.depthTest = false;
    mat.depthWrite = false;
    // Le repère feuille (y vers le bas) retourne le quad : sans DoubleSide il serait éliminé (face arrière).
    mat.side = DoubleSide;
    const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
    mesh.frustumCulled = false;
    (mesh as unknown as { count: number }).count = 0;
    return mesh;
  }

  /** Porteurs posés à cette image : tache (état 4) dans `RT_STAIN`, ou eau (états 2 et 4) dans `RT_WET_INPUT`. */
  private buildStamp(kind: 'stain' | 'wet'): Mesh {
    const a = this.carrierA.element(instanceIndex);
    const b = this.carrierB.element(instanceIndex);
    const d = decode(b.w);
    const shown = this.uniforms.part.sub(hash(instanceIndex.mul(41).add(23))).greaterThan(0);
    const on = (kind === 'stain' ? d.etat.equal(4) : d.etat.equal(2).or(d.etat.equal(4))).and(shown);
    const radius = kind === 'stain' ? b.y.mul(STAIN_RADIUS_K) : b.y.mul(1.2);
    const corner = positionGeometry.xy.mul(2); // −1 … 1
    const pos = a.xy.add(corner.mul(radius));
    const mat = new MeshBasicNodeMaterial();
    // Projection sur toute la feuille (cibles en espace feuille) ; hors pose : sommet rejeté hors du clip.
    const clip = vec4(pos.x.div(SHEET_W / 2).sub(1), float(1).sub(pos.y.div(SHEET_H / 2)), 0, 1);
    mat.vertexNode = select(on, clip, vec4(-9, -9, 0, 1));
    const vC = varying(corner, 'vStampC');
    const r = length(vC);
    if (kind === 'stain') {
      // Halo de la maquette : cœur un peu plus dense, bord doux et irrégulier.
      const n = vnoise(vC.mul(2.3).add(hash(instanceIndex).mul(40)));
      const k = float(1).sub(smoothstep(0.35, 1, r.add(n.sub(0.5).mul(0.3))));
      // Couleur de la tache = couleur du porteur posé (SPEC §5 : rose, vert pâle, rouge, gris faible), prémultipliée.
      const t = varying(d.type, 'vStampT');
      const vr = varying(d.variante, 'vStampV');
      const erable = select(vr.lessThan(0.5), rgb(COL_ERABLE), select(vr.lessThan(1.5), rgb(COL_ERABLE_VAR[0]), rgb(COL_ERABLE_VAR[1])));
      const tint = select(t.lessThan(1.5), rgb(COL_SAKURA), select(t.lessThan(2.5), rgb(COL_ETE), select(t.lessThan(3.5), erable, rgb(COL_HIVER).mul(0.75))));
      const al = k.mul(STAIN_ALPHA).mul(select(t.greaterThan(3.5), float(0.6), float(1)));
      mat.colorNode = vec4(tint.mul(al), al); // couleur prémultipliée
      mat.transparent = true;
      mat.blending = CustomBlending;
      mat.blendSrc = OneFactor;
      mat.blendDst = OneMinusSrcAlphaFactor;
      mat.blendEquation = AddEquation;
      mat.blendSrcAlpha = OneFactor;
      mat.blendDstAlpha = OneMinusSrcAlphaFactor;
      mat.blendEquationAlpha = AddEquation;
      mat.depthTest = false;
      mat.depthWrite = false;
    } else {
      const k = float(1).sub(smoothstep(0.3, 1, r));
      mat.colorNode = vec4(k.mul(INK_INJECT.pose.water), k.mul(INK_INJECT.pose.pigment), 0, 1);
      additive(mat);
    }
    // Le repère feuille (y vers le bas) retourne le quad : sans DoubleSide il serait éliminé (face arrière).
    mat.side = DoubleSide;
    const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
    mesh.frustumCulled = false;
    (mesh as unknown as { count: number }).count = 0;
    return mesh;
  }

  /** Nombre de particules actives (palier). Les inactives ne sont ni calculées ni dessinées (rien n'est perdu). */
  setActive(motes: number, carriers: number): void {
    this.active = { motes: Math.min(motes, this.max.motes), carriers: Math.min(carriers, this.max.carriers) };
    this.computeMotes.count = Math.max(1, this.active.motes);
    this.computeCarriers.count = Math.max(1, this.active.carriers);
    (this.motesMesh as unknown as { count: number }).count = this.active.motes;
    (this.carriersMesh as unknown as { count: number }).count = this.active.carriers;
    (this.stainStamp as unknown as { count: number }).count = this.active.carriers;
    (this.wetStamp as unknown as { count: number }).count = this.active.carriers;
  }

  /** Avance la simulation (une passe compute par tableau). */
  update(dt: number, timeS: number): void {
    const U = this.uniforms;
    U.dt.value = dt;
    U.time.value = timeS;
    U.frame.value = (U.frame.value + 1) % 100000;
    if (this.active.motes > 0) this.renderer.compute(this.computeMotes);
    if (this.active.carriers > 0) this.renderer.compute(this.computeCarriers);
  }

  /** Compteurs (poses, taches) depuis le début : WebGPU seulement. */
  async counters(): Promise<{ poses: number; stains: number } | null> {
    if (!this.counterBuf) return null;
    const buf = await this.renderer.getArrayBufferAsync(this.counterBuf.value);
    const u = new Uint32Array(buf);
    return { poses: u[0] ?? 0, stains: u[1] ?? 0 };
  }

  /** Positions des premiers éléments (mode test : vérifier que la brume bouge, aussi sous WebGL2). */
  async sample(which: 'motes' | 'carriers' | 'motesB' | 'carriersB', n: number): Promise<Float32Array> {
    const node = { motes: this.moteA, carriers: this.carrierA, motesB: this.moteB, carriersB: this.carrierB }[which];
    const buf = await this.renderer.getArrayBufferAsync(node.value);
    return new Float32Array(buf).slice(0, n * 4);
  }

  dispose(): void {
    for (const m of [this.motesMesh, this.carriersMesh, this.stainStamp, this.wetStamp]) {
      m.geometry.dispose();
      (m.material as MeshBasicNodeMaterial).dispose();
    }
    this.computeMotes.dispose?.();
    this.computeCarriers.dispose?.();
  }
}
