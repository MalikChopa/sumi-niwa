// Barre d'icônes (SPEC §7.3, maquette A écran 2). Ordre de la SPEC : Planter (fait tourner l'espèce courante et affiche son
// nom), Vent (rafale), quatre points de saison, Son (+ curseur de volume au survol ou au focus), Garder ce jardin, Copier
// le lien, Nouvelle feuille, Plein écran, FR · EN. Vrais <button> avec libellés dans les deux langues, contour de focus
// de 2 px sumi, masquée après UI_HIDE_AFTER_MS d'immobilité de la souris (elle réapparaît au moindre mouvement, appui,
// touche ou focus clavier). J5 : Planter, Vent, Son, Plein écran ; masquée pour de bon pendant le mode contemplatif.
import { BAR_BG_ALPHA, SEASON_ACCENT, UI_HIDE_AFTER_MS } from '../constants';
import { getLang, onLang, setLang, t, type Lang } from './i18n';

export interface BarHandlers {
  season(index: 0 | 1 | 2 | 3): void;
  keep(): void;
  link(): void;
  newSheet(): void;
  /** « Planter » : fait tourner l'espèce courante */
  species(): void;
  gust(): void;
  sound(): void;
  volume(v: number): void;
  fullscreen(): void;
}

export interface Bar {
  readonly element: HTMLElement;
  /** Point de saison actif (la saison cible). */
  setSeason(index: number): void;
  /** Bouton « Garder » occupé (export en cours). */
  setBusy(on: boolean): void;
  /** Son activé / coupé (bouton à bascule). */
  setSound(on: boolean): void;
  /** Volume (0–1) du curseur. */
  setVolume(v: number): void;
  setFullscreen(on: boolean): void;
  /** Nom de l'espèce courante (étiquette du bouton Planter). */
  setSpecies(name: string): void;
  /** Mode contemplatif : la barre reste masquée (même si la souris bouge) jusqu'à `setSuppressed(false)`. */
  setSuppressed(on: boolean): void;
  readonly suppressed: boolean;
  /** La barre est-elle masquée (3 s d'immobilité) ? */
  readonly idle: boolean;
  /** Fait réapparaître la barre et relance le compte à rebours. */
  poke(): void;
  dispose(): void;
}

const CSS = `
#bar{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:4px;padding:6px 12px;border:1px solid rgba(30,36,48,.14);border-radius:999px;background:rgba(243,236,221,${BAR_BG_ALPHA});z-index:5;font-family:system-ui,sans-serif;transition:opacity .9s ease;max-width:calc(100vw - 16px);box-sizing:border-box}
/* masquée sauf si le focus clavier (:focus-visible) est dans la barre ; un clic de souris laisse le focus sur le bouton, sans la garder visible */
#bar.idle:not(:has(:focus-visible)){opacity:0;pointer-events:none}
/* mode contemplatif : retirée de l'arbre d'accessibilité et de l'ordre de tabulation une fois estompée */
#bar.away{opacity:0;pointer-events:none;visibility:hidden;transition:opacity .9s ease,visibility 0s linear .9s}
#bar button{width:36px;height:36px;border:0;background:none;color:rgba(30,36,48,.78);cursor:pointer;border-radius:50%;display:grid;place-items:center;padding:0;font:inherit}
#bar button:hover{background:rgba(30,36,48,.07)}
#bar button:focus-visible{outline:2px solid #1E2430;outline-offset:2px}
#bar button[aria-busy="true"]{opacity:.45;cursor:progress}
#bar svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
#bar .seasons{display:flex;gap:1px;padding:0 6px;align-items:center}
#bar .seasons button{width:26px;height:36px;border-radius:12px}
#bar .seasons i{width:9px;height:9px;border-radius:50%;border:1.4px solid rgba(30,36,48,.7);display:block;transition:background .6s ease}
#bar .seasons button[aria-pressed="true"] i{background:var(--accent);border-color:#1E2430}
#bar .sep{width:1px;height:20px;background:rgba(30,36,48,.15);margin:0 4px}
#bar .lang{display:flex;align-items:center;gap:0;font-size:11px;letter-spacing:.08em;color:rgba(30,36,48,.78)}
#bar .lang button{width:auto;height:30px;min-width:26px;padding:0 5px;border-radius:10px;font-size:11px;letter-spacing:.08em;color:rgba(30,36,48,.78)}
#bar .lang button[aria-pressed="true"]{color:#1E2430;font-weight:600;text-decoration:underline;text-underline-offset:4px}
/* Son : le curseur de volume se déplie au survol ou au focus (clavier compris : il reste atteignable au Tab, même replié) */
#bar .sound{display:flex;align-items:center}
#bar .sound input{width:0;margin:0;opacity:0;transition:width .25s ease,opacity .25s ease,margin .25s ease;accent-color:#1E2430;height:24px;cursor:pointer}
#bar .sound:hover input,#bar .sound:focus-within input{width:84px;margin:0 8px 0 2px;opacity:1}
#bar .sound input:focus-visible{outline:2px solid #1E2430;outline-offset:2px}
#bar button[aria-pressed="true"].toggle{color:#1E2430}
@media (max-width:480px){
  #bar{flex-wrap:wrap;width:calc(100vw - 16px);padding:6px 8px;border-radius:22px}
  #bar button{width:32px;height:32px}
  #bar .seasons button{width:24px;height:32px}
  #bar .sep{display:none}
}
@media (prefers-reduced-motion:reduce){#bar,#bar.away,#bar .seasons i,#bar .sound input{transition:none}}
`;

