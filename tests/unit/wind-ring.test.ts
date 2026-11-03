// Indicateur du vent sous le curseur (maquette A écran 2) : apparition, estompage, cas où il est masqué.
import { describe, expect, it } from 'vitest';
import { ringAllowed, ringOpacity, WIND_RING } from '../../src/core/wind-ring';

describe('indicateur du vent', () => {
  it('dessin de la maquette : r 11 (.55, 1,5), point 2,4 (.7), anneau 36 (.12, 1, « 3 6 »)', () => {
    expect(WIND_RING.inner).toEqual({ r: 11, opacity: 0.55, width: 1.5 });
    expect(WIND_RING.dot).toEqual({ r: 2.4, opacity: 0.7 });
    expect(WIND_RING.outer).toEqual({ r: 36, opacity: 0.12, width: 1, dash: '3 6' });
  });

  it('visible pendant le mouvement, fondu lent d’environ 600 ms après l’immobilité, puis absent', () => {
    expect(ringOpacity(1000, 1000, false)).toBe(1);
    expect(ringOpacity(1000 + WIND_RING.holdMs, 1000, false)).toBe(1);
    const mid = ringOpacity(1000 + WIND_RING.holdMs + WIND_RING.fadeMs / 2, 1000, false);
    expect(mid).toBeCloseTo(0.5, 6);
    expect(ringOpacity(1000 + WIND_RING.holdMs + WIND_RING.fadeMs, 1000, false)).toBe(0);
    expect(ringOpacity(1e6, 1000, false)).toBe(0);
    expect(WIND_RING.fadeMs).toBe(600);
    // décroissant, jamais de saut
    let prev = 1;
    for (let t = 0; t <= 1200; t += 16) {
      const o = ringOpacity(1000 + t, 1000, false);
      expect(o).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - o).toBeLessThan(0.05);
      prev = o;
    }
  });

  it('jamais bougé : absent', () => {
    expect(ringOpacity(500, 0, false)).toBe(0);
    expect(ringOpacity(500, -1, false)).toBe(0);
  });

  it('mouvement réduit : affiché ou masqué net, jamais de valeur intermédiaire', () => {
    for (let t = 0; t <= 2000; t += 10) expect([0, 1]).toContain(ringOpacity(1000 + t, 1000, true));
    expect(ringOpacity(1000 + WIND_RING.holdMs, 1000, true)).toBe(1);
    expect(ringOpacity(1000 + WIND_RING.holdMs + 1, 1000, true)).toBe(0);
  });

  it('masqué au toucher, pendant un appui, en mode contemplatif et derrière une boîte de dialogue', () => {
    const ok = { pointerType: 'mouse', pressed: false, contemplative: false, dialogOpen: false };
    expect(ringAllowed(ok)).toBe(true);
    expect(ringAllowed({ ...ok, pointerType: 'pen' })).toBe(true);
    expect(ringAllowed({ ...ok, pointerType: 'touch' })).toBe(false);
    expect(ringAllowed({ ...ok, pressed: true })).toBe(false);
    expect(ringAllowed({ ...ok, contemplative: true })).toBe(false);
    expect(ringAllowed({ ...ok, dialogOpen: true })).toBe(false);
  });
});
