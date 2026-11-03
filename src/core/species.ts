// Les cinq espèces (SPEC §4.2). Valeurs de forme : VD tirées de la maquette A (fonctions bamboo, branch,
// grass, peony, rock de maquette/index.html), réimplémentées en générateurs déterministes.
// Coordonnées : uf, y vers le bas ; angles en radians (0 = vers la droite, −π/2 = vers le haut).
import type { SpeciesCode } from '../constants';
import { HALF_PI, PI, TAU, atan2, clamp, cos, sin } from './dmath';
import { ALL_SEASONS, AUTUMN, DILUTION, FORME, ROLE, SPRING, SUMMER, type Seasons, WINTER } from './layout';
import type { PlantDraft } from './plant-gen';

/** Courbe de Bézier quadratique échantillonnée en n + 1 points (tableau plat x, y). */
function bez(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, n: number): number[] {
  const o: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    o.push(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
  }
  return o;
}

function line(x0: number, y0: number, x1: number, y1: number, n: number): number[] {
  const o: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    o.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
  }
  return o;
}

const SPRING_SUMMER: Seasons = [1, 1, 0, 0];
const NOT_SUMMER: Seasons = [1, 0, 1, 1];

/**
 * Feuille en accent (1 sur 3). La maquette A validée montre l'accent vert au printemps (écran 2) et érable
 * en automne (écran 3) : une marque par couleur, chacune visible dans ses saisons ; gris bleuté en hiver.
 */
function accentLeaf(d: PlantDraft, x: number, y: number, a: number, len: number, wid: number, t: number): void {
  const base = { x, y, angle: a, size: len, forme: FORME.FEUILLE, t, opacity: 0.38, variant: wid / len };
  d.mark({ ...base, role: ROLE.ETE, seasons: SPRING_SUMMER });
  d.mark({ ...base, role: ROLE.ERABLE, seasons: AUTUMN });
  d.mark({ ...base, role: ROLE.HIVER, seasons: WINTER });
}

function sumiLeaf(d: PlantDraft, x: number, y: number, a: number, len: number, wid: number, t: number, op: number): void {
  d.mark({ x, y, angle: a, size: len, forme: FORME.FEUILLE, role: ROLE.SUMI, t, seasons: ALL_SEASONS, opacity: op, variant: wid / len });
}

/** Lavis de sol (SPEC §4.1) : si y ≥ 700, un trait horizontal en lavis sous le pied. */
function groundWash(d: PlantDraft): void {
  if (d.y < 700) return;
  const r = d.rng;
  const len = r.range(120, 260);
  const w = r.range(3, 10);
  const x0 = d.x - len * r.range(0.35, 0.65);
  const pts: number[] = [];
  const n = 12;
  const wob = r.range(1.5, 4);
  const ph = r.range(0, TAU);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(x0 + len * t, d.y + 4 + wob * sin(ph + t * 5.3));
  }
  d.stroke(pts, { t0: 0, duration: 0.6, w0: w, taper: 0.3, pression: 0.1, dilution: DILUTION.LAVIS, pointedEnds: true });
}

// ------------------------------------------------------------------------------------------------
// 0 Bambou
function bamboo(d: PlantDraft): void {
  const r = d.rng;
  groundWash(d);
  const H = r.range(300, 520);
  stem(d, d.x, H, 0);
  if (r.chance(0.35)) {
    const dx = (r.chance(0.5) ? -1 : 1) * r.range(30, 60);
    stem(d, d.x + dx, H * r.range(0.6, 0.8), 0.3);
  }
}

