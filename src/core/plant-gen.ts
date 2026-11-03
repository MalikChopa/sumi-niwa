// Génération déterministe d'une plante (SPEC §2.2, §4) : brouillon en coordonnées feuille, puis
// écriture dans les tampons `STROKE_VERTEX` (12 float32) et `MARK_INSTANCE` (16 float32) avec les bornes
// de SPEC §2.2 (troncature déterministe dans l'ordre de génération).
// Tout vient de `sfc32` (graine de plante tirée de la graine du jardin) et de `dmath`.
import {
  MARKS_MAX_PER_PLANT,
  MARK_FLOATS,
  STROKES_MAX_PER_PLANT,
  STROKE_VERTEX_FLOATS,
  STROKE_VERTS_MAX_PER_PLANT,
  type SpeciesCode,
} from '../constants';
import { PI, clamp, cos, hypot, sin } from './dmath';
import { Fnv1a } from './hash';
import { plantRng, type Rng } from './prng';
import { generateSpecies } from './species';
import { ALL_SEASONS, DILUTION, FORME, M, ROLE, V } from './layout';
import type { Seasons } from './layout';

export interface StrokeOpts {
  /** Naissance du premier point (s, relatif à la plantation). */
  t0: number;
  /** Durée du tracé (s) : vitesse = longueur / durée. Ignorée si `speed` est donné. */
  duration?: number;
  /** Vitesse en uf/s. */
  speed?: number;
  /** Largeur pleine au départ (uf). */
  w0: number;
  /** Effilement : largeur × (1 − effilement × u). */
  taper: number;
  /** Opacité / pression de départ (0–1). */
  pression: number;
  dilution?: number;
  role?: number;
  /** Profil de largeur constant (sans le renflement commun 0,88 + 0,12 sin πu). */
  flat?: boolean;
  /** Deux bouts effilés (lavis de sol) : largeur × √(sin πu). */
  pointedEnds?: boolean;
  /** Pas de bout arrondi au départ (trait qui prolonge un autre dans la même direction). */
  noStartCap?: boolean;
  /** Décalages explicites (aplat en bande) : remplacent normale × demi-largeur. */
  offsets?: number[];
  /** Éclaboussure possible au début du trait (SPEC §4.1, p = 0,15). */
  splatter?: boolean;
}

interface StrokeDraft {
  pts: number[];
  hw: number[];
  times: number[];
  press: number[];
  offs: number[] | null;
  seed: number;
  dil: number;
  role: number;
  /** Deux points de bout ajoutés de chaque côté (u = 0 ou 1). */
  capped: boolean;
}

interface MarkDraft {
  x: number;
  y: number;
  angle: number;
  size: number;
  forme: number;
  role: number;
  t: number;
  seasons: Seasons;
  opacity: number;
  variant: number;
}

/** Brouillon d'une plante : les espèces y ajoutent traits et marques, dans l'ordre de dessin. */
export class PlantDraft {
  readonly strokes: StrokeDraft[] = [];
  readonly marks: MarkDraft[] = [];
  end = 0;

  constructor(
    readonly rng: Rng,
    readonly x: number,
    readonly y: number,
  ) {}

