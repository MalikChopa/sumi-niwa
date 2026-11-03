// État, fragment d'URL (SPEC §8) et jauge de maintien (SPEC §7.1).
import { describe, expect, it } from 'vitest';
import { MAX_PLANTS, type SpeciesCode } from '../../src/constants';
import { holdProgress, speciesForHold } from '../../src/core/hold';
import { makeRng } from '../../src/core/prng';
import { newGarden, plant } from '../../src/core/state';
import { decodeFragment, encodeFragment } from '../../src/core/url-codec';

describe('fragment d’URL', () => {
  it('exemple de SPEC §8 : bambou en (800, 792), graine 9f3a12c4, automne → #g=1.9f3a12c4.2.ZBjA', () => {
    const s = { version: 1 as const, graine: 0x9f3a12c4, saison: 2 as const, plantes: [{ x: 800, y: 792, espece: 0 as SpeciesCode }] };
    expect(encodeFragment(s)).toBe('#g=1.9f3a12c4.2.ZBjA');
    const d = decodeFragment('#g=1.9f3a12c4.2.ZBjA');
    expect(d).toEqual({ ok: true, state: s });
  });

  it('aller-retour sur 1 000 jardins', () => {
    const r = makeRng(9, 8, 7, 6);
    for (let i = 0; i < 1000; i++) {
      const n = r.int(0, MAX_PLANTS);
      const plantes = Array.from({ length: n }, () => ({ x: r.int(0, 1599), y: r.int(0, 899), espece: r.int(0, 4) as SpeciesCode }));
      const s = { version: 1 as const, graine: (r.next() * 4294967296) >>> 0, saison: r.int(0, 3) as 0 | 1 | 2 | 3, plantes };
      expect(decodeFragment(encodeFragment(s))).toEqual({ ok: true, state: s });
    }
  });

  it('liens abîmés refusés en entier', () => {
    const bad = [
      '#g=2.9f3a12c4.2.ZBjA', // version future
      '#g=1.9f3a12c.2.ZBjA', // graine ≠ 8 hex
      '#g=1.9F3A12C4.2.ZBjA', // majuscules
      '#g=1.9f3a12c4.4.ZBjA', // saison
      '#g=1.9f3a12c4.2.ZBj', // longueur
      '#g=1.9f3a12c4.2.ZBj*', // caractère
      '#g=1.9f3a12c4.2.____', // x > 1599
      '#g=1.9f3a12c4.2', // champ manquant
      '#g=1.9f3a12c4.2.' + 'ZBjA'.repeat(MAX_PLANTS + 1), // plus de 160 plantes
    ];
    for (const b of bad) expect(decodeFragment(b).ok, b).toBe(false);
    expect(decodeFragment('#g=2.9f3a12c4.2.ZBjA')).toEqual({ ok: false, reason: 'version-future' });
    expect(decodeFragment('')).toEqual({ ok: false, reason: 'absent' });
    expect(decodeFragment('#g=1.9f3a12c4.0.')).toMatchObject({ ok: true }); // feuille vide valide
  });
});

describe('état', () => {
  it('plantation : entiers dans la feuille, refus au-delà de 160 plantes', () => {
    let s = newGarden(1);
    for (let i = 0; i < MAX_PLANTS; i++) {
      const r = plant(s, 2000.4, -3.6, i % 5);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }
    expect(s.plantes[0]).toEqual({ x: 1599, y: 0, espece: 0 });
    expect(plant(s, 1, 1, 0)).toEqual({ ok: false, reason: 'plein' });
    expect(plant(newGarden(1), 1, 1, 7)).toEqual({ ok: false, reason: 'invalide' });
  });
});

describe('jauge de maintien', () => {
  it('durée → espèce (SPEC §7.1)', () => {
    expect(speciesForHold(100, 3)).toBe(3); // clic : espèce courante
    expect(speciesForHold(299, 2)).toBe(2);
    expect(speciesForHold(300, 2)).toBe(0);
    expect(speciesForHold(799, 2)).toBe(0);
    expect(speciesForHold(800, 2)).toBe(1);
    expect(speciesForHold(1500, 0)).toBe(2); // variante de F-2 : 1 500 ms → herbes
    expect(speciesForHold(1800, 0)).toBe(3);
    expect(speciesForHold(2300, 0)).toBe(4);
    expect(speciesForHold(2800, 4)).toBe(0); // le cycle reprend
    expect(holdProgress(550)).toBeCloseTo(0.5, 9);
    expect(holdProgress(100)).toBe(0);
  });
});
