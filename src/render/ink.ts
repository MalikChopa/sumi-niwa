// Rendu des plantes (J2) : rubans de pinceau révélés par le temps et marques (feuilles, fleurs…), au-dessus du
// papier. Même code pour WebGPU (`complet`) et WebGL2 (`reduit`). Le GPU n'affiche que ce que le CPU a généré :
// la géométrie (hachée) ne dépend jamais de lui.
// Bord humide FIGÉ (ARCHITECTURE 13 : J2 jugé sans diffusion animée) : frange de lavis fixe autour des traits.
import {
  BufferGeometry,
  DoubleSide,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  BufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  NormalBlending,
} from 'three/webgpu';
import {
  abs as t_abs,
  attribute as t_attribute,
  clamp as t_clamp,
  cos as t_cos,
  dot as t_dot,
  exp as t_exp,
  float as t_float,
  floor as t_floor,
  fract as t_fract,
  fwidth as t_fwidth,
  hash as t_hash,
  length as t_length,
  max as t_max,
  min as t_min,
  mix as t_mix,
  mod as t_mod,
  select as t_select,
  sin as t_sin,
  smoothstep as t_smoothstep,
  pow as t_pow,
  uniform as t_uniform,
  varying as t_varying,
  vec2 as t_vec2,
  vec3 as t_vec3,
  vec4 as t_vec4,
  atan as t_atan,
} from 'three/tsl';

const T: N = { abs: t_abs, attribute: t_attribute, clamp: t_clamp, cos: t_cos, dot: t_dot, exp: t_exp, float: t_float, floor: t_floor, fract: t_fract, fwidth: t_fwidth, hash: t_hash, length: t_length, max: t_max, min: t_min, mix: t_mix, mod: t_mod, select: t_select, sin: t_sin, smoothstep: t_smoothstep, pow: t_pow, uniform: t_uniform, varying: t_varying, vec2: t_vec2, vec3: t_vec3, vec4: t_vec4, atan: t_atan };
import {
  COL_ERABLE,
  COL_ERABLE_VAR,
  COL_ETE,
  COL_HERBE_SOMBRE,
  COL_HIVER,
  COL_SAKURA,
  COL_SUMI,
  COL_WASHI,
  MARK_FLOATS,
  SHEET_H,
  SHEET_W,
  STROKE_VERTEX_FLOATS,
  TIP_LEN_S,
} from '../constants';
import { M, V } from '../core/layout';
import { swayNode } from '../sim/wind';
import { additive } from './ink-grid';
import { INK_INJECT } from '../constants';
import type { PlantGeometry } from '../core/plant-gen';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

// Les types TSL de @types/three 0.187 rejettent des combinaisons valides (vec3 × float…) : accès non typé.
const abs: N = T.abs;
const attribute: N = T.attribute;
const clamp: N = T.clamp;
const cos: N = T.cos;
const dot: N = T.dot;
const exp: N = T.exp;
const float: N = T.float;
const floor: N = T.floor;
const fract: N = T.fract;
const fwidth: N = T.fwidth;
const hash: N = T.hash;
const length: N = T.length;
const max: N = T.max;
const min: N = T.min;
const mix: N = T.mix;
const mod: N = T.mod;
const select: N = T.select;
const sin: N = T.sin;
const smoothstep: N = T.smoothstep;
const pow: N = T.pow;
const uniform: N = T.uniform;
const varying: N = T.varying;
const vec2: N = T.vec2;
const vec3: N = T.vec3;
const vec4: N = T.vec4;
const atan: N = T.atan;