function stem(d: PlantDraft, x0: number, H: number, tStart: number): void {
  const r = d.rng;
  const y0 = d.y;
  const n = Math.max(4, Math.round(H / 92));
  const segH = H / n;
  const lean = r.signed() * 23; // inclinaison −23 à +23 uf
  const SEG_S = 0.55;
  let cx = x0;
  let cy = y0;
  let t = tStart;
  for (let i = 0; i < n; i++) {
    const f = (i + 1) / n;
    const nx = x0 + lean * f * Math.sqrt(f) + r.signed() * 2.5; // ((i+1)/n)^1,5
    const ny = y0 - segH * (i + 1);
    const w0 = 24 * (1 - (i / n) * 0.45);
    const w1 = 24 * (1 - ((i + 1) / n) * 0.45);
    // Segment : du nœud précédent (petit jour de papier) au nœud suivant.
    const sy0 = i === 0 ? cy + 4 : cy - 1.5;
    const seg = line(cx, sy0, nx, ny + 1.5, 8);
    d.stroke(seg, { t0: t, duration: SEG_S, w0, taper: 1 - w1 / w0, pression: r.range(0.8, 0.9), splatter: true });
    // Réserve claire du pinceau sec, décalée à gauche (maquette : ruban washi 3 uf, opacité 0,28).
    const hl: number[] = [];
    for (let k = 2; k <= 6; k++) hl.push(seg[2 * k]! - w0 * 0.22, seg[2 * k + 1]!);
    d.stroke(hl, { t0: t + SEG_S * 0.25, duration: SEG_S * 0.5, w0: 3, taper: 0.3, pression: 0.28, role: ROLE.WASHI });
    t += SEG_S;
    // Nœud : petite courbe (largeur 3,2), tracée en 0,12 s.
    const node = bez(nx - w1 * 0.62, ny, nx, ny + 3, nx + w1 * 0.62, ny, 6);
    d.stroke(node, { t0: t, duration: 0.12, w0: 3.2, taper: 0.4, pression: 0.9 });
    // Hiver : capuchon de neige sur le nœud.
    d.mark({ x: nx, y: ny - 3, angle: 0, size: w1 * 0.75, forme: FORME.NEIGE, role: ROLE.HIVER, t, seasons: WINTER, opacity: 0.9, variant: 0 });
    // Rameaux aux nœuds 0,45 n ≤ i < n − 1 (p = 0,85), longueur 70–130 uf, 0,6 s ; puis 3–5 feuilles, 0,4 s.
    if (i >= n * 0.45 && i < n - 1 && r.chance(0.85)) {
      const side = r.chance(0.5) ? -1 : 1;
      const len = r.range(70, 130);
      const bp = bez(nx, ny, nx + side * len * 0.5, ny - 18, nx + side * len, ny - 40 - r.next() * 20, 10);
      const times = d.stroke(bp, { t0: t, duration: 0.6, w0: 5, taper: 0.7, pression: 0.85 });
      const ex = bp[20]!;
      const ey = bp[21]!;
      const te = times[10]!;
      const nl = r.int(3, 5);
      const droop = side > 0 ? 0.35 : -0.35;
      for (let k = 0; k < nl; k++) {
        const a = (side > 0 ? 0 : PI) + (k - (nl - 1) / 2) * 0.42 + r.signed() * 0.075 + droop;
        const L = r.range(95, 140);
        const W = r.range(10, 15);
        if (k % 3 === 2) accentLeaf(d, ex, ey, a, L, W, te + k * 0.08);
        else sumiLeaf(d, ex, ey, a, L, W, te + k * 0.08, 0.72);
      }
    }
    cx = nx;
    cy = ny;
  }
  // 5 feuilles au sommet.
  for (let k = 0; k < 5; k++) {
    const a = -HALF_PI + (k - 2) * 0.5 + r.signed() * 0.06;
    const L = r.range(90, 130);
    const W = r.range(10, 14);
    if (k % 3 === 2) accentLeaf(d, cx, cy, a, L, W, t + k * 0.08);
    else sumiLeaf(d, cx, cy, a, L, W, t + k * 0.08, 0.72);
  }
}

// ------------------------------------------------------------------------------------------------
// 1 Branche de cerisier
const CHERRY_SPEED = 260; // uf/s
const MAX_DEPTH = 3;
const UP_MIN = (-170 * PI) / 180;
const UP_MAX = (-8 * PI) / 180;

