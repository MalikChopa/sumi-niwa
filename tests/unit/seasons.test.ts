// Saisons (SPEC §5, F-7), nom et taille de l'export (SPEC §8), dictionnaires FR / EN (ARCHITECTURE 12.1).
import { describe, expect, it } from 'vitest';
import { EXPORT_H, EXPORT_W, SEASON_PARAMS, SEASON_TRANSITION_MAX_MS, SEASON_TRANSITION_MS } from '../../src/constants';
import { exportFileName, exportSize, seasonName } from '../../src/core/export-name';
import { blend, dominant, isDone, onehot, progressAt, settingsFor, smooth01, startTransition, stepSeason, weightsAt, type Weights } from '../../src/core/seasons';
import { newGarden, setSeason } from '../../src/core/state';
import { decodeFragment, encodeFragment } from '../../src/core/url-codec';
import { EN, FR } from '../../src/ui/dict';

const sum = (w: Weights) => w[0] + w[1] + w[2] + w[3];

describe('saisons', () => {
  it('ordre printemps → été → automne → hiver → printemps, dans les deux sens', () => {
    expect(stepSeason(0, 1)).toBe(1);
    expect(stepSeason(2, 1)).toBe(3);
    expect(stepSeason(3, 1)).toBe(0);
    expect(stepSeason(0, -1)).toBe(3);
    expect(stepSeason(2, -1)).toBe(1);
  });

  it('transition : de l’état courant à la cible en SEASON_TRANSITION_MS (3 600 < 4 000), smoothstep, somme des poids = 1', () => {
    expect(SEASON_TRANSITION_MS).toBe(3600);
    expect(SEASON_TRANSITION_MS).toBeLessThan(SEASON_TRANSITION_MAX_MS);
    const a = startTransition(onehot(0), 1, 1000);
    expect(weightsAt(a, 1000)).toEqual([1, 0, 0, 0]);
    expect(isDone(a, 1000 + SEASON_TRANSITION_MS - 1)).toBe(false);
    expect(isDone(a, 1000 + SEASON_TRANSITION_MS)).toBe(true);
    expect(weightsAt(a, 1000 + SEASON_TRANSITION_MS)).toEqual([0, 1, 0, 0]);
    // mi-chemin : smoothstep(0,5) = 0,5
    const mid = weightsAt(a, 1000 + SEASON_TRANSITION_MS / 2);
    expect(mid[0]).toBeCloseTo(0.5, 9);
    expect(mid[1]).toBeCloseTo(0.5, 9);
    // monotone, somme 1 à chaque instant
    let prev = -1;
    for (let t = 0; t <= SEASON_TRANSITION_MS; t += 36) {
      const w = weightsAt(a, 1000 + t);
      expect(sum(w)).toBeCloseTo(1, 12);
      expect(w[1]).toBeGreaterThanOrEqual(prev);
      prev = w[1];
    }
  });

  it('une demande pendant une transition repart de l’état visuel courant (pas de saut)', () => {
    const a = startTransition(onehot(0), 1, 0);
    const cur = weightsAt(a, 1200); // en route vers l'été
    const b = startTransition(cur, 2, 1200); // l'utilisateur veut l'automne
    expect(weightsAt(b, 1200)).toEqual(cur); // aucun saut à l'instant de la demande
    expect(weightsAt(b, 1200 + SEASON_TRANSITION_MS)).toEqual([0, 0, 1, 0]);
    // continuité : l'écart entre deux instants voisins reste petit
    for (let t = 1200; t < 1200 + SEASON_TRANSITION_MS; t += 16) {
      const w0 = weightsAt(b, t);
      const w1 = weightsAt(b, t + 16);
      for (let i = 0; i < 4; i++) expect(Math.abs(w1[i]! - w0[i]!)).toBeLessThan(0.03);
    }
  });

  it('smoothstep : bornes et symétrie', () => {
    expect(smooth01(-1)).toBe(0);
    expect(smooth01(2)).toBe(1);
    expect(smooth01(0.25) + smooth01(0.75)).toBeCloseTo(1, 12);
    expect(progressAt(startTransition(onehot(0), 3, 0, 1000), 500)).toBeCloseTo(0.5, 12);
  });

  it('réglages de la SPEC §5 : valeurs exactes à l’arrivée, interpolées entre deux', () => {
    const t = SEASON_PARAMS;
    for (let s = 0 as 0 | 1 | 2 | 3; s < 4; s = (s + 1) as 0 | 1 | 2 | 3) {
      const st = settingsFor(onehot(s), 45, 0.06);
      expect(st.part).toBe(t.part[s]);
      expect(st.breeze).toBe(t.breeze[s]);
      expect(st.fall).toBeCloseTo(t.fall[s] / 45, 12);
      expect(st.mist).toBeCloseTo(t.mist[s] / 0.06, 12);
    }
    expect(blend(t.part, [0.5, 0.5, 0, 0])).toBeCloseTo(0.45, 12); // entre printemps (0,6) et été (0,3)
    expect(dominant([0.1, 0.2, 0.6, 0.1])).toBe(2);
    expect(t.part).toEqual([0.6, 0.3, 1.0, 1.0]);
    expect(t.breeze).toEqual([1.0, 0.7, 1.3, 0.5]);
    expect(t.fall).toEqual([30, 18, 45, 22]);
  });

  it('la saison fait partie de l’état et du lien (aller-retour)', () => {
    let s = newGarden(0x9f3a12c4, 0);
    s = setSeason(s, 3);
    expect(s.saison).toBe(3);
    expect(encodeFragment(s)).toBe('#g=1.9f3a12c4.3.');
    expect(decodeFragment('#g=1.9f3a12c4.3.')).toEqual({ ok: true, state: s });
    expect(setSeason(s, 7)).toBe(s); // saison invalide : état inchangé
  });
});

describe('export PNG : nom et taille (SPEC §8)', () => {
  it('nom jardin-encre-<graine>-<saison>.png, saison en toutes lettres dans la langue', () => {
    expect(exportFileName(0x9f3a12c4, 2, 'fr')).toBe('jardin-encre-9f3a12c4-automne.png');
    expect(exportFileName(0x9f3a12c4, 2, 'en')).toBe('jardin-encre-9f3a12c4-autumn.png');
    expect(exportFileName(0xa, 1, 'fr')).toBe('jardin-encre-0000000a-été.png');
    expect(seasonName(3, 'fr')).toBe('hiver');
    expect(seasonName(0, 'en')).toBe('spring');
  });

  it('3 840 x 2 160, réduit à la limite de texture du GPU (largeur = limite, hauteur = largeur x 9/16)', () => {
    expect(exportSize(16384)).toEqual({ w: EXPORT_W, h: EXPORT_H });
    expect(exportSize(3840)).toEqual({ w: 3840, h: 2160 });
    expect(exportSize(4096)).toEqual({ w: 3840, h: 2160 });
    expect(exportSize(2048)).toEqual({ w: 2048, h: 1152 });
    expect(exportSize(0)).toEqual({ w: 16, h: 9 });
    expect(exportSize(Number.NaN)).toEqual({ w: 16, h: 9 });
  });
});

describe('interface FR + EN', () => {
  it('mêmes clés dans les deux dictionnaires, aucune valeur vide', () => {
    expect(Object.keys(FR).sort()).toEqual(Object.keys(EN).sort());
    for (const [k, v] of [...Object.entries(FR), ...Object.entries(EN)]) expect(v.length, k).toBeGreaterThan(0);
  });
});
