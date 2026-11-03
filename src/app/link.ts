// Lien partagé (F-8, SPEC §8) : URL de partage, écriture du fragment dans la barre d'adresse (`replaceState`, au plus
// une fois par URL_WRITE_MIN_MS), entrée empilée de « Nouvelle feuille » (`pushState`), presse-papiers.
// Les paramètres de requête (?force, ?test, ?quality…) n'entrent jamais dans un lien partagé.
import { URL_WRITE_MIN_MS } from '../constants';
import { encodeFragment } from '../core/url-codec';
import type { GardenState } from '../core/state';

/** URL complète à partager : origine + chemin + fragment, sans requête. */
export function shareUrl(state: GardenState): string {
  const u = new URL(window.location.href);
  u.search = '';
  u.hash = encodeFragment(state);
  return u.toString();
}

/** Copie un texte dans le presse-papiers ; `false` si l'API est absente ou refuse (champ de secours : SPEC §11). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Écrit le fragment dans l'historique : `replaceState` limité en fréquence, `pushState` à la demande. */
export class UrlWriter {
  private last = -1e9;
  private timer = 0;

  constructor(private readonly getState: () => GardenState) {}

  /** Demande d'écriture : immédiate si la dernière date de plus de URL_WRITE_MIN_MS, sinon différée. */
  request(): void {
    const wait = URL_WRITE_MIN_MS - (performance.now() - this.last);
    if (wait <= 0) this.write();
    else if (!this.timer) {
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.write();
      }, wait);
    }
  }

  /** Écrit tout de suite l'état courant (avant un `pushState`, à la fermeture de la page). */
  flush(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.write();
  }

  /** Annule une écriture différée (navigation Précédent / Suivant : l'état vient de l'adresse). */
  cancel(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
  }

  private write(): void {
    this.last = performance.now();
    const frag = encodeFragment(this.getState());
    if (window.location.hash === frag) return;
    try {
      window.history.replaceState(window.history.state, '', frag);
    } catch {
      /* historique indisponible (iframe sandbox) : le lien se copie toujours avec « Copier le lien » */
    }
  }

  /** Empile une entrée pour un nouveau jardin (« Nouvelle feuille »). */
  push(state: GardenState): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    try {
      window.history.pushState(null, '', encodeFragment(state));
    } catch {
      /* idem */
    }
    this.last = performance.now();
  }
}
