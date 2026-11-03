// Cohérence de la géométrie générée : normales des rubans continues (pas de normale de secours au départ d'un
// trait), plantes sous la borne de hauteur, branches de cerisier jamais tournées vers le sol.
import { describe, expect, it } from 'vitest';
import { STROKE_VERTEX_FLOATS, type SpeciesCode } from '../../src/constants';
import { V } from '../../src/core/layout';
import { generatePlant } from '../../src/core/plant-gen';

const F = STROKE_VERTEX_FLOATS;

describe('géométrie', () => {
  it('normales continues le long de chaque ruban (500 plantes par espèce)', () => {
    let worst = 1;
    for (let e = 0; e < 5; e++) {
      for (let i = 0; i < 500; i++) {
        const g = generatePlant(i * 7919 + 13, i % 160, 200 + (i % 12) * 100, 780 + (i % 5) * 20, e as SpeciesCode);
        // Paires (gauche, droite) consécutives d'un même trait : même graine de trait (bruit >> 2).
        for (let k = 0; k + 3 < g.vertCount; k += 2) {
          const s1 = Math.floor(g.verts[k * F + V.NOISE]! / 4);
          const s2 = Math.floor(g.verts[(k + 2) * F + V.NOISE]! / 4);
          if (s1 !== s2) continue;
          const ax = g.verts[k * F + V.OX]!;
          const ay = g.verts[k * F + V.OY]!;
          const bx = g.verts[(k + 2) * F + V.OX]!;
          const by = g.verts[(k + 2) * F + V.OY]!;
          const la = Math.hypot(ax, ay);
          const lb = Math.hypot(bx, by);
          if (la < 0.2 || lb < 0.2) continue; // pointes : direction peu significative
          worst = Math.min(worst, (ax * bx + ay * by) / (la * lb));
        }
      }
    }
    // Deux normales voisines font moins de 60° (cos > 0,5).
    expect(worst).toBeGreaterThan(0.5);
  });

  it('borne de hauteur : sommet ≥ 60 uf du haut quand la place existe ; cerisier tourné vers le haut', () => {
    for (let i = 0; i < 300; i++) {
      const e = (i % 5) as SpeciesCode;
      const y = 300 + (i % 6) * 100;
      const g = generatePlant(i + 1, 0, 800, y, e);
      let top = y;
      for (let k = 0; k < g.vertCount; k++) top = Math.min(top, g.verts[k * F + V.CY]! - Math.hypot(g.verts[k * F + V.OX]!, g.verts[k * F + V.OY]!));
      expect(top, `espèce ${e}, y ${y}`).toBeGreaterThanOrEqual(60 - 1e-3);
      if (e === 1) {
        // Aucun point nettement sous le pied : seuls le bout arrondi du tronc (0,9 × demi-largeur 15 uf)
        // et le lavis de sol (y + 4 ± 4) descendent un peu.
        for (let k = 0; k < g.vertCount; k++) expect(g.verts[k * F + V.CY]!).toBeLessThanOrEqual(y + 14);
      }
    }
  });
});
