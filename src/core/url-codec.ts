// Fragment d'URL `#g=<version>.<graine>.<saison>.<plantes>` (SPEC §8). Au J2 : lecture et écriture du format
// seulement ; l'écriture dans la barre d'adresse (`replaceState`) et la repousse accélérée arrivent au J4.
import { MAX_PLANTS } from '../constants';
import type { GardenState, PlantEvent } from './state';
import type { SpeciesCode } from '../constants';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 3 octets gros-boutistes par plante : v = (x << 13) | (y << 3) | espece → 4 caractères base64url. */
export function encodePlants(plantes: readonly PlantEvent[]): string {
  let out = '';
  for (const p of plantes) {
    const v = (p.x << 13) | (p.y << 3) | p.espece;
    out += B64[(v >>> 18) & 63]! + B64[(v >>> 12) & 63]! + B64[(v >>> 6) & 63]! + B64[v & 63]!;
  }
  return out;
}

export function encodeFragment(s: GardenState): string {
  return `#g=1.${(s.graine >>> 0).toString(16).padStart(8, '0')}.${s.saison}.${encodePlants(s.plantes)}`;
}

export type DecodeResult =
  | { ok: true; state: GardenState }
  | { ok: false; reason: 'absent' | 'illisible' | 'version-future' };

/** Lit un fragment. Tout champ invalide refuse le lien entier (jamais de jardin partiel, SPEC §8). */
export function decodeFragment(hash: string): DecodeResult {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!h.startsWith('g=')) return { ok: false, reason: 'absent' };
  const parts = h.slice(2).split('.');
  if (parts.length !== 4) return { ok: false, reason: 'illisible' };
  const [ver, seed, season, plants] = parts as [string, string, string, string];
  if (!/^\d+$/.test(ver)) return { ok: false, reason: 'illisible' };
  if (ver !== '1') return { ok: false, reason: Number(ver) > 1 ? 'version-future' : 'illisible' };
  if (!/^[0-9a-f]{8}$/.test(seed)) return { ok: false, reason: 'illisible' };
  if (!/^[0-3]$/.test(season)) return { ok: false, reason: 'illisible' };
  if (plants.length % 4 !== 0 || plants.length / 4 > MAX_PLANTS) return { ok: false, reason: 'illisible' };
  const plantes: PlantEvent[] = [];
  for (let i = 0; i < plants.length; i += 4) {
    let v = 0;
    for (let k = 0; k < 4; k++) {
      const c = B64.indexOf(plants[i + k]!);
      if (c < 0) return { ok: false, reason: 'illisible' };
      v = (v << 6) | c;
    }
    const x = v >>> 13;
    const y = (v >>> 3) & 1023;
    const espece = v & 7;
    if (x > 1599 || y > 899 || espece > 4) return { ok: false, reason: 'illisible' };
    plantes.push({ x, y, espece: espece as SpeciesCode });
  }
  return {
    ok: true,
    state: { version: 1, graine: parseInt(seed, 16) >>> 0, saison: Number(season) as 0 | 1 | 2 | 3, plantes },
  };
}