function cherry(d: PlantDraft): void {
  const r = d.rng;
  groundWash(d);
  // Direction initiale vers (800, 300), bornée à [−160°, −20°], ± 0,3 rad.
  let a = atan2(300 - d.y, 800 - d.x);
  a = clamp(a, (-160 * PI) / 180, (-20 * PI) / 180) + r.signed() * 0.3;
  branch(d, d.x, d.y, a, r.range(220, 320), 30, 0, 0);
}

function decorate(d: PlantDraft, x: number, y: number, t: number, tip: boolean): void {
  const r = d.rng;
  // Printemps : fleur (forme 1, sakura, 7–12 uf) + petite fleur (p = 0,25).
  d.mark({ x, y, angle: r.range(0, TAU), size: r.range(7, 12), forme: FORME.FLEUR, role: ROLE.SAKURA, t: t + 0.15, seasons: SPRING, opacity: 0.82, variant: 0 });
  if (r.chance(0.25)) {
    d.mark({ x: x + 9, y: y + 6, angle: r.range(0, TAU), size: 5, forme: FORME.FLEUR, role: ROLE.SAKURA, t: t + 0.3, seasons: SPRING, opacity: 0.7, variant: 0 });
  }
  // Été : feuille verte (10–14 uf).
  const L = r.range(10, 14);
  d.mark({ x, y, angle: r.range(0, TAU), size: L, forme: FORME.FEUILLE, role: ROLE.ETE, t: t + 0.15, seasons: SUMMER, opacity: 0.8, variant: 0.32 });
  // Automne : feuille d'érable (forme 3, rouges, 12–21 uf) + une seconde (p = 0,4).
  d.mark({ x, y, angle: r.range(0, TAU), size: r.range(12, 21) * 0.5, forme: FORME.ERABLE, role: ROLE.ERABLE, t: t + 0.15, seasons: AUTUMN, opacity: 0.88, variant: r.int(0, 2) });
  if (r.chance(0.4)) {
    d.mark({ x: x + 14, y: y + 9, angle: r.range(0, TAU), size: 4.5, forme: FORME.ERABLE, role: ROLE.ERABLE, t: t + 0.3, seasons: AUTUMN, opacity: 0.8, variant: r.int(0, 2) });
  }
  // Hiver : neige sur les pointes, branche nue.
  if (tip) d.mark({ x, y: y - 2, angle: 0, size: 6, forme: FORME.NEIGE, role: ROLE.HIVER, t, seasons: WINTER, opacity: 0.9, variant: 0 });
}

function branch(d: PlantDraft, x: number, y: number, ang: number, len: number, w: number, depth: number, t0: number, continuation = false): void {
  const r = d.rng;
  const n = 16; // 17 points
  const pts: number[] = [];
  let a = ang;
  let cx = x;
  let cy = y;
  const bend = r.signed() * 0.4; // courbure −0,4 à +0,4 rad
  for (let i = 0; i <= n; i++) {
    pts.push(cx, cy);
    // Les branches montent ou s'étalent, jamais vers le sol (réglage du J2 : direction bornée à [−170°, −8°]).
    a = clamp(a + bend / n + r.signed() * 0.025, UP_MIN, UP_MAX);
    cx += (cos(a) * len) / n;
    cy += (sin(a) * len) / n;
  }
  const times = d.stroke(pts, { t0, speed: CHERRY_SPEED, w0: w, taper: 0.75, pression: r.range(0.78, 0.9), splatter: depth < 2, noStartCap: continuation });
  if (depth >= 1) {
    // Décor : 3 candidats par branche (p = 0,55).
    for (let k = 0; k < 3; k++) {
      if (!r.chance(0.55)) continue;
      const i = 2 + Math.floor(r.next() * (n - 3));
      decorate(d, pts[2 * i]! + r.signed() * 7, pts[2 * i + 1]! + r.signed() * 7, times[i]!, false);
    }
  }
  if (depth < MAX_DEPTH) {
    for (let k = 0; k < 3; k++) {
      if (depth >= 2 && r.chance(0.4)) continue; // enfant omis (p = 0,4)
      const side = k % 2 ? 1 : -1;
      const at = k === 2 ? n : Math.floor(n * (0.45 + 0.25 * k));
      const ca = clamp(a + (k === 2 ? r.signed() * 0.15 : side * r.range(0.4, 0.9)), UP_MIN, UP_MAX);
      // L'enfant démarre quand le parent passe son point d'attache.
      branch(d, pts[2 * at]!, pts[2 * at + 1]!, ca, len * r.range(0.62, 0.76), w * 0.6, depth + 1, times[at]!, k === 2);
    }
  } else {
    decorate(d, pts[2 * n]!, pts[2 * n + 1]!, times[n]!, true);
  }
}

