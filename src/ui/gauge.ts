// Jauge de maintien (SPEC §7.1, maquette A écran 2) : cercle de 30 px, arc d'avancement, 5 points à 44 px
// (le point de l'espèce choisie plus gros et plus foncé), nom de l'espèce dessous et une aide discrète.
// Élément DOM créé ici (index.html n'est pas touché), sans pointeur, masqué par défaut.
import { GAUGE_DOTS_RADIUS_PX, GAUGE_RADIUS_PX, type SpeciesCode } from '../constants';
import { isFrench } from './i18n';

const NAMES_FR = ['Bambou', 'Cerisier', 'Herbes', 'Pivoine', 'Roche'];
const NAMES_EN = ['Bamboo', 'Cherry branch', 'Grass', 'Peony', 'Rock'];
const HINT_FR = "maintenir pour changer d'espèce";
const HINT_EN = 'hold to change species';

const CSS = `
#gauge{position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:6;opacity:0;transition:opacity .18s ease}
#gauge.on{opacity:1}
#gauge svg{position:absolute;left:-60px;top:-60px;width:120px;height:120px;overflow:visible}
#gauge .name{position:absolute;left:-120px;width:240px;top:${GAUGE_RADIUS_PX + 36}px;text-align:center;font:italic 15px/1.2 Georgia,"Times New Roman",serif;letter-spacing:.08em;color:rgba(30,36,48,.7);text-shadow:0 0 6px #F3ECDD,0 0 3px #F3ECDD}
#gauge .hint{position:absolute;left:-140px;width:280px;top:${GAUGE_RADIUS_PX + 57}px;text-align:center;font:11px/1.2 system-ui,sans-serif;letter-spacing:.06em;color:rgba(30,36,48,.72);text-shadow:0 0 6px #F3ECDD,0 0 3px #F3ECDD}
@media (prefers-reduced-motion:reduce){#gauge{transition:none}}
`;

export interface Gauge {
  show(clientX: number, clientY: number): void;
  update(species: SpeciesCode, progress: number): void;
  hide(): void;
  /** Retire la jauge et sa feuille de style du document (audit J6 point 7) : une jauge recréée ne doublonne plus. */
  dispose(): void;
  readonly visible: boolean;
}

export function createGauge(): Gauge {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'gauge';
  root.setAttribute('aria-hidden', 'true');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-60 -60 120 120');
  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('r', String(GAUGE_RADIUS_PX));
  ring.setAttribute('fill', '#F3ECDD');
  ring.setAttribute('fill-opacity', '0.5');
  ring.setAttribute('stroke', '#1E2430');
  ring.setAttribute('stroke-opacity', '0.2');
  ring.setAttribute('stroke-width', '1.2');
  svg.appendChild(ring);
  const arc = document.createElementNS(NS, 'path');
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', '#E8A5B5');
  arc.setAttribute('stroke-width', '3.2');
  arc.setAttribute('stroke-linecap', 'round');
  svg.appendChild(arc);
  const dots: SVGCircleElement[] = [];
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', (Math.cos(a) * GAUGE_DOTS_RADIUS_PX).toFixed(1));
    c.setAttribute('cy', (Math.sin(a) * GAUGE_DOTS_RADIUS_PX).toFixed(1));
    c.setAttribute('fill', '#1E2430');
    svg.appendChild(c);
    dots.push(c);
  }
  root.appendChild(svg);
  const name = document.createElement('div');
  name.className = 'name';
  root.appendChild(name);
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = isFrench() ? HINT_FR : HINT_EN;
  root.appendChild(hint);
  document.body.appendChild(root);

  let visible = false;
  let lastSpecies = -1;
  return {
    show(x, y) {
      hint.textContent = isFrench() ? HINT_FR : HINT_EN; // la langue peut changer en cours de session (J4)
      lastSpecies = -1;
      root.style.transform = `translate(${x}px, ${y}px)`;
      root.classList.add('on');
      root.dataset.visible = '1';
      visible = true;
    },
    update(species, progress) {
      if (species !== lastSpecies) {
        lastSpecies = species;
        name.textContent = (isFrench() ? NAMES_FR : NAMES_EN)[species] ?? '';
        root.dataset.espece = String(species);
        dots.forEach((c, k) => {
          c.setAttribute('r', k === species ? '4.4' : '3');
          c.setAttribute('fill-opacity', k === species ? '0.85' : '0.28');
        });
      }
      // Arc de 0 à 360° selon l'avancement dans le palier de 500 ms.
      const p = Math.min(0.999, Math.max(0.001, progress));
      const a = -Math.PI / 2 + p * Math.PI * 2;
      const r = GAUGE_RADIUS_PX;
      const large = p > 0.5 ? 1 : 0;
      arc.setAttribute('d', `M0,${-r}A${r} ${r} 0 ${large} 1 ${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
    },
    hide() {
      root.classList.remove('on');
      delete root.dataset.visible;
      visible = false;
      lastSpecies = -1;
    },
    dispose() {
      visible = false;
      root.remove();
      style.remove();
    },
    get visible() {
      return visible;
    },
  };
}

export function speciesName(s: SpeciesCode): string {
  return (isFrench() ? NAMES_FR : NAMES_EN)[s] ?? '';
}
