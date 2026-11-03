// PRNG : vecteurs connus calculés par une implémentation de référence indépendante en BigInt
// (algorithme sfc32 de PractRand, état de 4 mots de 32 bits ; finaliseur splitmix32), comparés à src/core/prng.
import { describe, expect, it } from 'vitest';
import { makeRng, mix32, plantSeedWords, sfc32u, splitmix32 } from '../../src/core/prng';

const MASK = 0xffffffffn;
const rotl = (x: bigint, k: bigint) => ((x << k) | (x >> (32n - k))) & MASK;

function refSfc32(a0: number, b0: number, c0: number, d0: number) {
  let a = BigInt(a0 >>> 0);
  let b = BigInt(b0 >>> 0);
  let c = BigInt(c0 >>> 0);
  let d = BigInt(d0 >>> 0);
  return () => {
    const t = (a + b + d) & MASK;
    d = (d + 1n) & MASK;
    a = b ^ (b >> 9n);
    b = (c + ((c << 3n) & MASK)) & MASK;
    c = (rotl(c, 21n) + t) & MASK;
    return Number(t);
  };
}

function refMix32(x0: number): number {
  let t = BigInt(x0 >>> 0);
  t = t ^ (t >> 16n);
  t = (t * 0x21f0aaadn) & MASK;
  t = t ^ (t >> 15n);
  t = (t * 0x735a2d97n) & MASK;
  t = t ^ (t >> 15n);
  return Number(t);
}

describe('prng', () => {
  it('sfc32 : 1 000 sorties identiques à la référence BigInt, sur 4 états initiaux', () => {
    const seeds: [number, number, number, number][] = [
      [0, 0, 0, 0],
      [1, 2, 3, 4],
      [0xdeadbeef, 0xcafebabe, 0x12345678, 0x9abcdef0],
      [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
    ];
    for (const s of seeds) {
      const a = sfc32u(...s);
      const b = refSfc32(...s);
      for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
    }
  });

  it('sfc32 : premiers vecteurs pour (1, 2, 3, 4) figés', () => {
    // Valeurs produites par la référence BigInt ci-dessus (et non recopiées d'une source externe).
    const b = refSfc32(1, 2, 3, 4);
    const ref = [b(), b(), b(), b()];
    const a = sfc32u(1, 2, 3, 4);
    expect([a(), a(), a(), a()]).toEqual(ref);
    // Premier tirage : t = a + b + d = 1 + 2 + 4 = 7 (calcul à la main).
    expect(ref[0]).toBe(7);
  });

  it('mix32 identique à la référence BigInt sur 10 000 entrées', () => {
    const sm = splitmix32(42);
    for (let i = 0; i < 10000; i++) {
      const x = sm();
      expect(mix32(x)).toBe(refMix32(x));
    }
    expect(mix32(0)).toBe(0); // point fixe connu du finaliseur
  });

  it('flux de plante : mêmes entrées, même suite ; une entrée change, la suite change', () => {
    const w1 = plantSeedWords(0x9f3a12c4, 0, 500, 792, 0);
    expect(plantSeedWords(0x9f3a12c4, 0, 500, 792, 0)).toEqual(w1);
    const variants = [
      plantSeedWords(0x9f3a12c5, 0, 500, 792, 0),
      plantSeedWords(0x9f3a12c4, 1, 500, 792, 0),
      plantSeedWords(0x9f3a12c4, 0, 501, 792, 0),
      plantSeedWords(0x9f3a12c4, 0, 500, 793, 0),
      plantSeedWords(0x9f3a12c4, 0, 500, 792, 1),
    ];
    for (const v of variants) expect(v).not.toEqual(w1);
  });

  it('tirages bornés : next dans [0, 1[, int dans les bornes', () => {
    const r = makeRng(1, 2, 3, 4);
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v >= 0 && v < 1).toBe(true);
      const k = r.int(3, 5);
      expect(k >= 3 && k <= 5 && Number.isInteger(k)).toBe(true);
    }
  });
});