// ------------------------------------------------------------------------------------------------
// 2 Herbes
function grass(d: PlantDraft): void {
  const r = d.rng;
  groundWash(d);
  const count = r.int(5, 8);
  const h = r.range(70, 110);
  const heads: number[] = [];
  const blades: number[][] = [];
  for (let i = 0; i < count; i++) {
    const bx = d.x + r.signed() * 23;
    const hh = h * r.range(0.55, 1.15);
    const dir = r.signed();
    const p = bez(bx, d.y, bx + dir * hh * 0.1, d.y - hh * 0.6, bx + dir * hh * 0.55, d.y - hh, 12);
    const dark = r.chance(0.25);
    const times = d.stroke(p, {
      t0: i * 0.12,
      duration: 1.2,
      w0: 6,
      taper: 1,
      pression: r.range(0.62, 0.82),
      role: dark ? ROLE.HERBE : ROLE.SUMI,
      splatter: true,
    });
    blades.push(p);
    heads.push(times[12]!);
  }
  // Été : têtes de graines (forme 2) sur 2 brins (p = 0,5) ; hiver : neige sur les pointes (p = 0,5).
  for (let k = 0; k < Math.min(2, count); k++) {
    if (!r.chance(0.5)) continue;
    const p = blades[k]!;
    const a = atan2(p[25]! - p[23]!, p[24]! - p[22]!);
    d.mark({ x: p[24]!, y: p[25]!, angle: a, size: 4, forme: FORME.BOUTON, role: ROLE.SUMI, t: heads[k]!, seasons: SUMMER, opacity: 0.8, variant: 0 });
  }
  for (let k = 0; k < count; k++) {
    if (!r.chance(0.5)) continue;
    const p = blades[k]!;
    d.mark({ x: p[24]!, y: p[25]! - 1, angle: 0, size: 3.5, forme: FORME.NEIGE, role: ROLE.HIVER, t: heads[k]!, seasons: WINTER, opacity: 0.9, variant: 0 });
  }
}

