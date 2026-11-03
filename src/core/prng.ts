// Générateurs pseudo-aléatoires déterministes (ARCHITECTURE §5, SPEC §4.1).
// `splitmix32` mélange les entrées (graine du jardin, rang, x, y, espèce) en 4 mots ; `sfc32` (PractRand,
// Chris Doty-Humphrey, domaine public) tire ensuite les nombres de la plante. Arithmétique entière 32 bits
// seulement (`Math.imul`, opérateurs de bits) : identique sur tout moteur JavaScript conforme.

/** Finaliseur 32 bits (variante de splitmix32 : constantes 0x21f0aaad / 0x735a2d97). */
export function mix32(x: number): number {
  let t = x | 0;
  t = t ^ (t >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  t = t ^ (t >>> 15);
  return t >>> 0;
}

/** Suite splitmix32 : état incrémenté de 0x9e3779b9 puis finalisé. */
export function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    return mix32(a);
  };
}

/** sfc32 : renvoie un entier non signé 32 bits à chaque appel. */
export function sfc32u(a0: number, b0: number, c0: number, d0: number): () => number {
  let a = a0 | 0;
  let b = b0 | 0;
  let c = c0 | 0;
  let d = d0 | 0;
  return () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
}

/** Flux aléatoire d'une plante : réels dans [0, 1[ et aides de tirage. */
export interface Rng {
  /** [0, 1[ (32 bits). */
  next(): number;
  /** [lo, hi[ */
  range(lo: number, hi: number): number;
  /** Entier dans [lo, hi] (bornes incluses). */
  int(lo: number, hi: number): number;
  /** Vrai avec la probabilité p. */
  chance(p: number): boolean;
  /** [−1, 1[ */
  signed(): number;
}

export function makeRng(a: number, b: number, c: number, d: number): Rng {
  const u = sfc32u(a, b, c, d);
  // Chauffe : 12 tirages jetés (pratique recommandée pour sfc32).
  for (let i = 0; i < 12; i++) u();
  const next = () => u() / 4294967296;
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    signed: () => next() * 2 - 1,
  };
}

/**
 * Graine d'une plante (ARCHITECTURE §5) : `splitmix32` de (graine du jardin, rang, x, y, espèce) → 4 mots.
 * Chaque entrée est mélangée tour à tour ; le rang compte (l'ordre de plantation fait partie du jardin).
 */
export function plantSeedWords(gardenSeed: number, rank: number, x: number, y: number, species: number): [number, number, number, number] {
  let h = mix32(gardenSeed ^ 0x6a09e667);
  h = mix32((h ^ Math.imul(rank + 1, 0x85ebca6b)) | 0);
  h = mix32((h ^ Math.imul(x + 1, 0xc2b2ae35)) | 0);
  h = mix32((h ^ Math.imul(y + 1, 0x27d4eb2f)) | 0);
  h = mix32((h ^ Math.imul(species + 1, 0x165667b1)) | 0);
  const sm = splitmix32(h);
  return [sm(), sm(), sm(), sm()];
}

export function plantRng(gardenSeed: number, rank: number, x: number, y: number, species: number): Rng {
  const [a, b, c, d] = plantSeedWords(gardenSeed, rank, x, y, species);
  return makeRng(a, b, c, d);
}
