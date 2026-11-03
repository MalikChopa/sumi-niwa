// FNV-1a 32 bits sur les tampons générés (SPEC §8 : `gardenHash()`, ARCHITECTURE 12.1 : `hashPlante()`).
// Les flottants sont lus par leurs bits IEEE 754 (float32) et passés octet par octet en petit-boutiste
// explicite : le résultat ne dépend pas de l'ordre des octets de la machine.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export class Fnv1a {
  private h = FNV_OFFSET;

  byte(b: number): void {
    this.h = Math.imul(this.h ^ (b & 255), FNV_PRIME) >>> 0;
  }

  u32(v: number): void {
    const x = v >>> 0;
    this.byte(x);
    this.byte(x >>> 8);
    this.byte(x >>> 16);
    this.byte(x >>> 24);
  }

  /** Flottant pris en float32 (les tampons sont des Float32Array). */
  f32(v: number): void {
    f32[0] = v;
    this.u32(u32[0] as number);
  }

  floats(a: Float32Array, count: number): void {
    for (let i = 0; i < count; i++) this.f32(a[i] as number);
  }

  u16s(a: Uint16Array, count: number): void {
    for (let i = 0; i < count; i++) {
      const v = a[i] as number;
      this.byte(v);
      this.byte(v >>> 8);
    }
  }

  value(): number {
    return this.h >>> 0;
  }
}

export function hex8(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0');
}
