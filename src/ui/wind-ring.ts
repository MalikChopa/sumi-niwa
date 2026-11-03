// Indicateur du vent sous le curseur (maquette A écran 2) : un seul SVG superposé, sans coût GPU, à l'échelle de la feuille
// (unités feuille × échelle « cover »). aria-hidden, aucun clic capté (pointer-events:none), aucun focus. Jamais dans le PNG
// (le PNG est rendu hors écran, le DOM n'y figure pas). Une boucle d'images ne tourne que pendant le fondu.
import { SHEET_H, SHEET_W } from '../constants';
import { ringAllowed, ringOpacity, WIND_RING as R } from '../core/wind-ring';
import { dialogOpen } from './dialogs';

const CSS = `
#windring{position:fixed;left:0;top:0;width:calc(var(--k)*${R.outer.r * 2 + 4}px);height:calc(var(--k)*${R.outer.r * 2 + 4}px);margin:calc(var(--k)*${-(R.outer.r + 2)}px) 0 0 calc(var(--k)*${-(R.outer.r + 2)}px);pointer-events:none;z-index:2;opacity:0;overflow:visible}
`;

export interface WindRing {
  dispose(): void;
}

export function createWindRing(stage: HTMLElement): WindRing {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.id = 'windring';
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const half = R.outer.r + 2;
  svg.setAttribute('viewBox', `${-half} ${-half} ${half * 2} ${half * 2}`);
  const circle = (r: number, attrs: Record<string, string>): SVGCircleElement => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', String(r));
    for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, v);
    return c;
  };
  svg.append(
    circle(R.inner.r, { fill: 'none', stroke: '#1E2430', 'stroke-opacity': String(R.inner.opacity), 'stroke-width': String(R.inner.width) }),
    circle(R.dot.r, { fill: '#1E2430', 'fill-opacity': String(R.dot.opacity) }),
    circle(R.outer.r, { fill: 'none', stroke: '#1E2430', 'stroke-opacity': String(R.outer.opacity), 'stroke-width': String(R.outer.width), 'stroke-dasharray': R.outer.dash }),
  );
  document.body.appendChild(svg);

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let lastMove = 0;
  let raf = 0;
  let pressed = false;
  const scale = (): number => Math.max(window.innerWidth / SHEET_W, window.innerHeight / SHEET_H);

  const tick = (): void => {
    raf = 0;
    const o = ringOpacity(performance.now(), lastMove, motion.matches);
    svg.style.opacity = String(o);
    svg.dataset.visible = o > 0 ? '1' : '0';
    if (o > 0) raf = requestAnimationFrame(tick);
  };
  const hideNow = (): void => {
    lastMove = 0;
    svg.style.opacity = '0';
    svg.dataset.visible = '0';
  };
  const onMove = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    const ok = ringAllowed({ pointerType: e.pointerType, pressed, contemplative: document.documentElement.classList.contains('contemplative'), dialogOpen: dialogOpen() });
    if (!ok) {
      hideNow();
      return;
    }
    svg.style.setProperty('--k', String(scale()));
    svg.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    lastMove = performance.now();
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const onDown = (): void => {
    pressed = true;
    hideNow(); // l'appui ouvre la jauge, qui prend la place
  };
  const onUp = (): void => {
    pressed = false;
  };
  svg.style.setProperty('--k', String(scale()));
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('pointerleave', hideNow);
  return {
    dispose() {
      window.cancelAnimationFrame(raf);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('pointerleave', hideNow);
      svg.remove();
      style.remove();
    },
  };
}
