// Souris et tactile (SPEC §7.1, part du J2) : appui = graine d'encre à l'image suivante ; clic court = planter
// l'espèce courante ; maintien = jauge, la durée choisit l'espèce, le relâchement plante et la mémorise ;
// déplacement > 12 px pendant l'appui = pas de plantation, le geste devient du vent ; déplacement sans bouton =
// vent (J3, F-5 : impulsions du curseur, SPEC §6). Seul le premier pointeur compte.
import { HOLD_CANCEL_PX, HOLD_START_MS, SHEET_H, SHEET_W, type SpeciesCode } from '../constants';
import { holdProgress, speciesForHold } from '../core/hold';
import type { Garden } from '../app/garden';
import { createGauge } from '../ui/gauge';

/** Pixels CSS de la fenêtre → unités feuille (ajustement « cover », comme le papier et l'encre). */
export function clientToSheet(cx: number, cy: number): { x: number; y: number } {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const scale = Math.max(w / SHEET_W, h / SHEET_H);
  return { x: (cx - w / 2) / scale + SHEET_W / 2, y: (cy - h / 2) / scale + SHEET_H / 2 };
}

/** Unités feuille → pixels CSS de la fenêtre (inverse de `clientToSheet`). */
export function sheetToClient(x: number, y: number): { x: number; y: number } {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const scale = Math.max(w / SHEET_W, h / SHEET_H);
  return { x: (x - SHEET_W / 2) * scale + w / 2, y: (y - SHEET_H / 2) * scale + h / 2 };
}

export interface PointerInput {
  /** Espèce courante (J5 : modifiable par la touche 1–5, le bouton Planter et le pinceau clavier). */
  current: SpeciesCode;
  dispose(): void;
}

export function attachPointer(target: HTMLElement, garden: Garden, hooks: { onFull?: () => void; initial?: SpeciesCode } = {}): PointerInput {
  const gauge = createGauge();
  let current: SpeciesCode = hooks.initial ?? 0; // espèce courante au départ : bambou (SPEC §7.1)
  let press: { id: number; x: number; y: number; stamp: number; raf: number } | null = null;
  target.style.touchAction = 'none';

  const tick = () => {
    if (!press) return;
    const held = performance.now() - press.stamp;
    if (held >= HOLD_START_MS) {
      if (!gauge.visible) gauge.show(press.x, press.y);
      gauge.update(speciesForHold(held, current), holdProgress(held));
    }
    press.raf = requestAnimationFrame(tick);
  };

  const end = (cancelled: boolean, e?: PointerEvent) => {
    if (!press) return;
    cancelAnimationFrame(press.raf);
    gauge.hide();
    const p = press;
    press = null;
    if (cancelled || !e) {
      garden.releaseSeed(true);
      return;
    }
    const held = e.timeStamp - p.stamp;
    const species = speciesForHold(held, current);
    if (held >= HOLD_START_MS) current = species; // le maintien choisit et mémorise l'espèce
    const s = clientToSheet(p.x, p.y);
    const r = garden.plantAt(s.x, s.y, species, e.timeStamp);
    garden.releaseSeed(!r.ok);
  };

  const onDown = (e: PointerEvent) => {
    if (press || !e.isPrimary || e.button !== 0) return; // premier pointeur seulement, bouton principal
    if (garden.fading) return; // la feuille est en train de s'effacer (nouvelle feuille)
    if (garden.full) {
      hooks.onFull?.(); // 160 plantes : pas de graine, message « La feuille est pleine » (SPEC §11)
      return;
    }
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, stamp: e.timeStamp, raf: 0 };
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* capture refusée : sans conséquence */
    }
    const s = clientToSheet(e.clientX, e.clientY);
    garden.showSeed(s.x, s.y, e.timeStamp);
    press.raf = requestAnimationFrame(tick);
  };
  const onMove = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    const wind = garden.effects?.wind;
    if (!press) {
      if (wind) {
        const s = clientToSheet(e.clientX, e.clientY);
        wind.move(s.x, s.y, e.timeStamp);
      }
      return;
    }
    if (e.pointerId !== press.id) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > HOLD_CANCEL_PX) end(true);
  };
  const onUp = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    end(false, e);
  };
  const onCancel = (e: PointerEvent) => {
    if (press && e.pointerId === press.id) end(true);
  };

  // Appui interrompu par une perte de focus de la fenêtre (alt-tab) : le `pointerup` n'arrivera jamais ; sans cela la plantation
  // suivante serait ignorée ou jugée d'après une durée de maintien fausse (audit J6 point 11).
  const onBlur = () => end(true);
  window.addEventListener('blur', onBlur);
  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onCancel);
  return {
    get current() {
      return current;
    },
    set current(v: SpeciesCode) {
      current = v;
    },
    dispose() {
      end(true); // un appui en cours (jauge ouverte) est abandonné, la graine disparaît
      window.removeEventListener('blur', onBlur);
      gauge.dispose();
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
    },
  };
}
