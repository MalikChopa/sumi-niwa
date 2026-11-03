// Écran d'ouverture (maquette A écran 1, SPEC §8 clé `jardin-encre.v1.accueil`, §11 « stockage bloqué ») : logique pure.
// Le message n'apparaît qu'au premier chargement sur une feuille vide ; une fois la première plantation faite il est
// mémorisé (`"1"`) et ne revient plus. Stockage bloqué : jamais d'erreur, il revient à chaque visite.
export const WELCOME_KEY = 'jardin-encre.v1.accueil';

/** Ce que le stockage local doit savoir faire (`window.localStorage` ou un faux dans les tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Le message a-t-il déjà été vu ? Stockage bloqué ou illisible : non (il revient à chaque visite). */
export function welcomeSeen(store: () => KeyValueStore): boolean {
  try {
    return store().getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

/** Mémorise « vu ». Retourne faux si le stockage est bloqué (sans lever d'exception). */
export function markWelcomeSeen(store: () => KeyValueStore): boolean {
  try {
    store().setItem(WELCOME_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Afficher le message ? Oui seulement : jamais vu, feuille vide (aucune plante, donc pas de lien qui ouvre un jardin),
 * pas une recréation après perte du device, et en mode test seulement avec `&welcome=1`.
 */
export function shouldShowWelcome(o: { seen: boolean; plantCount: number; recreated: boolean; testMode: boolean; welcomeParam: boolean }): boolean {
  if (o.seen || o.plantCount > 0 || o.recreated) return false;
  if (o.testMode && !o.welcomeParam) return false;
  return true;
}