  /** Ruban le long d'une polyligne `pts` (x0, y0, x1, y1…). Renvoie la naissance de chaque point. */
  stroke(pts: number[], o: StrokeOpts): number[] {
    const n = pts.length / 2;
    const cum: number[] = [0];
    for (let i = 1; i < n; i++) {
      cum.push((cum[i - 1] as number) + hypot(pts[2 * i]! - pts[2 * i - 2]!, pts[2 * i + 1]! - pts[2 * i - 1]!));
    }
    const len = cum[n - 1] as number;
    const speed = o.speed ?? (len > 0 && o.duration ? len / o.duration : 1e6);
    const hw: number[] = [];
    const times: number[] = [];
    const press: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0;
      // SPEC §4.1 : w(u) = w0 × (1 − effilement × u) × (0,88 + 0,12 × sin(πu))
      const bulge = o.flat ? 1 : 0.88 + 0.12 * sin(PI * u);
      const ends = o.pointedEnds ? Math.sqrt(Math.max(0, sin(PI * u))) : 1;
      hw.push(0.5 * o.w0 * (1 - o.taper * u) * bulge * ends);
      times.push(o.t0 + (cum[i] as number) / speed);
      press.push(o.pression * (1 - 0.12 * u));
    }
    const seed = this.rng.int(1, 4095);
    const dil = o.dilution ?? DILUTION.NET;
    const role = o.role ?? ROLE.SUMI;
    if (dil === DILUTION.NET && role !== ROLE.WASHI && !o.offsets && n >= 2) {
      // Bouts arrondis (réglage du J2) : deux points de plus à chaque bout, sur la tangente, demi-largeur
      // hw × √(1 − c²) pour c = 0,6 et 1 : plus de coupe carrée au départ ni à la pointe d'un trait.
      const cp: number[] = [];
      const ch: number[] = [];
      const ct: number[] = [];
      const cr: number[] = [];
      const cap = (i: number, j: number, rev: boolean) => {
        let dx = pts[2 * i]! - pts[2 * j]!;
        let dy = pts[2 * i + 1]! - pts[2 * j + 1]!;
        const l = hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
        const h = hw[i]!;
        const cs = rev ? [0.6, 1] : [1, 0.6];
        for (const c of cs) {
          cp.push(pts[2 * i]! + dx * h * c * 0.9, pts[2 * i + 1]! + dy * h * c * 0.9);
          ch.push(h * Math.sqrt(1 - c * c));
          ct.push(times[i]!);
          cr.push(press[i]!);
        }
      };
      if (o.noStartCap) {
        // Deux points confondus avec le départ : même nombre de sommets, aucune avancée du bout.
        for (let k = 0; k < 2; k++) {
          cp.push(pts[0]!, pts[1]!);
          ch.push(hw[0]!);
          ct.push(times[0]!);
          cr.push(press[0]!);
        }
      } else cap(0, 1, false);
      for (let i = 0; i < n; i++) {
        cp.push(pts[2 * i]!, pts[2 * i + 1]!);
        ch.push(hw[i]!);
        ct.push(times[i]!);
        cr.push(press[i]!);
      }
      cap(n - 1, n - 2, true);
      this.strokes.push({ pts: cp, hw: ch, times: ct, press: cr, offs: null, seed, dil, role, capped: true });
    } else {
      this.strokes.push({ pts: pts.slice(), hw, times, press, offs: o.offsets ?? null, seed, dil, role, capped: false });
    }
    const tEnd = times[n - 1] as number;
    if (tEnd > this.end) this.end = tEnd;
    if (o.splatter && dil === DILUTION.NET && role === ROLE.SUMI && this.rng.chance(0.15)) {
      // Éclaboussure : point (forme 6) de 1,5–4 uf près du début du trait.
      const a = this.rng.range(0, 2 * PI);
      const d = this.rng.range(6, 16);
      this.mark({
        x: pts[0]! + d * cos(a),
        y: pts[1]! + d * sin(a),
        angle: a,
        size: this.rng.range(1.5, 4),
        forme: FORME.POINT,
        role: ROLE.SUMI,
        t: o.t0,
        seasons: ALL_SEASONS,
        opacity: this.rng.range(0.5, 0.8),
        variant: 0,
      });
    }
    return times;
  }

  mark(m: MarkDraft): void {
    this.marks.push(m);
    if (m.t > this.end) this.end = m.t;
  }
}

export interface PlantGeometry {
  rank: number;
  x: number;
  y: number;
  espece: SpeciesCode;
  /** `vertCount` × 12 float32 */
  verts: Float32Array;
  vertCount: number;
  indices: Uint16Array;
  indexCount: number;
  strokeCount: number;
  /** `markCount` × 16 float32 */
  marks: Float32Array;
  markCount: number;
  /** Fin de croissance, en s depuis la plantation (marques comprises, sans leur durée d'éclosion). */
  duration: number;
  /** Éléments écartés par les bornes (troncature déterministe). */
  dropped: { strokes: number; marks: number };
  /** Hauteur avant mise à l'échelle et facteur appliqué (borne de hauteur, SPEC §4.1). */
  rawHeight: number;
  scale: number;
}

