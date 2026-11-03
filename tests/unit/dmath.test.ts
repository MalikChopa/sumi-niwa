// dmath : écart avec Math < 1e-9 sur 10 000 angles (ARCHITECTURE 12.1). `Math.sin` & co. ne servent qu'ici,
// dans le test, comme référence (jamais dans src/core).
import { describe, expect, it } from 'vitest';
import { atan, atan2, cos, sin } from '../../src/core/dmath';
import { makeRng } from '../../src/core/prng';

const TOL = 1e-9;

describe('dmath', () => {
  it('sin et cos : écart < 1e-9 sur 10 000 angles dans [−20π, 20π]', () => {
    const r = makeRng(7, 11, 13, 17);
    let worst = 0;
    for (let i = 0; i < 10000; i++) {
      const a = r.range(-20 * Math.PI, 20 * Math.PI);
      worst = Math.max(worst, Math.abs(sin(a) - Math.sin(a)), Math.abs(cos(a) - Math.cos(a)));
    }
    console.info(`[dmath] pire écart sin/cos : ${worst.toExponential(2)}`);
    expect(worst).toBeLessThan(TOL);
  });

  it('valeurs particulières', () => {
    expect(sin(0)).toBe(0);
    expect(cos(0)).toBe(1);
    expect(Math.abs(sin(Math.PI / 2) - 1)).toBeLessThan(TOL);
    expect(Math.abs(cos(Math.PI))).toBeCloseTo(1, 12);
  });

  it('atan et atan2 : écart < 1e-9 sur 10 000 points', () => {
    const r = makeRng(1, 3, 5, 7);
    let worst = 0;
    for (let i = 0; i < 10000; i++) {
      const y = r.range(-2000, 2000) * (r.chance(0.1) ? 1e-4 : 1);
      const x = r.range(-2000, 2000) * (r.chance(0.1) ? 1e-4 : 1);
      worst = Math.max(worst, Math.abs(atan2(y, x) - Math.atan2(y, x)));
      const z = r.range(-50, 50);
      worst = Math.max(worst, Math.abs(atan(z) - Math.atan(z)));
    }
    console.info(`[dmath] pire écart atan/atan2 : ${worst.toExponential(2)}`);
    expect(worst).toBeLessThan(TOL);
    expect(atan2(0, 0)).toBe(0);
    expect(atan2(1, 0)).toBeCloseTo(Math.PI / 2, 12);
    expect(atan2(-1, 0)).toBeCloseTo(-Math.PI / 2, 12);
    expect(atan2(0, -1)).toBeCloseTo(Math.PI, 12);
  });
});
