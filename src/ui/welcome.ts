// Écran d'ouverture (maquette A écran 1) : une graine d'encre au centre de la feuille (800, 430 uf) qui pulse doucement
// (deux anneaux, 3,2 s, coupé en mouvement réduit) et, dessous, « Clique pour planter » / « Click to plant » (langue de
// l'interface en grand, l'autre en petit, comme la maquette). Ne capte aucun clic (pointer-events:none), ne prend pas le
// focus, annoncé poliment (role=status) puis retiré de l'arbre d'accessibilité quand il disparaît.
import { SHEET_H, SHEET_W } from '../constants';
import { sheetToClient } from '../input/pointer';
import { getLang, onLang } from './i18n';

const CSS = `
#welcome{position:fixed;left:0;top:0;width:0;height:0;z-index:3;pointer-events:none;opacity:0;transition:opacity .8s ease;font-family:Georgia,"Times New Roman",serif;font-style:italic;color:#1E2430}
#welcome.on{opacity:1}
#welcome[hidden]{display:none}
#welcome svg{position:absolute;left:calc(var(--k)*-40px);top:calc(var(--k)*-40px);width:calc(var(--k)*80px);height:calc(var(--k)*80px);overflow:visible}
#welcome .ring{transform-box:fill-box;transform-origin:center;animation:wpulse 3.2s ease-out infinite}
#welcome .ring.b{animation-delay:1.6s}
@keyframes wpulse{0%{transform:scale(1);opacity:.5}100%{transform:scale(3.4);opacity:0}}
#welcome .t1,#welcome .t2{position:absolute;left:-200px;width:400px;text-align:center;white-space:nowrap;color:rgba(30,36,48,.72)}
#welcome .t1{top:calc(var(--k)*52px);font-size:calc(var(--k)*21px);letter-spacing:.14em}
#welcome .t2{top:calc(var(--k)*86px);font-size:calc(var(--k)*15px);letter-spacing:.18em}
@media (prefers-reduced-motion:reduce){#welcome{transition:none}#welcome .ring{animation:none;opacity:.25}}
`;

const TEXT = { fr: 'Clique pour planter', en: 'Click to plant' } as const;

export interface Welcome {
  /** Retire le message (fondu), définitivement pour cette session. */
  dismiss(): void;
  readonly visible: boolean;
  dispose(): void;
}

export function showWelcome(): Welcome {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'welcome';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-40 -40 80 80');
  svg.setAttribute('aria-hidden', 'true');
  const mkc = (cls: string): SVGCircleElement => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('r', '8');
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke', '#1E2430');
    c.setAttribute('stroke-opacity', '.5');
    c.setAttribute('stroke-width', '1.4');
    return c;
  };
  const halo = document.createElementNS(NS, 'circle');
  halo.setAttribute('r', '20');
  halo.setAttribute('fill', '#1E2430');
  halo.setAttribute('fill-opacity', '.08');
  const seed = document.createElementNS(NS, 'ellipse');
  seed.setAttribute('rx', '8');
  seed.setAttribute('ry', '9.5');
  seed.setAttribute('fill', '#1E2430');
  seed.setAttribute('fill-opacity', '.9');
  const curl = document.createElementNS(NS, 'path');
  curl.setAttribute('d', 'M6,-9 Q12,-15 10,-22');
  curl.setAttribute('fill', 'none');
  curl.setAttribute('stroke', '#1E2430');
  curl.setAttribute('stroke-width', '2');
  curl.setAttribute('stroke-linecap', 'round');
  curl.setAttribute('stroke-opacity', '.8');
  svg.append(mkc('ring'), mkc('ring b'), halo, seed, curl);
  const t1 = document.createElement('div');
  t1.className = 't1';
  const t2 = document.createElement('div');
  t2.className = 't2';
  t2.setAttribute('aria-hidden', 'true'); // la langue de l'interface est annoncée ; l'autre est décorative
  root.append(svg, t1, t2);
  document.body.appendChild(root);

  const place = (): void => {
    const c = sheetToClient(SHEET_W / 2, 430);
    const k = Math.max(window.innerWidth / SHEET_W, window.innerHeight / SHEET_H);
    root.style.setProperty('--k', String(k));
    root.style.transform = `translate(${c.x}px, ${c.y}px)`;
  };
  const texts = (): void => {
    const l = getLang();
    t1.textContent = TEXT[l];
    t2.textContent = TEXT[l === 'fr' ? 'en' : 'fr'];
  };
  place();
  window.addEventListener('resize', place);
  const offLang = onLang(texts);
  let visible = true;
  // Le texte arrive après la première image : un lecteur d'écran l'annonce (une région vive n'annonce que ses changements).
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      texts();
      root.classList.add('on');
    }),
  );
  let gone = 0;
  return {
    get visible() {
      return visible;
    },
    dismiss() {
      if (!visible) return;
      visible = false;
      root.classList.remove('on');
      root.setAttribute('aria-hidden', 'true');
      gone = window.setTimeout(() => (root.hidden = true), 900);
    },
    dispose() {
      window.clearTimeout(gone);
      window.removeEventListener('resize', place);
      offLang();
      root.remove();
      style.remove();
      visible = false;
    },
  };
}