/** Hauteur minimale conservée quand la plante est près du haut de la feuille (SPEC §4.1 : 120 pour le bambou). */
const MIN_HEIGHT = [120, 60, 40, 40, 30] as const;

export function generatePlant(gardenSeed: number, rank: number, x: number, y: number, espece: SpeciesCode): PlantGeometry {
  const rng = plantRng(gardenSeed, rank, x, y, espece);
  const d = new PlantDraft(rng, x, y);
  generateSpecies(d, espece);
  return finalize(d, rank, espece);
}

function finalize(d: PlantDraft, rank: number, espece: SpeciesCode): PlantGeometry {
  // 1. Borne de hauteur : la plante ne dépasse pas y − 60 uf (sommet de la plante ≥ 60 uf du haut).
  let top = d.y;
  for (const s of d.strokes) {
    for (let i = 0; i < s.hw.length; i++) top = Math.min(top, s.pts[2 * i + 1]! - s.hw[i]!);
  }
  for (const m of d.marks) top = Math.min(top, m.y - m.size);
  const rawHeight = d.y - top;
  const limit = Math.max(d.y - 60, MIN_HEIGHT[espece]);
  const scale = rawHeight > limit ? limit / rawHeight : 1;
  const h = Math.max(1, rawHeight * scale);
  const sx = (px: number) => d.x + (px - d.x) * scale;
  const sy = (py: number) => d.y + (py - d.y) * scale;
  const swayOf = (py: number) => {
    if (espece === 4) return 0; // roche : SWAY_MAX 0
    const t = clamp((d.y - py) / h, 0, 1);
    return t * Math.sqrt(t); // puissance 1,5 (SPEC §4.1)
  };

  // 2. Traits, bornés (un trait qui ferait dépasser les sommets est écarté en entier).
  let vertCount = 0;
  let strokeCount = 0;
  let indexCount = 0;
  let droppedStrokes = 0;
  const kept: StrokeDraft[] = [];
  for (const s of d.strokes) {
    const n = s.hw.length;
    if (n < 2 || strokeCount >= STROKES_MAX_PER_PLANT || vertCount + 2 * n > STROKE_VERTS_MAX_PER_PLANT) {
      droppedStrokes++;
      continue;
    }
    kept.push(s);
    strokeCount++;
    vertCount += 2 * n;
    indexCount += 6 * (n - 1);
  }
  const verts = new Float32Array(vertCount * STROKE_VERTEX_FLOATS);
  const indices = new Uint16Array(indexCount);
  let vi = 0;
  let ii = 0;
  for (const s of kept) {
    const n = s.hw.length;
    const base = vi;
    for (let i = 0; i < n; i++) {
      const cx = sx(s.pts[2 * i]!);
      const cy = sy(s.pts[2 * i + 1]!);
      let ox: number;
      let oy: number;
      if (s.offs) {
        ox = s.offs[2 * i]! * scale;
        oy = s.offs[2 * i + 1]! * scale;
      } else {
        // Normale par différences centrées (comme `ribbon` de la maquette).
        let a = Math.max(0, i - 1);
        let b = Math.min(n - 1, i + 1);
        let tx = s.pts[2 * b]! - s.pts[2 * a]!;
        let ty = s.pts[2 * b + 1]! - s.pts[2 * a + 1]!;
        // Points confondus (départ sans bout arrondi) : on élargit la fenêtre jusqu'à un point distinct.
        while (tx === 0 && ty === 0 && (a > 0 || b < n - 1)) {
          a = Math.max(0, a - 1);
          b = Math.min(n - 1, b + 1);
          tx = s.pts[2 * b]! - s.pts[2 * a]!;
          ty = s.pts[2 * b + 1]! - s.pts[2 * a + 1]!;
        }
        const l = hypot(tx, ty);
        if (l > 0) {
          tx /= l;
          ty /= l;
        } else {
          tx = 1;
          ty = 0;
        }
        // Demi-largeur plancher 0,15 uf : la direction de la normale reste définie à la pointe.
        const w = Math.max(0.15, s.hw[i]!) * scale;
        ox = -ty * w;
        oy = tx * w;
      }
      // u : 0 → 1 le long du trait d'origine ; les points de bout gardent 0 ou 1.
      const u = s.capped ? Math.min(1, Math.max(0, (i - 2) / (n - 5))) : n > 1 ? i / (n - 1) : 0;
      for (const side of [1, -1]) {
        const o = vi * STROKE_VERTEX_FLOATS;
        verts[o + V.CX] = cx;
        verts[o + V.CY] = cy;
        verts[o + V.OX] = ox * side;
        verts[o + V.OY] = oy * side;
        verts[o + V.BX] = d.x;
        verts[o + V.BY] = d.y;
        verts[o + V.U] = u;
        verts[o + V.BIRTH] = s.times[i]!;
        verts[o + V.SWAY] = swayOf(cy);
        verts[o + V.PRESS] = s.press[i]!;
        verts[o + V.NOISE] = s.seed * 4 + (side + 1); // graine du trait et côté (−1 / +1), entiers exacts
        verts[o + V.DIL] = s.dil + 8 * s.role;
        vi++;
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + 2 * i;
      indices[ii++] = a;
      indices[ii++] = a + 1;
      indices[ii++] = a + 2;
      indices[ii++] = a + 1;
      indices[ii++] = a + 3;
      indices[ii++] = a + 2;
    }
  }

  // 3. Marques, bornées dans l'ordre de génération.
  const markCount = Math.min(d.marks.length, MARKS_MAX_PER_PLANT);
  const marks = new Float32Array(markCount * MARK_FLOATS);
  for (let k = 0; k < markCount; k++) {
    const m = d.marks[k]!;
    const o = k * MARK_FLOATS;
    const my = sy(m.y);
    marks[o + M.PX] = sx(m.x);
    marks[o + M.PY] = my;
    marks[o + M.BX] = d.x;
    marks[o + M.BY] = d.y;
    marks[o + M.ANGLE] = m.angle;
    marks[o + M.SIZE] = m.size * scale;
    marks[o + M.FORME] = m.forme;
    marks[o + M.ROLE] = m.role;
    marks[o + M.BIRTH] = m.t;
    marks[o + M.SWAY] = swayOf(my);
    marks[o + M.S0] = m.seasons[0];
    marks[o + M.S1] = m.seasons[1];
    marks[o + M.S2] = m.seasons[2];
    marks[o + M.S3] = m.seasons[3];
    marks[o + M.OPACITY] = m.opacity;
    marks[o + M.VARIANT] = m.variant;
  }

  return {
    rank,
    x: d.x,
    y: d.y,
    espece,
    verts,
    vertCount,
    indices,
    indexCount,
    strokeCount,
    marks,
    markCount,
    duration: d.end,
    dropped: { strokes: droppedStrokes, marks: d.marks.length - markCount },
    rawHeight,
    scale,
  };
}

/** Ajoute une plante au hachage FNV-1a (ordre fixe : compteurs, sommets, indices, marques). */
export function hashInto(f: Fnv1a, g: PlantGeometry): void {
  f.u32(g.vertCount);
  f.u32(g.indexCount);
  f.u32(g.markCount);
  f.floats(g.verts, g.vertCount * STROKE_VERTEX_FLOATS);
  f.u16s(g.indices, g.indexCount);
  f.floats(g.marks, g.markCount * MARK_FLOATS);
}

/** `hashPlante()` (ARCHITECTURE 12.1). */
export function hashPlant(g: PlantGeometry): number {
  const f = new Fnv1a();
  hashInto(f, g);
  return f.value();
}

/** `gardenHash()` (SPEC §8) : FNV-1a des tampons de toutes les plantes, dans l'ordre de plantation. */
export function gardenHashOf(plants: readonly PlantGeometry[]): number {
  const f = new Fnv1a();
  for (const g of plants) hashInto(f, g);
  return f.value();
}

/** Génère toutes les plantes d'un état (utilisé par les tests, `determinism.html` et le rendu). */
export function generateGarden(graine: number, plantes: readonly { x: number; y: number; espece: SpeciesCode }[]): PlantGeometry[] {
  return plantes.map((p, rank) => generatePlant(graine, rank, p.x, p.y, p.espece));
}
