// Écran d'ouverture (SPEC §8, §11) : affiché / mémorisé / lien non vide / stockage bloqué, sans navigateur.
import { describe, expect, it } from 'vitest';
import { markWelcomeSeen, shouldShowWelcome, WELCOME_KEY, welcomeSeen, type KeyValueStore } from '../../src/core/welcome';

const memory = (): KeyValueStore & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => (k in data ? data[k]! : null), setItem: (k, v) => void (data[k] = v) };
};
const blocked = (): KeyValueStore => {
  throw new Error('SecurityError');
};
const base = { seen: false, plantCount: 0, recreated: false, testMode: false, welcomeParam: false };

describe('écran d’ouverture', () => {
  it('clé et valeur de la SPEC : jardin-encre.v1.accueil = "1"', () => {
    expect(WELCOME_KEY).toBe('jardin-encre.v1.accueil');
    const s = memory();
    expect(markWelcomeSeen(() => s)).toBe(true);
    expect(s.data).toEqual({ 'jardin-encre.v1.accueil': '1' });
  });

  it('affiché au premier chargement sur une feuille vide ; mémorisé, il ne revient plus', () => {
    const s = memory();
    expect(shouldShowWelcome({ ...base, seen: welcomeSeen(() => s) })).toBe(true);
    markWelcomeSeen(() => s);
    expect(welcomeSeen(() => s)).toBe(true);
    expect(shouldShowWelcome({ ...base, seen: welcomeSeen(() => s) })).toBe(false);
  });

  it('un lien qui ouvre un jardin non vide : pas de message ; pas non plus après une recréation du device', () => {
    expect(shouldShowWelcome({ ...base, plantCount: 1 })).toBe(false);
    expect(shouldShowWelcome({ ...base, plantCount: 12 })).toBe(false);
    expect(shouldShowWelcome({ ...base, recreated: true })).toBe(false);
  });

  it('stockage bloqué : lecture = pas vu, écriture sans exception, donc le message revient à chaque visite', () => {
    expect(welcomeSeen(blocked)).toBe(false);
    expect(markWelcomeSeen(blocked)).toBe(false);
    expect(shouldShowWelcome({ ...base, seen: welcomeSeen(blocked) })).toBe(true);
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(welcomeSeen(() => throwing)).toBe(false);
    expect(markWelcomeSeen(() => throwing)).toBe(false);
  });

  it('mode test : masqué par défaut, affiché avec &welcome=1', () => {
    expect(shouldShowWelcome({ ...base, testMode: true })).toBe(false);
    expect(shouldShowWelcome({ ...base, testMode: true, welcomeParam: true })).toBe(true);
    expect(shouldShowWelcome({ ...base, testMode: true, welcomeParam: true, seen: true })).toBe(false);
  });
});
