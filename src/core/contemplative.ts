// Mode contemplatif (SPEC F-11) : pilote du jardin et détection d'inactivité, en fonctions pures (aucune horloge,
// aucun DOM) : le temps arrive en paramètre, donc le test peut simuler 12 minutes sans attendre. Hasard : sfc32 seedé
// (jamais `Math.random`) pour qu'un même pilote donne les mêmes actions.
import { CONTEMPLATIVE_IDLE_S, PILOT, SEASON_COUNT, SHEET_H, SHEET_W, SPECIES_COUNT, type SpeciesCode } from '../constants';
import { makeRng, mix32, type Rng } from './prng';

export interface PilotWorld {
  /** plantes dans le jardin (celles de l'utilisateur comptent : le plafond est celui du jardin) */
  plantCount: number;
  /** pieds des plantes déjà posées (uf) */
  feet: readonly { x: number; y: number }[];
  /** saison cible actuelle (0–3) */
  season: number;
}

export type PilotAction =
  | { kind: 'plant'; x: number; y: number; espece: SpeciesCode }
  | { kind: 'gust'; x0: number; y0: number; x1: number; y1: number; durS: number }
  | { kind: 'season'; to: 0 | 1 | 2 | 3 };

export interface Pilot {
  /** Avance de `dtS` secondes (plafonné) ; retourne les actions échues. */
  step(dtS: number, world: PilotWorld): PilotAction[];
  /** temps écoulé du pilote (s) */
  readonly elapsed: number;
  /** plantes posées par le pilote */
  readonly planted: number;
  readonly gusts: number;
  readonly seasons: number;
}

/** Espèce tirée selon PILOT.weights (somme 1). */
export function pickSpecies(u: number): SpeciesCode {
  let acc = 0;
  for (let i = 0; i < SPECIES_COUNT; i++) {
    acc += PILOT.weights[i] ?? 0;
    if (u < acc) return i as SpeciesCode;
  }
  return (SPECIES_COUNT - 1) as SpeciesCode;
}

/** Position libre : bande y 480–860, à PILOT.minFeetUf au moins de tous les pieds ; `null` si PILOT.tries essais échouent. */
export function pickSpot(rng: Rng, feet: readonly { x: number; y: number }[]): { x: number; y: number } | null {
  const d2 = PILOT.minFeetUf * PILOT.minFeetUf;
  for (let k = 0; k < PILOT.tries; k++) {
    const x = Math.round(rng.range(PILOT.xMin, PILOT.xMax));
    const y = Math.round(rng.range(PILOT.yMin, PILOT.yMax));
    let ok = true;
    for (const f of feet) {
      const dx = f.x - x;
      const dy = f.y - y;
      if (dx * dx + dy * dy < d2) {
        ok = false;
        break;
      }
    }
    if (ok) return { x, y };
  }
  return null;
}

export function createPilot(seed: number): Pilot {
  const s = mix32(seed ^ 0x51ed270b);
  const rng = makeRng(s, mix32(s + 1), mix32(s + 2), mix32(s + 3));
  let t = 0;
  let nextPlant = rng.range(PILOT.plantEveryS[0], PILOT.plantEveryS[1]);
  let nextGust = rng.range(PILOT.gustEveryS[0], PILOT.gustEveryS[1]);
  let nextSeason = PILOT.seasonEveryS;
  let planted = 0;
  let gusts = 0;
  let seasons = 0;
  return {
    step(dtS, world) {
      const dt = dtS < 0 ? 0 : dtS > PILOT.dtMaxS ? PILOT.dtMaxS : dtS;
      t += dt;
      const out: PilotAction[] = [];
      if (t >= nextPlant) {
        if (world.plantCount < PILOT.maxPlants) {
          const spot = pickSpot(rng, world.feet);
          if (spot) {
            out.push({ kind: 'plant', x: spot.x, y: spot.y, espece: pickSpecies(rng.next()) });
            planted++;
            nextPlant = t + rng.range(PILOT.plantEveryS[0], PILOT.plantEveryS[1]);
          } else nextPlant = t + PILOT.retryS; // feuille encombrée : nouvel essai bientôt, sans compter une plante
        } else nextPlant = t + PILOT.plantEveryS[1]; // plafond atteint : le pilote ne plante plus
      }
      if (t >= nextGust) {
        // Balayage de gauche à droite ou de droite à gauche, à une hauteur de la bande des plantes.
        const ltr = rng.chance(0.5);
        const y0 = rng.range(PILOT.yMin - 120, PILOT.yMax - 60);
        const y1 = y0 + rng.range(-120, 120);
        const xa = rng.range(120, 360);
        const xb = xa + 1100;
        out.push({ kind: 'gust', x0: ltr ? xa : xb, y0, x1: ltr ? xb : xa, y1, durS: rng.range(2.2, 3.2) });
        gusts++;
        nextGust = t + rng.range(PILOT.gustEveryS[0], PILOT.gustEveryS[1]);
      }
      if (t >= nextSeason) {
        const to = ((world.season + 1) % SEASON_COUNT) as 0 | 1 | 2 | 3;
        out.push({ kind: 'season', to });
        seasons++;
        nextSeason += PILOT.seasonEveryS; // cadence ancrée : une saison toutes les 75 s, sans dérive d image
      }
      return out;
    },
    get elapsed() {
      return t;
    },
    get planted() {
      return planted;
    },
    get gusts() {
      return gusts;
    },
    get seasons() {
      return seasons;
    },
  };
}

/** Vrai si l'inactivité justifie l'entrée automatique : plein écran, hors du mode, ≥ CONTEMPLATIVE_IDLE_S sans interaction. */
export function idleDue(lastActivityMs: number, nowMs: number, fullscreen: boolean, active: boolean): boolean {
  return !active && fullscreen && nowMs - lastActivityMs >= CONTEMPLATIVE_IDLE_S * 1000;
}

/** Les bornes de la feuille que le pilote ne doit jamais dépasser (contrôle de test). */
export const PILOT_BOUNDS = { w: SHEET_W, h: SHEET_H } as const;
