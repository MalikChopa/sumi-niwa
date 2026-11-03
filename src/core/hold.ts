// Choix de l'espèce par la durée d'appui (SPEC §7.1) : fonction pure, testée sous Node.
import { HOLD_START_MS, HOLD_STEP_MS, SPECIES_COUNT, type SpeciesCode } from '../constants';

/**
 * Espèce plantée pour un appui de `ms` millisecondes.
 * < 300 ms : clic, espèce courante ; [300, 800[ bambou, [800, 1300[ cerisier, [1300, 1800[ herbes,
 * [1800, 2300[ pivoine, [2300, 2800[ roche, puis le cycle reprend.
 */
export function speciesForHold(ms: number, current: SpeciesCode): SpeciesCode {
  if (!(ms >= HOLD_START_MS)) return current;
  const step = Math.floor((ms - HOLD_START_MS) / HOLD_STEP_MS);
  return (step % SPECIES_COUNT) as SpeciesCode;
}

/** Avancement (0–1) dans le palier courant de la jauge, pour l'arc. */
export function holdProgress(ms: number): number {
  if (!(ms >= HOLD_START_MS)) return 0;
  const r = (ms - HOLD_START_MS) / HOLD_STEP_MS;
  return r - Math.floor(r);
}
