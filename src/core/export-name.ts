// Export PNG (SPEC §8) : taille et nom du fichier. TypeScript pur, testé sous Node.
import { EXPORT_H, EXPORT_W } from '../constants';

export type Lang = 'fr' | 'en';

const SEASONS: Record<Lang, readonly [string, string, string, string]> = {
  fr: ['printemps', 'été', 'automne', 'hiver'],
  en: ['spring', 'summer', 'autumn', 'winter'],
};

/** Nom de la saison « en toutes lettres dans la langue de l'interface » (SPEC §8). */
export function seasonName(saison: number, lang: Lang): string {
  return SEASONS[lang][saison === 1 ? 1 : saison === 2 ? 2 : saison === 3 ? 3 : 0];
}

/** Graine en 8 chiffres hexadécimaux minuscules. */
export function seedHex(graine: number): string {
  return (graine >>> 0).toString(16).padStart(8, '0');
}

/** `jardin-encre-<graine>-<saison>.png` (SPEC §8). */
export function exportFileName(graine: number, saison: number, lang: Lang): string {
  return `jardin-encre-${seedHex(graine)}-${seasonName(saison, lang)}.png`;
}

/**
 * Taille de l'export : 3 840 x 2 160 ; si `maxTextureDimension2D` est plus petite que 3 840, la largeur vaut cette
 * limite et la hauteur largeur x 9/16 (SPEC §8). Entiers pairs, au moins 16 px.
 */
export function exportSize(maxTexture: number): { w: number; h: number } {
  if (!(maxTexture >= EXPORT_W)) {
    const w = maxTexture >= 16 ? Math.floor(maxTexture) : 16; // limite absente ou absurde : 16 px au minimum
    return { w, h: Math.max(9, Math.round((w * 9) / 16)) };
  }
  return { w: EXPORT_W, h: EXPORT_H };
}