function rgb(hex: string): N {
  const n = parseInt(hex.slice(1), 16);
  return vec3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Uniformes partagés par tous les matériaux d'encre. */
export const inkUniforms = {
  /** Temps simulé (s). */
  time: uniform(0),
  /** uf → espace de découpe : (2 × échelle / largeur, 2 × échelle / hauteur), ajustement « cover ». */
  view: uniform(vec2(1 / 800, 1 / 450)),
  /** Poids des saisons (printemps, été, automne, hiver), mis à jour par le jardin (J4 : transition, SPEC §5). */
  season: uniform(vec4(1, 0, 0, 0)),
  /** Fondu de la nouvelle feuille (J4) : 1 = encre pleine, 0 = effacée. Multiplie l'opacité des traits, marques et de l'encre. */
  fade: uniform(1),
  /** Couleur de l'herbe sombre (rôle 6) : mélange linéaire été → automne calculé côté CPU à chaque changement de poids (`setSeasonWeights`). */
  herb: uniform(vec3(0.302, 0.353, 0.271)),
  /** Graine d'encre : position (uf), opacité. */
  seedPos: uniform(vec2(-1000, -1000)),
  seedAlpha: uniform(0),
  /** Frange humide figée (J2) : 1 en `reduit` (pas de diffusion), 0 en `complet` (la grille d'encre la remplace). */
  fringe: uniform(1),
  /** Fenêtre d'injection dans la grille (temps simulé) : ]injA, injB]. */
  injA: uniform(0),
  injB: uniform(0),
};

/** Balancement maximal de l'espèce de l'objet dessiné (`mesh.userData.swayMax`, SWAY_MAX en uf). */
const uSwayMax: N = uniform(0).onObjectUpdate(({ object }: { object: { userData: { swayMax?: number } } }) => object.userData.swayMax ?? 0);

/** Projection feuille → cible de la grille (toute la feuille, sans ajustement « cover »). */
function toSheetClip(p: N): N {
  return vec4(p.x.div(SHEET_W / 2).sub(1), float(1).sub(p.y.div(SHEET_H / 2)), 0, 1);
}

/** Met à jour la projection « cover » de la feuille (1600 x 900 uf) pour une fenêtre w x h. */
export function setInkView(w: number, h: number): void {
  const scale = Math.max(w / SHEET_W, h / SHEET_H);
  (inkUniforms.view.value as { set(x: number, y: number): void }).set((2 * scale) / w, (2 * scale) / h);
}

function toClip(p: N): N {
  const v = inkUniforms.view;
  return vec4(p.x.sub(SHEET_W / 2).mul(v.x), float(SHEET_H / 2).sub(p.y).mul(v.y), 0, 1);
}

/** Bruit de valeur lissé 0–1 (clé entière exacte en float32 tant que |p| < ~7 000). */
function vnoise(p: N): N {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const k = (dx: number, dy: number) => hash(i.x.add(dx).add(512).add(i.y.add(dy).add(512).mul(2048)));
  return mix(mix(k(0, 0), k(1, 0), u.x), mix(k(0, 1), k(1, 1), u.x), u.y);
}

/** Mélange sRVB → linéaire → sRVB de deux couleurs hexadécimales (SPEC §5 : « couleurs interpolées en espace linéaire »), côté CPU. */
function mixLinearRgb(a: string, b: string, k: number): [number, number, number] {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return [0, 1, 2].map((i) => Math.pow(Math.pow(ch(a, i), 2.2) * (1 - k) + Math.pow(ch(b, i), 2.2) * k, 1 / 2.2)) as [number, number, number];
}

/** Met à jour les couleurs qui suivent les poids de saison (herbe sombre : été → automne, la moitié en hiver). */
export function setSeasonWeights(w: readonly [number, number, number, number]): void {
  const k = Math.min(1, Math.max(0, w[2] + 0.5 * w[3]));
  const c = mixLinearRgb(COL_HERBE_SOMBRE.ete, COL_HERBE_SOMBRE.automne, k);
  (inkUniforms.herb.value as { set(a: number, b: number, c: number): void }).set(c[0], c[1], c[2]);
}

/**
 * Couleur d'un rôle (SPEC §2.2 ; 7 = réserve papier). Les couleurs d'accent sont portées par les marques
 * (chaque marque n'existe que dans ses saisons, J2) ; l'herbe sombre passe du vert-gris d'été au brun d'automne
 * avec le poids de l'automne.
 */
function roleColor(role: N, variant: N): N {
  const herbe = inkUniforms.herb;
  const erable = select(variant.lessThan(0.5), rgb(COL_ERABLE), select(variant.lessThan(1.5), rgb(COL_ERABLE_VAR[0]), rgb(COL_ERABLE_VAR[1])));
  return select(
    role.lessThan(0.5),
    rgb(COL_SUMI),
    select(
      role.lessThan(2.5),
      rgb(COL_SAKURA),
      select(
        role.lessThan(3.5),
        rgb(COL_ETE),
        select(role.lessThan(4.5), erable, select(role.lessThan(5.5), rgb(COL_HIVER), select(role.lessThan(6.5), herbe, rgb(COL_WASHI)))),
      ),
    ),
  );
}

// -----------------------------------------------------------------------------------------------
// Traits (rubans)

function buildStrokeMaterial(): MeshBasicNodeMaterial {
  const a0 = attribute('a0', 'vec4'); // centre.xy, offset.xy
  const a1 = attribute('a1', 'vec4'); // base.xy, u, naissance (absolue, ajoutée par le rendu)
  const a2 = attribute('a2', 'vec4'); // balancement, pression, bruit (graine × 4 + côté + 1), dilution + 8 × rôle
  const t = inkUniforms.time;

  const centre = a0.xy;
  const off = a0.zw;
  const birth = a1.w;
  const code = a2.z;
  const dilCode = a2.w;
  const side = mod(code, 4).sub(1); // −1 ou +1
  const seed = floor(code.div(4));
  const dil = mod(dilCode, 8);
  const role = floor(dilCode.div(8));
  const isWash = dil.greaterThan(0.5).and(dil.lessThan(1.5));

  // Pointe en croissance effilée sur TIP_LEN_S ; avant la naissance, largeur nulle.
  const k = clamp(t.sub(birth).div(TIP_LEN_S), 0, 1);
  const hw0 = length(off);
  const hw = hw0.mul(k.mul(k.mul(-0.6).add(1.6)).min(1));
  // Marge pour le bord irrégulier (+12 %) et la frange humide figée.
  const margin = select(isWash, float(5), hw0.mul(0.25).add(2.2));
  const dir = off.div(max(hw0, 1e-4));
  // Balancement au vent (F-5) : champ lu au pied de la plante, × champ `balancement` du sommet × SWAY_MAX.
  const pos = centre.add(dir.mul(hw.add(margin))).add(swayNode(a1.xy, a2.x, uSwayMax));

  const vDist = varying(side.mul(hw.add(margin)), 'vDist');
  const vHw = varying(hw, 'vHw');
  const vPos = varying(pos, 'vPos');
  const vU = varying(a1.z, 'vU');
  const vBirth = varying(birth, 'vBirth');
  const vPress = varying(a2.y, 'vPress');
  const vSeed = varying(seed, 'vSeed');
  const vDil = varying(dil, 'vDil');
  const vRole = varying(role, 'vRole');

  const mat = new MeshBasicNodeMaterial();
  mat.vertexNode = toClip(pos);

  // --- Fragment
  const d = abs(vDist);
  const aa = max(fwidth(vDist), 0.02);
  const sOff = fract(vSeed.mul(0.6180339)).mul(97);
  // Bord irrégulier ± 12 % de la demi-largeur (SPEC §4.1), deux échelles de bruit en espace feuille.
  const n1 = vnoise(vPos.mul(0.16).add(sOff));
  const n2 = vnoise(vPos.mul(0.55).add(sOff.mul(1.7)));
  const wobble = n1.mul(0.7).add(n2.mul(0.3)).mul(2).sub(1);
  const edge = vHw.mul(wobble.mul(0.12).add(1));
  const wash = vDil.greaterThan(0.5).and(vDil.lessThan(1.5));
  const soft = select(wash, aa.add(1.6), aa.mul(0.8));
  const core = float(1).sub(smoothstep(edge.sub(soft), edge.add(soft), d));

  // Poils du pinceau : bandes le long du trait (rapides en travers, lentes le long), plus marquées sur les
  // traits larges ; pinceau sec vers la fin du trait et sur les bords.
  const across = vDist.div(max(vHw, 0.3)); // −1 … 1 dans le trait
  const bristle = vnoise(vec2(across.mul(5.5).add(sOff), vU.mul(2.2).add(sOff.mul(0.37))));
  const wide = smoothstep(2.5, 9, vHw);
  // Charge d'encre qui varie lentement le long du trait (± 14 %), quelle que soit sa largeur.
  const load = vnoise(vec2(vU.mul(3.1).add(sOff), sOff.mul(0.5))).sub(0.5).mul(0.28);
  const density = float(1).add(bristle.sub(0.5).mul(0.5).mul(wide)).add(load);
  const dryness = smoothstep(0.55, 1, vU).mul(0.45).add(smoothstep(0.55, 1, abs(across)).mul(0.3)).mul(wide);
  const dryGap = smoothstep(float(1).sub(dryness), float(1.08).sub(dryness), bristle);
  // Pinceau sec de SPEC §4.1 : papier « haut » (bruit fin) au-dessus de 1 − 0,35 × (1 − pression) → pas d'encre.
  // Réglage du J2 : bruit plus gros (≈ 3 uf, deux octaves) et trou partiel, sinon des points blancs isolés.
  const paperH = vnoise(vPos.mul(0.32)).mul(0.65).add(vnoise(vPos.mul(0.8).add(31)).mul(0.35));
  const thr = float(1).sub(float(0.35).mul(float(1).sub(vPress)));
  const speck = float(1).sub(smoothstep(thr.sub(0.12), thr.add(0.05), paperH).mul(0.5));
  // Bord plus foncé où le pigment s'accumule en séchant (figé).
  const rim = smoothstep(edge.mul(0.55), edge, d).mul(0.18);

  const washMottle = float(0.75).add(n1.mul(0.5));
  const inkA = select(
    wash,
    vPress.mul(washMottle),
    vPress.mul(density).mul(float(1).sub(dryGap.mul(0.8))).mul(speck).mul(rim.add(1)),
  );
  // Frange humide figée : lavis pâle et irrégulier au-delà du bord (capillarité du papier).
  const fringeW = select(wash, float(4), vHw.mul(0.12).add(1.3));
  const fringe = float(1)
    .sub(smoothstep(edge, edge.add(fringeW.mul(n2.mul(0.8).add(0.6))), d))
    .mul(select(wash, float(0.35), float(0.16)))
    .mul(vPress)
    .mul(inkUniforms.fringe);
  const isReserve = vRole.greaterThan(6.5);
  const outA = select(isReserve, core.mul(vPress).mul(density), core.mul(inkA).add(float(1).sub(core).mul(fringe)));
  // Croissance : le trait n'existe qu'où sa naissance est passée (front adouci d'un pixel).
  const front = clamp(t.sub(vBirth).div(max(fwidth(vBirth), 1e-4)).add(0.5), 0, 1);
  const alpha = clamp(outA.mul(front), 0, 0.96).mul(inkUniforms.fade);

  mat.colorNode = vec4(roleColor(vRole, float(0)), alpha);
  mat.transparent = true;
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.side = DoubleSide;
  mat.blending = NormalBlending;
  return mat;
}

// -----------------------------------------------------------------------------------------------
// Marques (quads, une par marque, coins calculés dans le nuanceur de sommets)

const MARK_VERTEX_FLOATS = MARK_FLOATS + 2; // + coin (cx, cy)
const LEAF_GROW_S = 0.45; // éclosion d'une feuille ou d'un pétale (VD, SPEC §4.2 : 0,4–0,5 s)
const FLOWER_GROW_S = 0.35;

function buildMarkMaterial(): MeshBasicNodeMaterial {
  const m0 = attribute('m0', 'vec4'); // pos.xy, base.xy
  const m1 = attribute('m1', 'vec4'); // angle, taille, forme, rôle
  const m2 = attribute('m2', 'vec4'); // naissance, balancement, opacité, variante
  const m3 = attribute('m3', 'vec4'); // échelle par saison
  const corner = attribute('corner', 'vec2');
  const t = inkUniforms.time;

  const ang = m1.x;
  const size = m1.y;
  const forme = m1.z;
  const role = m1.w;
  const birth = m2.x;
  const variant = m2.w;
  const isLens = forme.lessThan(0.5).or(forme.greaterThan(3.5).and(forme.lessThan(4.5)));
  const isFlower = forme.greaterThan(0.5).and(forme.lessThan(1.5));
  const age = t.sub(birth);
  const grow = clamp(age.div(select(isFlower, float(FLOWER_GROW_S), float(LEAF_GROW_S))), 0, 1);
  const g = grow.mul(grow.mul(-1).add(2)); // sortie douce
  const sc = dot(m3, inkUniforms.season).mul(g);
  const L = size.mul(sc);
  const W = size.mul(variant).mul(sc);
  const R = size.mul(sc);
  const margin = float(2.5).mul(step01(sc));
  // Repère local : x le long de la marque.
  const lx = select(isLens, mix(margin.negate(), L.add(margin), corner.x.mul(0.5).add(0.5)), corner.x.mul(R.mul(1.15).add(margin)));
  const ly = select(isLens, corner.y.mul(W.add(margin)), corner.y.mul(R.mul(1.15).add(margin)));
  const c = cos(ang);
  const s = sin(ang);
  const pos = m0.xy.add(vec2(lx.mul(c).sub(ly.mul(s)), lx.mul(s).add(ly.mul(c)))).add(swayNode(m0.zw, m2.y, uSwayMax));

  const vL = varying(vec2(lx, ly), 'vLocal');
  const vSize = varying(vec4(L, W, R, forme), 'vSize');
  const vRole = varying(role, 'vMRole');
  const vVar = varying(variant, 'vMVar');
  const vOp = varying(m2.z, 'vMOp');
  const vPos = varying(pos, 'vMPos');

  const mat = new MeshBasicNodeMaterial();
  mat.vertexNode = toClip(pos);

  // --- Fragment : couverture par forme (distance signée approchée, anticrénelage par fwidth).
  const px = vL.x;
  const py = vL.y;
  const fL = vSize.x;
  const fW = vSize.y;
  const fR = vSize.z;
  const f = vSize.w;
  const nz = vnoise(vPos.mul(0.35));
  const cover = (dist: N): N => {
    const w = max(fwidth(dist), 0.02);
    return float(1).sub(smoothstep(w.negate(), w, dist));
  };
  // Lentille (feuille, pétale) : demi-largeur W k s^a (1 − s)^b, maximum W.
  // Feuille : a 0,5, b 1,3 (pleine au premier tiers, pointe fine) ; pétale : a 0,8, b 0,35 (large vers le bord).
  const isPetal = f.greaterThan(3.5);
  const sL = px.div(max(fL, 1e-3));
  const sc01 = clamp(sL, 0, 1);
  const ea = select(isPetal, float(0.8), float(0.5));
  const eb = select(isPetal, float(0.35), float(1.3));
  const ek = select(isPetal, float(2.04), float(2.9));
  // Feuille légèrement arquée (sens et courbure tirés de la variante).
  const bend = fract(vVar.mul(97.13)).sub(0.5).mul(0.35).mul(fL).mul(sc01).mul(sc01).mul(select(isPetal, float(0.3), float(1)));
  const half = fW.mul(ek).mul(pow(sc01, ea)).mul(pow(float(1).sub(sc01), eb));
  const nzLow = vnoise(vPos.mul(0.07).add(vVar.mul(17)));
  const dLens = abs(py.sub(bend)).sub(half.mul(nzLow.sub(0.5).mul(0.16).add(1)));
  const lensCov = cover(dLens).mul(select(sL.lessThan(0).or(sL.greaterThan(1)), float(0), float(1)));
  // Pinceau sec vers la pointe de la feuille.
  const streak = vnoise(vec2(px.mul(0.09), py.div(max(fW, 0.5)).mul(3.2).add(vVar.mul(13))));
  const lensDry = float(1).sub(smoothstep(0.6, 1, sL).mul(smoothstep(0.45, 0.8, streak)).mul(0.6));
  const lensDens = float(0.88).add(streak.mul(0.24));
  // Contour sumi des pétales de pivoine (maquette : trait 1,1, opacité 0,4).
  const petalLine = float(1).sub(smoothstep(0.3, 1.0, abs(dLens))).mul(0.24).mul(select(sL.greaterThan(0.04), float(1), float(0)));

  // Fleur à 5 pétales (maquette `blossom`) : disques à 0,55 R, rayon 0,52 R ; cœur sumi 0,18 R.
  let dF: N = float(1e4);
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5;
    const cxk = fR.mul(0.55 * Math.cos(a));
    const cyk = fR.mul(0.55 * Math.sin(a));
    dF = min(dF, length(vec2(px.sub(cxk), py.sub(cyk))).sub(fR.mul(0.52)));
  }
  dF = dF.add(nz.sub(0.5).mul(fR.mul(0.08)));
  const flowerCov = cover(dF);
  const flowerLine = float(1).sub(smoothstep(0.25, 0.9, abs(dF))).mul(0.14);
  const heartCov = cover(length(vL).sub(fR.mul(0.18)));

  // Érable : étoile à 5 pointes (rayon creusé à 0,42 entre les pointes).
  const theta = atan(py, px);
  const lobes = abs(cos(theta.mul(2.5)));
  const rStar = fR.mul(float(0.42).add(lobes.mul(lobes).mul(0.58)));
  const mapleCov = cover(length(vL).sub(rStar).add(nz.sub(0.5).mul(fR.mul(0.1))));

  // Bouton (ellipse), neige (demi-ellipse haute), point, cœur.
  const budCov = cover(length(vec2(px.div(max(fR, 1e-3)), py.div(max(fR.mul(0.55), 1e-3)))).sub(1).mul(fR.mul(0.55)));
  const snowCov = cover(length(vec2(px.div(max(fR, 1e-3)), py.div(max(fR.mul(0.45), 1e-3)))).sub(1).mul(fR.mul(0.45)).max(py.mul(0.5)));
  const dotCov = cover(length(vL).sub(fR).add(nz.sub(0.5).mul(fR.mul(0.25))));
  const dotSoft = exp(length(vL).div(max(fR, 0.5)).sub(1).max(0).mul(-2.2)).mul(0.25);

  const base = roleColor(vRole, vVar);
  const sumi = rgb(COL_SUMI);
  // Sélection par forme : 0 feuille, 1 fleur, 2 bouton, 3 érable, 4 pétale, 5 neige, 6 point, 7 cœur.
  const fillA = select(
    f.lessThan(0.5),
    lensCov.mul(lensDens).mul(lensDry),
    select(
      f.lessThan(1.5),
      // Fleur : pétales plus pâles vers le bord (encre d'accent qui s'éclaircit en séchant).
      flowerCov.mul(float(1.12).sub(length(vL).div(max(fR, 0.5)).mul(0.32))),
      select(
        f.lessThan(2.5),
        budCov,
        select(f.lessThan(3.5), mapleCov, select(f.lessThan(4.5), lensCov.mul(float(1.15).sub(sc01.mul(0.35))), select(f.lessThan(5.5), snowCov, select(f.lessThan(6.5), max(dotCov, dotSoft), heartCov)))),
      ),
    ),
  ).mul(vOp);
  // Trait sumi par-dessus (pétales, fleurs) ; cœur de fleur sumi.
  const lineA = select(f.greaterThan(3.5).and(f.lessThan(4.5)), petalLine.mul(lensCov.add(0.6).min(1)), select(f.greaterThan(0.5).and(f.lessThan(1.5)), flowerLine, float(0)));
  const heartA = select(f.greaterThan(0.5).and(f.lessThan(1.5)), heartCov.mul(0.7), float(0));
  const topA = max(lineA, heartA);
  const outA = topA.add(fillA.mul(float(1).sub(topA)));
  const col = sumi.mul(topA).add(base.mul(fillA).mul(float(1).sub(topA))).div(max(outA, 1e-4));

  mat.colorNode = vec4(col, clamp(outA, 0, 0.96).mul(inkUniforms.fade));
  mat.transparent = true;
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.side = DoubleSide;
  mat.blending = NormalBlending;
  return mat;
}

