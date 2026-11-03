// Raccourcis clavier (SPEC §7.1 molette, §7.2 clavier). Actifs seulement quand le focus est sur la feuille ou la barre
// (WCAG 2.1.4) : jamais dans un champ de saisie ni dans une boîte de dialogue.
// J4 : S / Maj+S, P, L, N, molette. J5 : Espace (pause), F (plein écran), flèches (pinceau clavier, Maj = 80 uf),
// Entrée (planter au pinceau), 1 à 5 (espèce), V (rafale), M (son), + / − (volume), C (mode contemplatif). Q est au J3
// (quality-runtime), Échap est natif (boîtes de dialogue, plein écran) ou géré par le mode contemplatif.
//
// Conflit Espace / Entrée (audit, SPEC §7.2) : sur un bouton de la barre, Espace et Entrée déclenchent le bouton
// (comportement natif, on n'y touche pas) ; ils n'agissent sur la feuille (pause, planter) que si la feuille a le
// focus (la scène `#stage`, ou la page quand rien n'est ciblé). Les flèches suivent la même règle (sur le curseur de
// volume, elles règlent le volume).
import { WHEEL_LOCK_MS, WHEEL_STEP } from '../constants';

export interface ShortcutActions {
  season(dir: 1 | -1): void;
  keep(): void;
  link(): void;
  newSheet(): void;
  pause(): void;
  fullscreen(): void;
  species(index: 0 | 1 | 2 | 3 | 4): void;
  gust(): void;
  sound(): void;
  volume(dir: 1 | -1): void;
  contemplative(): void;
  /** pinceau clavier : déplacement en uf (dx, dy) */
  brush(dx: number, dy: number): void;
  plantAtBrush(): void;
}

/** Le focus est-il sur la feuille (corps de page, scène) ou sur la barre ? */
export function focusOnSheetOrBar(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) return true;
  if (el.closest?.('dialog')) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return false;
  if (el.tagName === 'INPUT') return (el as HTMLInputElement).type === 'range' && el.closest('#bar') !== null; // le curseur de volume laisse passer les lettres
  return el.closest?.('#bar') !== null || el.closest?.('#stage') !== null;
}

/** La feuille a-t-elle le focus ? (Espace, Entrée, flèches : jamais sur un bouton de la barre.) */
export function focusOnSheet(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) return true;
  if (el.closest?.('dialog')) return false;
  return el.id === 'stage' || el.closest?.('#stage') !== null;
}

const DIGIT_CODES: Record<string, 0 | 1 | 2 | 3 | 4> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3, Numpad5: 4 };

export function attachShortcuts(a: ShortcutActions): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!focusOnSheetOrBar(e.target)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const sheet = focusOnSheet(e.target);
    // Répétition de touche : seulement les flèches et le volume.
    const repeatable = k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' || k === '+' || k === '-' || k === '=';
    if (e.repeat && !repeatable) return;
    // Chiffres : par la touche physique (`code`), car sur un clavier AZERTY la rangée du haut donne & é " ' ( sans Maj.
    const digit = DIGIT_CODES[e.code];
    if (digit !== undefined && !e.shiftKey) {
      a.species(digit);
      return;
    }
    if (k === ' ' || k === 'Spacebar') {
      if (!sheet) return; // sur un bouton : comportement natif
      e.preventDefault();
      a.pause();
    } else if (k === 'Enter') {
      if (!sheet) return;
      e.preventDefault();
      a.plantAtBrush();
    } else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      if (!sheet) return; // sur le curseur de volume ou un bouton : natif
      e.preventDefault();
      const step = e.shiftKey ? 80 : 20;
      a.brush(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
    } else if (k === 's') a.season(e.shiftKey ? -1 : 1);
    else if (k === 'p') a.keep();
    else if (k === 'l') a.link();
    else if (k === 'n') a.newSheet();
    else if (k === 'f') a.fullscreen();
    else if (k === 'v') a.gust();
    else if (k === 'm') a.sound();
    else if (k === 'c') a.contemplative();
    else if (k === '+' || k === '=') a.volume(1);
    else if (k === '-') a.volume(-1);
  };

  // Molette : le cumul de deltaY atteint WHEEL_STEP → une saison (vers le bas = suivante) ; les crans suivants du même
  // geste sont ignorés pendant WHEEL_LOCK_MS (un coup de molette libre en envoie des dizaines).
  let acc = 0;
  let lockedUntil = 0;
  let lastWheel = 0;
  const onWheel = (e: WheelEvent): void => {
    if (!focusOnSheetOrBar(e.target) || e.ctrlKey) return; // Ctrl + molette = zoom du navigateur
    e.preventDefault();
    const now = performance.now();
    if (now < lockedUntil) {
      lockedUntil = Math.max(lockedUntil, now + 120); // le geste continue : le verrou reste jusqu'à son arrêt
      return;
    }
    if (now - lastWheel > 400) acc = 0;
    lastWheel = now;
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1; // lignes, pages → pixels
    acc += e.deltaY * unit;
    if (Math.abs(acc) >= WHEEL_STEP) {
      a.season(acc > 0 ? 1 : -1);
      acc = 0;
      lockedUntil = now + WHEEL_LOCK_MS;
    }
  };

  window.addEventListener('keydown', onKey);
  window.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('wheel', onWheel);
  };
}
