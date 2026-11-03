// Saisons (SPEC §5) : poids des quatre saisons, transition lissée sur le temps réel, réglages interpolés.
// TypeScript pur, sans DOM ni GPU, testé sous Node. Aucun `Math` hors liste blanche.
import { SEASON_COUNT, SEASON_PARAMS, SEASON_TRANSITION_MS } from '../constants';

export type SeasonIndex = 0 | 1 | 2 | 3;
export type Weights = readonly [number, number, number, number];

export function isSeason(v: number): v is SeasonIndex {
  return Number.isInteger(v) && v >= 0 && v < SEASON_COUNT;
}

/** Poids « une seule saison » : (1, 0, 0, 0) pour le printemps, etc. */
export function onehot(s: SeasonIndex): Weights {
  return [s === 0 ? 1 : 0, s === 1 ? 1 : 0, s === 2 ? 1 : 0, s === 3 ? 1 : 0];
}

/** Saison suivante (dir = 1) ou précédente (dir = −1), en boucle : printemps → été → automne → hiver → printemps. */
export function stepSeason(s: SeasonIndex, dir: 1 | -1): SeasonIndex {
  return ((s + dir + SEASON_COUNT) % SEASON_COUNT) as SeasonIndex;
}

/** Courbe de la transition (SPEC §5) : smoothstep de 0 à 1. */
export function smooth01(k: number): number {
  const x = k < 0 ? 0 : k > 1 ? 1 : k;
  return x * x * (3 - 2 * x);
}

export interface SeasonAnim {
  /** poids à l'instant de la demande (l'état visuel courant : une demande en cours de route repart de là) */
  from: Weights;
  target: SeasonIndex;
  /** instant de départ (ms, temps réel) */
  startMs: number;
  durMs: number;
}

export function startTransition(current: Weights, target: SeasonIndex, nowMs: number, durMs: number = SEASON_TRANSITION_MS): SeasonAnim {
  return { from: current, target, startMs: nowMs, durMs };
}

/** Progression lissée 0–1 à l'instant donné. */
export function progressAt(a: SeasonAnim, nowMs: number): number {
  if (a.durMs <= 0) return 1;
  return smooth01((nowMs - a.startMs) / a.durMs);
}

export function isDone(a: SeasonAnim, nowMs: number): boolean {
  return nowMs - a.startMs >= a.durMs;
}

/** Poids à l'instant donné : mélange linéaire de l'état de départ vers la saison cible (la somme reste 1). */
export function weightsAt(a: SeasonAnim, nowMs: number): Weights {
  const k = progressAt(a, nowMs);
  const t = onehot(a.target);
  return [a.from[0] + (t[0] - a.from[0]) * k, a.from[1] + (t[1] - a.from[1]) * k, a.from[2] + (t[2] - a.from[2]) * k, a.from[3] + (t[3] - a.from[3]) * k];
}

/** Réglage interpolé : produit scalaire du tableau de la SPEC et des poids. */
export function blend(table: readonly [number, number, number, number], w: Weights): number {
  return table[0] * w[0] + table[1] * w[1] + table[2] * w[2] + table[3] * w[3];
}

export interface SeasonSettings {
  /** part active des porteurs 0–1 */
  part: number;
  /** facteur de brise */
  breeze: number;
  /** vitesse de chute relative à l'automne */
  fall: number;
  /** opacité de la brume relative à celle du J3 (0,06) */
  mist: number;
}

/** Réglages de la SPEC §5 pour des poids donnés (continus pendant la transition). */
export function settingsFor(w: Weights, fallRef: number, mistRef: number): SeasonSettings {
  return {
    part: blend(SEASON_PARAMS.part, w),
    breeze: blend(SEASON_PARAMS.breeze, w),
    fall: blend(SEASON_PARAMS.fall, w) / fallRef,
    mist: blend(SEASON_PARAMS.mist, w) / mistRef,
  };
}

/** Saison dominante (la plus lourde) : pour l'accent de la barre et le type des porteurs. */
export function dominant(w: Weights): SeasonIndex {
  let best: SeasonIndex = 0;
  for (let i = 1; i < SEASON_COUNT; i++) if (w[i] !== undefined && w[i]! > w[best]!) best = i as SeasonIndex;
  return best;
}