/** 1 si x > 0, sinon 0 (pour couper la marge des marques invisibles). */
function step01(x: N): N {
  return select(x.greaterThan(0), float(1), float(0));
}

// -----------------------------------------------------------------------------------------------
// Graine d'encre (SPEC §7.1 : point de 8 uf à l'image suivant l'appui), avec un halo humide.

function buildSeedMaterial(): MeshBasicNodeMaterial {
  const corner = attribute('corner', 'vec2');
  const R = 8;
  const ext = 26;
  const pos = inkUniforms.seedPos.add(corner.mul(ext));
  const vL = varying(corner.mul(ext), 'vSeedL');
  const mat = new MeshBasicNodeMaterial();
  mat.vertexNode = toClip(pos);
  const r = length(vec2(vL.x, vL.y.mul(8 / 9.5)));
  const w = max(fwidth(r), 0.02);
  const dot = float(1).sub(smoothstep(w.mul(-1).add(R), w.add(R), r)).mul(0.9);
  const halo = exp(r.div(20).mul(r.div(20)).mul(-2)).mul(0.12);
  const a = max(dot, halo).mul(inkUniforms.seedAlpha);
  mat.colorNode = vec4(rgb(COL_SUMI), a);
  mat.transparent = true;
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.side = DoubleSide;
  return mat;
}

