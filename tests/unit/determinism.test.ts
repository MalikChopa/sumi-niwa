// Déterminisme (ARCHITECTURE 12.1, scénario F-3) : `hashPlante()` et `gardenHash()` égaux aux valeurs de
// référence de tests/golden/plants.json ; mêmes entrées → même hash ; deux graines → deux hash.
// Régénérer les références (seulement si la géométrie change volontairement) : `npm run golden:update`.
import { describe, expect, it } from 'vitest';
import { computeAllCases, DETERMINISM_CASES } from '../../src/core/determinism-cases';
import { hex8 } from '../../src/core/hash';
import { gardenHashOf, generateGarden, generatePlant, hashPlant } from '../../src/core/plant-gen';
import golden from '../golden/plants.json';

const results = computeAllCases();

describe('déterminisme', () => {
  if (import.meta.env.MODE === 'golden') {
    it('écrit tests/golden/plants.json', async () => {
      const fs = await import('node:fs');
      const out = { note: 'Valeurs de référence calculées sous Node (Vitest) par computeAllCases() ; à comparer au navigateur (determinism.html).', cases: results };
      fs.writeFileSync('tests/golden/plants.json', JSON.stringify(out, null, 2) + '\n');
    });
    return;
  }

  it('égal aux valeurs de référence (tests/golden/plants.json)', () => {
    expect(results).toEqual(golden.cases);
  });

  it('F-3 : deux bambous de la graine 9f3a12c4, deux hash différents', () => {
    const f3 = results.find((r) => r.name === 'F-3')!;
    expect(f3.plants).toHaveLength(2);
    expect(f3.plants[0]).not.toBe(f3.plants[1]);
  });

  it('mêmes entrées → même hash (deux générations indépendantes)', () => {
    for (const c of DETERMINISM_CASES) {
      const a = gardenHashOf(generateGarden(c.graine, c.plantes));
      const b = gardenHashOf(generateGarden(c.graine, c.plantes));
      expect(a).toBe(b);
    }
  });

  it('deux graines → deux hash ; même point, rang différent → plante différente', () => {
    const p = [{ x: 800, y: 792, espece: 0 as const }];
    expect(gardenHashOf(generateGarden(0x9f3a12c4, p))).not.toBe(gardenHashOf(generateGarden(0x9f3a12c5, p)));
    const nulle = results.find((r) => r.name === 'graine-nulle')!;
    expect(nulle.plants[0]).not.toBe(nulle.plants[1]);
  });

  it('aucune paire de plantes identiques sur 2 000 plantations d’un même jardin', () => {
    const seen = new Set<string>();
    for (let rank = 0; rank < 2000; rank++) {
      const g = generatePlant(0x1234abcd, rank, 800, 792, (rank % 5) as 0 | 1 | 2 | 3 | 4);
      seen.add(hex8(hashPlant(g)));
    }
    expect(seen.size).toBe(2000);
  });
});
