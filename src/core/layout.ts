// Disposition des tampons et codes partagés par le générateur et le rendu (SPEC §2.2).

/** Rôles de couleur (SPEC §2.2 pour les marques ; 7 = réserve couleur papier, ajout du J2 pour les traits). */
export const ROLE = { SUMI: 0, ACCENT: 1, SAKURA: 2, ETE: 3, ERABLE: 4, HIVER: 5, HERBE: 6, WASHI: 7 } as const;
/** Formes de marque (SPEC §2.2). */
export const FORME = { FEUILLE: 0, FLEUR: 1, BOUTON: 2, ERABLE: 3, PETALE: 4, NEIGE: 5, POINT: 6, COEUR: 7 } as const;
/** Dilutions (SPEC §2.2). */
export const DILUTION = { NET: 0, LAVIS: 1, ECLABOUSSURE: 2 } as const;

/** Échelles par saison (printemps, été, automne, hiver). */
export type Seasons = readonly [number, number, number, number];
export const ALL_SEASONS: Seasons = [1, 1, 1, 1];
export const SPRING: Seasons = [1, 0, 0, 0];
export const SUMMER: Seasons = [0, 1, 0, 0];
export const AUTUMN: Seasons = [0, 0, 1, 0];
export const WINTER: Seasons = [0, 0, 0, 1];

// Disposition des champs (index dans un enregistrement). Lue aussi par le rendu.
export const V = { CX: 0, CY: 1, OX: 2, OY: 3, BX: 4, BY: 5, U: 6, BIRTH: 7, SWAY: 8, PRESS: 9, NOISE: 10, DIL: 11 } as const;
export const M = {
  PX: 0, PY: 1, BX: 2, BY: 3, ANGLE: 4, SIZE: 5, FORME: 6, ROLE: 7, BIRTH: 8, SWAY: 9,
  S0: 10, S1: 11, S2: 12, S3: 13, OPACITY: 14, VARIANT: 15,
} as const;