// -----------------------------------------------------------------------------------------------

// Injection dans la grille d'encre (F-4, `complet`) : mêmes tampons que l'affichage, projetés sur toute la
// feuille ; un fragment n'est injecté qu'une fois, quand sa naissance tombe dans la fenêtre ]injA, injB].

function buildStrokeInjectMaterial(): MeshBasicNodeMaterial {
  const a0 = attribute('a0', 'vec4');
  const a1 = attribute('a1', 'vec4');
  const a2 = attribute('a2', 'vec4');
  const off = a0.zw;
  const hw0 = length(off);
  const dilCode = a2.w;
  const dil = mod(dilCode, 8);
  const role = floor(dilCode.div(8));
  const side = mod(a2.z, 4).sub(1);
  const ext = hw0.mul(1.12).add(0.9);
  const pos = a0.xy.add(off.div(max(hw0, 1e-4)).mul(ext));
  const vD = varying(side.mul(ext).div(max(hw0, 0.3)), 'vInjD');
  const vBirth = varying(a1.w, 'vInjBirth');
  const vPress = varying(a2.y, 'vInjPress');
  const vDil = varying(dil, 'vInjDil');
  const vRole = varying(role, 'vInjRole');
  const mat = new MeshBasicNodeMaterial();
  mat.vertexNode = toSheetClip(pos);
  const d = abs(vD);
  const inside = float(1).sub(smoothstep(0.92, 1.12, d));
  const inWin = vBirth.greaterThan(inkUniforms.injA).and(vBirth.lessThanEqual(inkUniforms.injB));
  const wash = vDil.greaterThan(0.5).and(vDil.lessThan(1.5));
  // Net : de l'eau sur toute la largeur, le pigment surtout sur le bord (le cœur du trait garde son pinceau sec).
  const band = smoothstep(0.45, 0.95, d);
  const water = select(wash, float(INK_INJECT.lavis.water), float(INK_INJECT.net.water).mul(vPress.mul(0.5).add(0.5))).mul(inside);
  const pigment = select(wash, float(INK_INJECT.lavis.pigment).mul(vPress), band.mul(vPress).mul(0.55)).mul(inside);
  const on = select(inWin.and(vRole.lessThan(6.5)), float(1), float(0));
  mat.colorNode = vec4(water.mul(on), pigment.mul(on), 0, 1);
  mat.side = DoubleSide;
  return additive(mat);
}

