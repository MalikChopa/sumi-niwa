// Modèle d'état du jardin (ARCHITECTURE §5) : graine + saison + liste ordonnée des plantations.
// Tout le reste (géométrie, hash) en est dérivé par `plant-gen`. Réducteur pur, sans DOM.
import { MAX_PLANTS, SHEET_H, SHEET_W, SPECIES_COUNT, type SpeciesCode } from '../constants';

export interface PlantEvent {
  /** Entiers en uf : x 0–1599, y 0–899. */
  x: number;
  y: number;
  espece: SpeciesCode;
}

export interface GardenState {
  version: 1;
  /** u32 */
  graine: number;
  /** 0 printemps, 1 été, 2 automne, 3 hiver */
  saison: 0 | 1 | 2 | 3;
  plantes: PlantEvent[];
}

export function newGarden(graine: number, saison: 0 | 1 | 2 | 3 = 0): GardenState {
  return { version: 1, graine: graine >>> 0, saison, plantes: [] };
}

export function isSpecies(v: number): v is SpeciesCode {
  return Number.isInteger(v) && v >= 0 && v < SPECIES_COUNT;
}

/** Ramène un point en uf à des entiers dans la feuille (contrat d'URL : x ≤ 1599, y ≤ 899). */
export function snapToSheet(x: number, y: number): { x: number; y: number } {
  const ix = Math.round(x);
  const iy = Math.round(y);
  return {
    x: ix < 0 ? 0 : ix > SHEET_W - 1 ? SHEET_W - 1 : ix,
    y: iy < 0 ? 0 : iy > SHEET_H - 1 ? SHEET_H - 1 : iy,
  };
}

export type PlantResult = { ok: true; state: GardenState; rank: number } | { ok: false; reason: 'plein' | 'invalide' };

/** Ajoute une plantation (SPEC §11 : refus au-delà de MAX_PLANTS). L'état d'entrée n'est pas modifié. */
export function plant(state: GardenState, x: number, y: number, espece: number): PlantResult {
  if (!isSpecies(espece)) return { ok: false, reason: 'invalide' };
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: 'invalide' };
  if (state.plantes.length >= MAX_PLANTS) return { ok: false, reason: 'plein' };
  const p = snapToSheet(x, y);
  const rank = state.plantes.length;
  return { ok: true, rank, state: { ...state, plantes: [...state.plantes, { x: p.x, y: p.y, espece }] } };
}

/** Change la saison du jardin (J4). L'état d'entrée n'est pas modifié. */
export function setSeason(state: GardenState, saison: number): GardenState {
  if (saison !== 0 && saison !== 1 && saison !== 2 && saison !== 3) return state;
  return { ...state, saison };
}
