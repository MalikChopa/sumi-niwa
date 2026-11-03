// Bornes de tampons (SPEC §2.2, ARCHITECTURE 12.1) : sur 10 000 graines x 5 espèces, maxima de traits, sommets
// et marques ≤ bornes ; au-delà de 90 % d'une borne, le test échoue (la borne doit être relevée).
// Mesure aussi le temps de génération d'une plante (SPEC §12 : ≤ 16 ms, OM).
import { describe, expect, it } from 'vitest';
import { MARKS_MAX_PER_PLANT, STROKES_MAX_PER_PLANT, STROKE_VERTS_MAX_PER_PLANT, type SpeciesCode } from '../../src/constants';
import { generatePlant } from '../../src/core/plant-gen';
import { makeRng } from '../../src/core/prng';

const SEEDS = 10000;
const NAMES = ['bambou', 'cerisier', 'herbes', 'pivoine', 'roche'];

describe('bornes de tampons', () => {
  it(`${SEEDS} graines x 5 espèces : maxima ≤ 90 % des bornes, aucune troncature, géométrie finie`, () => {
    const r = makeRng(0xabad1dea, 1, 2, 3);
    const lines: string[] = [];
    const times: number[] = [];
    for (let e = 0; e < 5; e++) {
      let maxS = 0;
      let maxV = 0;
      let maxM = 0;
      let dropped = 0;
      for (let i = 0; i < SEEDS; i++) {
        const seed = (r.next() * 4294967296) >>> 0;
        // Positions extrêmes une fois sur cinq (coins, bords, haut de la feuille), sinon au hasard.
        const extreme = i % 5 === 0;
        const x = extreme ? [0, 1599, 800, 0, 1599][i % 25 / 5] ?? 0 : Math.floor(r.next() * 1600);
        const y = extreme ? [0, 899, 0, 899, 450][(i / 5) % 5 | 0] ?? 0 : Math.floor(r.next() * 900);
        const t0 = performance.now();
        const g = generatePlant(seed, i % 160, x, y, e as SpeciesCode);
        times.push(performance.now() - t0);
        maxS = Math.max(maxS, g.strokeCount);
        maxV = Math.max(maxV, g.vertCount);
        maxM = Math.max(maxM, g.markCount + g.dropped.marks);
        dropped += g.dropped.strokes + g.dropped.marks;
        if (i % 97 === 0) {
          for (const v of g.verts) if (!Number.isFinite(v)) throw new Error(`NaN dans les sommets (${NAMES[e]}, graine ${seed})`);
          for (const v of g.marks) if (!Number.isFinite(v)) throw new Error(`NaN dans les marques (${NAMES[e]}, graine ${seed})`);
        }
      }
      lines.push(`${NAMES[e]} : traits max ${maxS}/${STROKES_MAX_PER_PLANT}, sommets max ${maxV}/${STROKE_VERTS_MAX_PER_PLANT}, marques max ${maxM}/${MARKS_MAX_PER_PLANT}, éléments tronqués ${dropped}`);
      expect(maxS, NAMES[e]).toBeLessThanOrEqual(0.9 * STROKES_MAX_PER_PLANT);
      expect(maxV, NAMES[e]).toBeLessThanOrEqual(0.9 * STROKE_VERTS_MAX_PER_PLANT);
      expect(maxM, NAMES[e]).toBeLessThanOrEqual(0.9 * MARKS_MAX_PER_PLANT);
      expect(dropped, NAMES[e]).toBe(0);
    }
    times.sort((a, b) => a - b);
    const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))]!.toFixed(3);
    lines.push(`génération d'une plante (Node) : médiane ${p(0.5)} ms, p99 ${p(0.99)} ms, max ${times[times.length - 1]!.toFixed(3)} ms`);
    console.info('[bornes]\n' + lines.join('\n'));
    expect(times[Math.floor(0.99 * times.length)]!).toBeLessThan(16);
  }, 300_000);
});