function buildMarkInjectMaterial(): MeshBasicNodeMaterial {
  const m0 = attribute('m0', 'vec4');
  const m1 = attribute('m1', 'vec4');
  const m2 = attribute('m2', 'vec4');
  const m3 = attribute('m3', 'vec4');
  const corner = attribute('corner', 'vec2');
  const ang = m1.x;
  const sc = dot(m3, inkUniforms.season);
  const L = m1.y.mul(sc);
  const W = m1.y.mul(m2.w).mul(sc);
  // Feuilles sumi ou herbe sombre seulement (le pigment de la grille est noir : pas de halo gris sous les fleurs).
  const ok = m1.z.lessThan(0.5).and(m1.w.lessThan(0.5).or(m1.w.greaterThan(5.5).and(m1.w.lessThan(6.5))));
  // Même repère que la marque affichée (x le long de la feuille, de 0 à L) ; marge pour la courbure.
  const lx = mix(float(-1), L.add(1), corner.x.mul(0.5).add(0.5));
  const ly = corner.y.mul(W.add(L.mul(0.2)).add(1));
  const c = cos(ang);
  const s = sin(ang);
  const pos = m0.xy.add(vec2(lx.mul(c).sub(ly.mul(s)), lx.mul(s).add(ly.mul(c))));
  const vL = varying(vec2(lx, ly), 'vInjML');
  const vS = varying(vec3(L, W, m2.w), 'vInjMS');
  const vT = varying(m2.x.add(0.25), 'vInjMT');
  const vOk = varying(select(ok, m2.z, float(0)), 'vInjMOk');
  const mat = new MeshBasicNodeMaterial();
  mat.vertexNode = toSheetClip(pos);
  // Lentille de la feuille (mêmes exposants et même courbure que buildMarkMaterial).
  const sL = clamp(vL.x.div(max(vS.x, 1e-3)), 0, 1);
  const bend = fract(vS.z.mul(97.13)).sub(0.5).mul(0.35).mul(vS.x).mul(sL).mul(sL);
  const half = vS.y.mul(2.9).mul(pow(sL, 0.5)).mul(pow(float(1).sub(sL), 1.3));
  const rel = abs(vL.y.sub(bend)).div(max(half, 0.2));
  const inside = float(1).sub(smoothstep(0.85, 1.05, rel)).mul(select(vL.x.lessThan(0).or(vL.x.greaterThan(vS.x)), float(0), float(1)));
  const band = smoothstep(0.55, 0.95, rel);
  const inWin = vT.greaterThan(inkUniforms.injA).and(vT.lessThanEqual(inkUniforms.injB));
  const on = select(inWin, vOk, float(0));
  mat.colorNode = vec4(inside.mul(0.45).mul(on), band.mul(inside).mul(0.22).mul(on), 0, 1);
  mat.side = DoubleSide;
  return additive(mat);
}