// ------------------------------------------------------------------------------------------------
// 3 Pivoine
function peony(d: PlantDraft): void {
  const r = d.rng;
  groundWash(d);
  const L = r.range(40, 70);
  const fx = d.x + r.signed() * 8;
  const fy = d.y - L;
  // Tige 0,8 s, largeur 7 → 5.
  d.stroke(bez(d.x, d.y, d.x + (fx - d.x) * 0.2 + r.signed() * 4, d.y - L * 0.5, fx, fy, 8), {
    t0: 0,
    duration: 0.8,
    w0: 7,
    taper: 2 / 7,
    pression: 0.85,
    splatter: true,
  });
  // 2–4 feuilles (forme 0, 60–75 uf) à −1,9 et −1,2 rad ± 0,2 ; 0,5 s.
  const nl = r.int(2, 4);
  for (let k = 0; k < nl; k++) {
    const a = (k % 2 === 0 ? -1.9 : -1.2) + r.signed() * 0.2;
    const len = r.range(60, 75);
    sumiLeaf(d, d.x + (k % 2 === 0 ? -1 : 1) * 2, d.y - 1 - k * 3, a, len, 12, 0.8 + k * 0.12, 0.55);
  }
  // Fleur : 3 couronnes (k = 0..2), 7 − k pétales, rayon R (1 − 0,3 k), R = 36–52 ; 0,5 s par couronne.
  const R = r.range(36, 52);
  const tFlower = 0.8 + 0.5;
  for (let k = 0; k < 3; k++) {
    const cnt = 7 - k;
    const rad = R * (1 - 0.3 * k);
    for (let i = 0; i < cnt; i++) {
      const a = (i / cnt) * TAU + r.next() * 0.4 + k * 0.5;
      d.mark({
        x: fx,
        y: fy,
        angle: a,
        size: rad,
        forme: FORME.PETALE,
        role: ROLE.SAKURA,
        t: tFlower + k * 0.5 + (i / cnt) * 0.25,
        seasons: SPRING_SUMMER,
        opacity: 0.55 - k * 0.05,
        variant: 0.3,
      });
    }
  }
  d.mark({ x: fx, y: fy, angle: 0, size: R * 0.12, forme: FORME.COEUR, role: ROLE.SUMI, t: tFlower + 1.5, seasons: ALL_SEASONS, opacity: 0.75, variant: 0 });
  d.mark({ x: fx, y: fy - R * 0.15, angle: 0, size: R * 0.45, forme: FORME.NEIGE, role: ROLE.HIVER, t: tFlower + 1.5, seasons: WINTER, opacity: 0.9, variant: 0 });
}

