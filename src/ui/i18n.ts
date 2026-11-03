// Interface en français et en anglais (décision utilisateur, SPEC §8) : langue = préférence stockée, sinon
// `navigator.language` (commence par « fr » → français), sinon anglais. Préférences dans `jardin-encre.v1.prefs`
// (même clé que la qualité) ; stockage bloqué : préférences en mémoire seulement, sans erreur visible (SPEC §11).
import type { Lang } from '../core/export-name';
import { EN, FR } from './dict';

export type { Lang };

const PREFS_KEY = 'jardin-encre.v1.prefs';
let memoryPrefs: Record<string, unknown> = {};

function readPrefs(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : {};
    return typeof v === 'object' && v !== null ? { ...memoryPrefs, ...(v as Record<string, unknown>) } : { ...memoryPrefs };
  } catch {
    return { ...memoryPrefs }; // stockage bloqué ou illisible
  }
}

export function readPref(key: string): unknown {
  return readPrefs()[key];
}

export function writePref(key: string, value: unknown): void {
  memoryPrefs = { ...memoryPrefs, [key]: value };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prev, [key]: value }));
  } catch {
    /* stockage bloqué : la préférence reste en mémoire pour la session */
  }
}

function detect(): Lang {
  const p = readPrefs().lang;
  if (p === 'fr' || p === 'en') return p;
  return (navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

let current: Lang = detect();
const listeners: ((l: Lang) => void)[] = [];

export function getLang(): Lang {
  return current;
}

export function isFrench(): boolean {
  return current === 'fr';
}

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  writePref('lang', l);
  document.documentElement.lang = l;
  for (const f of listeners) f(l);
}

export function onLang(f: (l: Lang) => void): () => void {
  listeners.push(f);
  return () => {
    const i = listeners.indexOf(f);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** À appeler au démarrage : `<html lang>` suit la langue de l'interface. */
export function initLang(): void {
  current = detect();
  document.documentElement.lang = current;
}

/** Texte de l'interface dans la langue courante ; `{clé}` est remplacé par `params`. */
export function t(key: string, params?: Record<string, string | number>): string {
  const s = (current === 'fr' ? FR : EN)[key] ?? FR[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? '')) : s;
}