export interface InkMaterials {
  stroke: MeshBasicNodeMaterial;
  mark: MeshBasicNodeMaterial;
  seed: MeshBasicNodeMaterial;
  /** Matériaux d'injection (niveau `complet` seulement). */
  strokeInject: MeshBasicNodeMaterial | null;
  markInject: MeshBasicNodeMaterial | null;
}

export function createInkMaterials(withGrid = false): InkMaterials {
  return {
    stroke: buildStrokeMaterial(),
    mark: buildMarkMaterial(),
    seed: buildSeedMaterial(),
    strokeInject: withGrid ? buildStrokeInjectMaterial() : null,
    markInject: withGrid ? buildMarkInjectMaterial() : null,
  };
}

/**
 * Maillage des traits d'une plante ; `t0` = temps simulé de la plantation (ajouté aux naissances). `speed` > 1 :
 * croissance accélérée (ouverture d'un lien, REPLAY_SPEED) ; le tampon généré (haché) n'est jamais modifié.
 */
export function strokeMesh(g: PlantGeometry, t0: number, mat: MeshBasicNodeMaterial, speed = 1): Mesh | null {
  if (g.vertCount === 0) return null;
  const data = g.verts.slice(0, g.vertCount * STROKE_VERTEX_FLOATS);
  for (let i = 0; i < g.vertCount; i++) data[i * STROKE_VERTEX_FLOATS + V.BIRTH] = (data[i * STROKE_VERTEX_FLOATS + V.BIRTH] as number) / speed + t0;
  const ib = new InterleavedBuffer(data, STROKE_VERTEX_FLOATS);
  const geo = new BufferGeometry();
  geo.setAttribute('a0', new InterleavedBufferAttribute(ib, 4, 0));
  geo.setAttribute('a1', new InterleavedBufferAttribute(ib, 4, 4));
  geo.setAttribute('a2', new InterleavedBufferAttribute(ib, 4, 8));
  geo.setIndex(new BufferAttribute(g.indices.slice(0, g.indexCount), 1));
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

/** Maillage des marques d'une plante : 4 sommets par marque (coins), 6 indices. */
export function markMesh(g: PlantGeometry, t0: number, mat: MeshBasicNodeMaterial, speed = 1): Mesh | null {
  if (g.markCount === 0) return null;
  const n = g.markCount;
  const data = new Float32Array(n * 4 * MARK_VERTEX_FLOATS);
  const idx = new Uint16Array(n * 6);
  const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
  for (let k = 0; k < n; k++) {
    const src = k * MARK_FLOATS;
    for (let c = 0; c < 4; c++) {
      const o = (k * 4 + c) * MARK_VERTEX_FLOATS;
      for (let j = 0; j < MARK_FLOATS; j++) data[o + j] = g.marks[src + j] as number;
      data[o + M.BIRTH] = (data[o + M.BIRTH] as number) / speed + t0;
      data[o + MARK_FLOATS] = corners[2 * c] as number;
      data[o + MARK_FLOATS + 1] = corners[2 * c + 1] as number;
    }
    const v = k * 4;
    idx.set([v, v + 1, v + 2, v, v + 2, v + 3], k * 6);
  }
  // Réordonne en (m0, m1, m2, m3) = pos/base, angle/taille/forme/rôle, naissance/balancement/opacité/variante, saisons.
  const re = new Float32Array(data.length);
  for (let i = 0; i < n * 4; i++) {
    const o = i * MARK_VERTEX_FLOATS;
    const s = data.subarray(o, o + MARK_VERTEX_FLOATS);
    re.set(
      [
        s[M.PX]!, s[M.PY]!, s[M.BX]!, s[M.BY]!,
        s[M.ANGLE]!, s[M.SIZE]!, s[M.FORME]!, s[M.ROLE]!,
        s[M.BIRTH]!, s[M.SWAY]!, s[M.OPACITY]!, s[M.VARIANT]!,
        s[M.S0]!, s[M.S1]!, s[M.S2]!, s[M.S3]!,
        s[MARK_FLOATS]!, s[MARK_FLOATS + 1]!,
      ],
      o,
    );
  }
  const ib = new InterleavedBuffer(re, MARK_VERTEX_FLOATS);
  const geo = new BufferGeometry();
  geo.setAttribute('m0', new InterleavedBufferAttribute(ib, 4, 0));
  geo.setAttribute('m1', new InterleavedBufferAttribute(ib, 4, 4));
  geo.setAttribute('m2', new InterleavedBufferAttribute(ib, 4, 8));
  geo.setAttribute('m3', new InterleavedBufferAttribute(ib, 4, 12));
  geo.setAttribute('corner', new InterleavedBufferAttribute(ib, 2, 16));
  geo.setIndex(new BufferAttribute(idx, 1));
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export function seedMesh(mat: MeshBasicNodeMaterial): Mesh {
  const geo = new BufferGeometry();
  geo.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  geo.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
