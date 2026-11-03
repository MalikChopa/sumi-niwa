// Correction de l'audit J6 : parties pures des correctifs (les parties DOM, GPU et audio sont dans tests/e2e/audit1.spec.ts).
import { describe, expect, it } from 'vitest';
import { rampTarget } from '../../src/core/audio-plan';

describe('point 9 : cible de la rampe de volume après l’attente de resume()', () => {
  it('son encore activé : le volume ; coupé entre-temps par un second appui : 0', () => {
    expect(rampTarget(true, 0.4)).toBe(0.4);
    expect(rampTarget(false, 0.4)).toBe(0);
    expect(rampTarget(false, 1)).toBe(0);
  });
});
