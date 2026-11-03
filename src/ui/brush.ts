// Pinceau clavier (SPEC §7.2) : un anneau sumi de 22 px montre où Entrée plantera. Flèches : 20 uf (Maj : 80 uf).
// Visible seulement tant que la feuille a le focus clavier et que le pinceau a bougé ; masqué dès que la souris reprend la main.
import { SHEET_H, SHEET_W } from '../constants';
import { sheetToClient } from '../input/pointer';

const CSS = `
#brush{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid #1E2430;box-sizing:border-box;pointer-events:none;z-index:4;opacity:0;transition:opacity .25s ease;background:rgba(243,236,221,.55)}
#brush::after{content:"";position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:#1E2430}
#brush.on{opacity:1}
@media (prefers-reduced-motion:reduce){#brush{transition:none}}
`;

export interface Brush {
  readonly x: number;
  readonly y: number;
  move(dx: number, dy: number): void;
  hide(): void;
  readonly visible: boolean;
  dispose(): void;
}

export function createBrush(): Brush {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'brush';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  let x = SHEET_W / 2;
  let y = 760;
  let visible = false;
  const place = (): void => {
    const c = sheetToClient(x, y);
    el.style.transform = `translate(${c.x}px, ${c.y}px)`;
  };
  place();
  window.addEventListener('resize', place);
  return {
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    get visible() {
      return visible;
    },
    move(dx, dy) {
      x = Math.min(SHEET_W - 1, Math.max(0, x + dx));
      y = Math.min(SHEET_H - 1, Math.max(0, y + dy));
      place();
      el.classList.add('on');
      el.dataset.visible = '1';
      visible = true;
    },
    hide() {
      el.classList.remove('on');
      delete el.dataset.visible;
      visible = false;
    },
    dispose() {
      window.removeEventListener('resize', place);
      el.remove();
      style.remove();
    },
  };
}
