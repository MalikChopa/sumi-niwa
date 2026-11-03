// Jardins fixes pour le déterminisme (ARCHITECTURE 12.1 et 12.2) : mêmes entrées sous Node (Vitest,
// tests/golden/plants.json) et dans le navigateur (determinism.html, Playwright Edge et Chrome).
import type { SpeciesCode } from '../constants';
import { hex8 } from './hash';
import { gardenHashOf, generateGarden, hashPlant } from './plant-gen';

export interface DeterminismCase {
  name: string;
  graine: number;
  plantes: { x: number; y: number; espece: SpeciesCode }[];
}

export const DETERMINISM_CASES: DeterminismCase[] = [
  // Scénario F-3 : graine 9f3a12c4, deux bambous en (500, 792) puis (1100, 792).
  { name: 'F-3', graine: 0x9f3a12c4, plantes: [{ x: 500, y: 792, espece: 0 }, { x: 1100, y: 792, espece: 0 }] },
  // Exemple d'URL de SPEC §8 : un bambou en (800, 792) (même point que `autoplant`).
  { name: 'autoplant', graine: 0x9f3a12c4, plantes: [{ x: 800, y: 792, espece: 0 }] },
  {
    name: 'cinq-especes',
    graine: 0x00c0ffee,
    plantes: [
      { x: 240, y: 800, espece: 1 },
      { x: 520, y: 790, espece: 2 },
      { x: 760, y: 800, espece: 3 },
      { x: 1040, y: 780, espece: 4 },
      { x: 1320, y: 795, espece: 0 },
    ],
  },
  {
    name: 'bords',
    graine: 0xffffffff,
    plantes: [
      { x: 0, y: 0, espece: 0 },
      { x: 1599, y: 899, espece: 1 },
      { x: 800, y: 100, espece: 1 },
      { x: 3, y: 450, espece: 2 },
      { x: 1599, y: 0, espece: 3 },
      { x: 800, y: 899, espece: 4 },
    ],
  },
  {
    name: 'graine-nulle',
    graine: 0,
    plantes: [
      { x: 800, y: 792, espece: 1 },
      { x: 800, y: 792, espece: 1 }, // même point, rang différent : plante différente
    ],
  },
];

export interface CaseResult {
  name: string;
  garden: string;
  plants: string[];
}

export function computeCase(c: DeterminismCase): CaseResult {
  const plants = generateGarden(c.graine, c.plantes);
  return { name: c.name, garden: hex8(gardenHashOf(plants)), plants: plants.map((p) => hex8(hashPlant(p))) };
}

export function computeAllCases(): CaseResult[] {
  return DETERMINISM_CASES.map(computeCase);
}