const ICONS = {
  plant: '<path d="M12 21v-9M12 13c0-4 3-6 6-6 0 4-2 6-6 6M12 15c0-3-2-5-5-5 0 3 2 5 5 5"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h7"/>',
  soundOn: '<path d="M4 10v4h4l5 4V6l-5 4zM17 9c1.5 1.5 1.5 4.5 0 6"/>',
  soundOff: '<path d="M4 10v4h4l5 4V6l-5 4zM17 10l4 4M21 10l-4 4"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  fullExit: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  keep: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  newsheet: '<path d="M6 3h9l4 4v14H6zM15 3v4h4"/>',
};

function svg(inner: string): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = inner;
  return s;
}

function iconButton(id: string, kind: keyof typeof ICONS): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = id;
  b.appendChild(svg(ICONS[kind]));
  return b;
}

export function createBar(h: BarHandlers): Bar {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'bar';
  root.setAttribute('role', 'toolbar');

  // Planter (tourne l'espèce courante) et Vent (rafale), avant les saisons (ordre de SPEC §7.3).
  const plant = iconButton('b-plant', 'plant');
  plant.addEventListener('click', () => h.species());
  const wind = iconButton('b-wind', 'wind');
  wind.addEventListener('click', () => h.gust());
  root.append(plant, wind);

  // Saisons : quatre points, clic = choisir (SPEC §7.3).
  const seasons = document.createElement('div');
  seasons.className = 'seasons';
  seasons.setAttribute('role', 'group');
  const dots: HTMLButtonElement[] = [];
  for (let i = 0; i < 4; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.season = String(i);
    b.style.setProperty('--accent', SEASON_ACCENT[i]!);
    b.appendChild(document.createElement('i'));
    b.addEventListener('click', () => h.season(i as 0 | 1 | 2 | 3));
    seasons.appendChild(b);
    dots.push(b);
  }
  root.appendChild(seasons);

  const sep1 = document.createElement('span');
  sep1.className = 'sep';
  sep1.setAttribute('aria-hidden', 'true');
  root.appendChild(sep1);

  // Son : bouton à bascule + curseur de volume (0–100, pas de 10) qui se déplie au survol ou au focus.
  const soundWrap = document.createElement('div');
  soundWrap.className = 'sound';
  const sound = iconButton('b-sound', 'soundOff');
  sound.classList.add('toggle');
  sound.addEventListener('click', () => h.sound());
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.id = 'b-volume';
  vol.min = '0';
  vol.max = '100';
  vol.step = '10';
  vol.value = '40';
  vol.addEventListener('input', () => {
    vol.setAttribute('aria-valuetext', `${vol.value} %`);
    h.volume(Number(vol.value) / 100);
  });
  soundWrap.append(sound, vol);
  root.appendChild(soundWrap);

  const keep = iconButton('b-keep', 'keep');
  keep.addEventListener('click', () => h.keep());
  const link = iconButton('b-link', 'link');
  link.addEventListener('click', () => h.link());
  const fresh = iconButton('b-new', 'newsheet');
  fresh.addEventListener('click', () => h.newSheet());
  const full = iconButton('b-full', 'full');
  full.classList.add('toggle');
  full.addEventListener('click', () => h.fullscreen());
  root.append(keep, link, fresh, full);

  const sep2 = document.createElement('span');
  sep2.className = 'sep';
  sep2.setAttribute('aria-hidden', 'true');
  root.appendChild(sep2);

  // FR · EN : deux boutons à bascule dans un groupe.
  const lang = document.createElement('div');
  lang.className = 'lang';
  lang.setAttribute('role', 'group');
  const mk = (l: Lang): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = l.toUpperCase();
    b.lang = l;
    b.dataset.lang = l;
    b.addEventListener('click', () => setLang(l));
    return b;
  };
  const bFr = mk('fr');
  const bEn = mk('en');
  const mid = document.createElement('span');
  mid.textContent = '·';
  mid.setAttribute('aria-hidden', 'true');
  lang.append(bFr, mid, bEn);
  root.appendChild(lang);

  let current = 0;
  let soundOn = false;
  let isFull = false;
  let speciesName = '';
  const refresh = (): void => {
    root.setAttribute('aria-label', t('bar'));
    seasons.setAttribute('aria-label', `${t('season_group')} : ${t(`season.${current}`).toLowerCase()}`);
    seasons.title = `${t('season_group')} ${t('season_tip')}`;
    dots.forEach((b, i) => {
      b.setAttribute('aria-label', t(`season.${i}`));
      b.title = t(`season.${i}`);
      b.setAttribute('aria-pressed', i === current ? 'true' : 'false');
    });
    plant.setAttribute('aria-label', speciesName ? t('plant_named', { name: speciesName }) : t('plant'));
    plant.title = t('plant_tip');
    wind.setAttribute('aria-label', t('wind'));
    wind.title = t('wind_tip');
    sound.setAttribute('aria-label', t('sound'));
    sound.title = t('sound_tip');
    sound.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    sound.replaceChildren(svg(soundOn ? ICONS.soundOn : ICONS.soundOff));
    vol.setAttribute('aria-label', t('volume'));
    vol.title = t('volume');
    vol.setAttribute('aria-valuetext', `${vol.value} %`);
    full.setAttribute('aria-label', t('fullscreen'));
    full.title = t('fullscreen_tip');
    full.setAttribute('aria-pressed', isFull ? 'true' : 'false');
    full.replaceChildren(svg(isFull ? ICONS.fullExit : ICONS.full));
    keep.setAttribute('aria-label', t('keep'));
    keep.title = t('keep_tip');
    link.setAttribute('aria-label', t('link'));
    link.title = t('link_tip');
    fresh.setAttribute('aria-label', t('newsheet'));
    fresh.title = t('newsheet_tip');
    lang.setAttribute('aria-label', t('lang_group'));
    bFr.setAttribute('aria-label', t('lang_fr'));
    bEn.setAttribute('aria-label', t('lang_en'));
    const l = getLang();
    bFr.setAttribute('aria-pressed', l === 'fr' ? 'true' : 'false');
    bEn.setAttribute('aria-pressed', l === 'en' ? 'true' : 'false');
  };
  refresh();
  const offLang = onLang(refresh);
  document.body.appendChild(root);

  // Masquage après UI_HIDE_AFTER_MS sans mouvement de la souris ; réapparition au moindre signe d'activité.
  let timer = 0;
  let idle = false;
  let suppressed = false;
  const hideSoon = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      idle = true;
      root.classList.add('idle');
      root.dataset.idle = '1';
      if (suppressed) root.classList.add('away');
    }, UI_HIDE_AFTER_MS);
  };
  const poke = (): void => {
    if (suppressed) return; // mode contemplatif : seul `setSuppressed(false)` la ramène
    if (idle) {
      idle = false;
      root.classList.remove('idle');
      delete root.dataset.idle;
    }
    hideSoon();
  };
  const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focusin'] as const;
  for (const e of events) window.addEventListener(e, poke, { passive: true });
  hideSoon();

  return {
    element: root,
    setSeason(i: number) {
      current = i;
      refresh();
    },
    setBusy(on: boolean) {
      if (on) keep.setAttribute('aria-busy', 'true');
      else keep.removeAttribute('aria-busy');
    },
    setSound(on: boolean) {
      soundOn = on;
      refresh();
    },
    setVolume(v: number) {
      vol.value = String(Math.round(v * 100));
      refresh();
    },
    setFullscreen(on: boolean) {
      isFull = on;
      refresh();
    },
    setSpecies(name: string) {
      speciesName = name;
      refresh();
    },
    setSuppressed(on: boolean) {
      suppressed = on;
      if (on) {
        // Les 3 s habituelles, puis retrait ; pendant ce délai la barre reste visible (SPEC F-11 : « après 3 s »).
        hideSoon();
      } else {
        root.classList.remove('away');
        poke();
      }
    },
    get suppressed() {
      return suppressed;
    },
    get idle() {
      return idle;
    },
    poke,
    dispose() {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, poke);
      offLang();
      root.remove();
      style.remove();
    },
  };
}
