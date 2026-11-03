// Choix musicaux et mappages du son (SPEC §9), en fonctions pures : testées sous Node, sans AudioContext.
import { DROP_SOUND, PLANT_NOTES_HZ, SHEET_W, VOLUME_STEP, WIND_SOUND } from '../constants';

/** Indice de note d'une plante en x (uf) : `floor(x / 1600 × 6)`, borné à 0–5. */
export function noteIndex(x: number): number {
  const i = Math.floor((x / SHEET_W) * PLANT_NOTES_HZ.length);
  return i < 0 ? 0 : i >= PLANT_NOTES_HZ.length ? PLANT_NOTES_HZ.length - 1 : i;
}

/** Fréquence (Hz) de la note d'une plantation : gamme pentatonique de ré, la roche (code 4) une octave plus bas. */
export function plantFrequency(x: number, espece: number): number {
  const f = PLANT_NOTES_HZ[noteIndex(x)] ?? PLANT_NOTES_HZ[0];
  return espece === 4 ? f / 2 : f;
}

/**
 * Cible de la rampe de volume à la fin de l'attente de `resume()` : l'état « activé » est relu APRÈS l'attente, car un second
 * appui a pu couper le son entre-temps (audit J6 point 9 : sinon le premier appel remontait le volume d'un son déclaré coupé).
 */
export function rampTarget(on: boolean, volume: number): number {
  return on ? volume : 0;
}

/** Force du vent (0–1) → centre du passe-bande (Hz) : 300 → 1 200. */
export function windCenterHz(strength01: number): number {
  const k = strength01 < 0 ? 0 : strength01 > 1 ? 1 : strength01;
  return WIND_SOUND.hzMin + (WIND_SOUND.hzMax - WIND_SOUND.hzMin) * k;
}

/** Force du vent (0–1) → gain du bruit : 0 → 0,15 (SPEC). */
export function windGain(strength01: number): number {
  const k = strength01 < 0 ? 0 : strength01 > 1 ? 1 : strength01;
  return WIND_SOUND.gainMax * k;
}

/**
 * Force du vent (0–1) estimée côté CPU, sans aucune relecture du GPU : lit pour chaque impulsion de l'anneau sa vitesse
 * pondérée par son âge. `refSpeed` = vitesse (uf/s) qui donne la force 1 ; `bed` = lit de brise toujours présent.
 */
export function windStrength(impulses: readonly { vx: number; vy: number; t: number }[], nowS: number, refSpeed: number, weight: (age: number) => number, bed: number, scale = 1): number {
  let peak = 0;
  for (const i of impulses) {
    const w = weight(nowS - i.t);
    if (w <= 0) continue;
    const v = Math.sqrt(i.vx * i.vx + i.vy * i.vy) * w;
    if (v > peak) peak = v;
  }
  const s = bed + (1 - bed) * Math.min(1, (peak * scale) / refSpeed);
  return s < 0 ? 0 : s > 1 ? 1 : s;
}

/**
 * Gouttes : probabilité de lancer une goutte pendant `dtS`, taux moyen `ratePerS` × (1 − poids de l'hiver) ; aucune goutte
 * en hiver (SPEC : « aucun en hiver »), jamais plus de DROP_SOUND.maxPerS par seconde (`recent` = gouttes des dernières 1 s).
 */
export function dropChance(dtS: number, winterWeight: number, recent: number, ratePerS = 0.9): number {
  if (winterWeight >= 0.5 || recent >= DROP_SOUND.maxPerS) return 0;
  const p = ratePerS * (1 - winterWeight * 2) * dtS;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** Volume (0–1) ± 10 points, borné et arrondi au pas de 10. */
export function stepVolume(v: number, dir: 1 | -1): number {
  const n = Math.round(v / VOLUME_STEP) + dir;
  const c = n < 0 ? 0 : n > 10 ? 10 : n;
  return Math.round(c * VOLUME_STEP * 100) / 100;
}

/** Lit une valeur de volume stockée : nombre entre 0 et 1, arrondi au pas de 10 points ; sinon `fallback`. */
export function sanitizeVolume(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return Math.round(Math.round(c / VOLUME_STEP) * VOLUME_STEP * 100) / 100;
}