// ------------------------------------------------------------------------------------------------
// 4 Roche
function rock(d: PlantDraft): void {
  const r = d.rng;
  groundWash(d);
  const rx = r.range(50, 130);
  const ry = rx * r.range(0.38, 0.5);
  const cx = d.x;
  const cy = d.y - ry * 0.55;
  const K: number[] = [];
  for (let i = 0; i < 14; i++) K.push(r.range(0.86, 1.14));
  // Rayon lissé : Catmull-Rom périodique sur les 14 facteurs.
  const kAt = (th: number): number => {
    let s = (th / TAU) * 14;
    s = s - Math.floor(s / 14) * 14;
    const i = Math.floor(s);
    const f = s - i;
    const p0 = K[(i + 13) % 14]!;
    const p1 = K[i % 14]!;
    const p2 = K[(i + 1) % 14]!;
    const p3 = K[(i + 2) % 14]!;
    return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
  };
  const P = (th: number): [number, number] => {
    const s = sin(th);
    const k = kAt(th);
    return [cx + cos(th) * rx * k, cy + s * ry * k * (s < 0 ? 1.1 : 0.7)];
  };

  // Contour (largeur 3,2) avec manques : motif 60/8/24/6/90/5 uf, tracé en 1,5 s.
  const N = 112;
  const ring: number[] = [];
  const th0 = -PI / 14;
  for (let i = 0; i <= N; i++) {
    const [px, py] = P(th0 + (i / N) * TAU);
    ring.push(px, py);
  }
  let perim = 0;
  for (let i = 1; i <= N; i++) perim += Math.sqrt(sq(ring[2 * i]! - ring[2 * i - 2]!) + sq(ring[2 * i + 1]! - ring[2 * i - 1]!));
  const speed = perim / 1.5;
  const pattern = [60, 8, 24, 6, 90, 5];
  let pi = 0;
  let left = pattern[0]!;
  let drawing = true;
  let acc = 0;
  let cur: number[] = [ring[0]!, ring[1]!];
  let curStart = 0;
  for (let i = 1; i <= N; i++) {
    const x0 = ring[2 * i - 2]!;
    const y0 = ring[2 * i - 1]!;
    const x1 = ring[2 * i]!;
    const y1 = ring[2 * i + 1]!;
    let segLen = Math.sqrt(sq(x1 - x0) + sq(y1 - y0));
    let fx = x0;
    let fy = y0;
    while (segLen > 0) {
      const step = Math.min(segLen, left);
      const t = step / segLen;
      fx = fx + (x1 - fx) * t;
      fy = fy + (y1 - fy) * t;
      segLen -= step;
      left -= step;
      acc += step;
      if (drawing) cur.push(fx, fy);
      if (left <= 1e-9) {
        if (drawing && cur.length >= 4) {
          d.stroke(cur, { t0: curStart / speed, speed, w0: 3.2 * r.range(0.9, 1.25), taper: 0.35, pression: 0.55 });
        }
        drawing = !drawing;
        pi = (pi + 1) % pattern.length;
        left = pattern[pi]!;
        cur = drawing ? [fx, fy] : [];
        curStart = acc;
      }
    }
  }
  if (drawing && cur.length >= 4) d.stroke(cur, { t0: curStart / speed, speed, w0: 3.2, taper: 0.35, pression: 0.55 });

  // Ombre inférieure : largeur 4 + 16 sin(πt), opacité 0,30, 0,5 s.
  const sh: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = 0.15 * PI + (i / 16) * 0.7 * PI;
    sh.push(cx + cos(a) * rx * 0.92, cy + sin(a) * ry * 0.62);
  }
  d.stroke(sh, { t0: 1.5, duration: 0.5, w0: 4, taper: 0, pression: 0.3, dilution: DILUTION.LAVIS, flat: true });
  // Largeur 4 + 16 sin(πt) : réécrite sur le brouillon (profil propre à l'ombre).
  const s = d.strokes[d.strokes.length - 1]!;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    s.hw[i] = 0.5 * (4 + 16 * sin(PI * t));
  }

  // Aplat en lavis (opacité 0,10), 0,6 s : bande entre le haut et le bas du contour, balayée de gauche à droite.
  const M = 28;
  const spine: number[] = [];
  const offs: number[] = [];
  for (let i = 0; i <= M; i++) {
    const phi = (i / M) * PI;
    const [tx, ty] = P(PI + phi);
    const [bx, by] = P(PI - phi);
    spine.push((tx + bx) / 2, (ty + by) / 2);
    offs.push((tx - bx) / 2, (ty - by) / 2);
  }
  d.stroke(spine, { t0: 2.0, duration: 0.6, w0: 1, taper: 0, pression: 0.1, dilution: DILUTION.LAVIS, flat: true, offsets: offs });

  // Mousse : 4 points (forme 6), sumi 0,45 ; vert en été.
  for (let i = 0; i < 4; i++) {
    const mx = cx - rx * 0.4 + r.next() * rx * 0.8;
    const my = cy - ry * 0.5 + r.next() * ry * 0.3;
    const sz = r.range(2, 4.5);
    d.mark({ x: mx, y: my, angle: 0, size: sz, forme: FORME.POINT, role: ROLE.SUMI, t: 1.5 + i * 0.1, seasons: NOT_SUMMER, opacity: 0.45, variant: 0 });
    d.mark({ x: mx, y: my, angle: 0, size: sz, forme: FORME.POINT, role: ROLE.ETE, t: 1.5 + i * 0.1, seasons: SUMMER, opacity: 0.6, variant: 0 });
  }
  // Hiver : 3–5 capuchons sur le haut.
  const caps = r.int(3, 5);
  for (let i = 0; i < caps; i++) {
    const [px, py] = P(PI * (1.2 + (0.6 * (i + 0.5)) / caps));
    d.mark({ x: px, y: py, angle: 0, size: r.range(8, 16), forme: FORME.NEIGE, role: ROLE.HIVER, t: 1.5, seasons: WINTER, opacity: 0.9, variant: 0 });
  }
}

function sq(v: number): number {
  return v * v;
}

export function generateSpecies(d: PlantDraft, espece: SpeciesCode): void {
  if (espece === 0) bamboo(d);
  else if (espece === 1) cherry(d);
  else if (espece === 2) grass(d);
  else if (espece === 3) peony(d);
  else rock(d);
}
