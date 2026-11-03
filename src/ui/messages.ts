// Messages de J1 (FR + EN). Le panneau `refus` est dans index.html (texte statique, sans JavaScript) ;
// ici, seul le message discret de la version réduite (REDUCED_NOTICE_MS).
import { REDUCED_NOTICE_MS } from '../constants';
import { isFrench } from './i18n';

export { isFrench };

const REDUCED_FR = "Version réduite : ton navigateur n'active pas WebGPU";
const REDUCED_EN = "Reduced version: your browser doesn't enable WebGPU";

export function showReducedNotice(): void {
  const el = document.getElementById('notice');
  if (!el) return;
  el.textContent = isFrench() ? REDUCED_FR : REDUCED_EN;
  el.hidden = false;
  // Un double rAF pour que la transition d'opacité parte de 0.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  window.setTimeout(() => {
    el.classList.remove('on');
    window.setTimeout(() => (el.hidden = true), 1200);
  }, REDUCED_NOTICE_MS);
}

// J3 : message bref réutilisant la bulle `#notice` (qualité choisie à la touche Q, « Ta machine peine »).
let toastTimer = 0;
export function showToast(text: string, ms = 2500): void {
  const el = document.getElementById('notice');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.remove('on');
    toastTimer = window.setTimeout(() => (el.hidden = true), 1200);
  }, ms);
}

// Voile de la perte du device (ARCHITECTURE §7) : papier uni (CSS) et « Le jardin se repose… », jamais d'écran blanc.
export function showVeil(): void {
  let el = document.getElementById('veil');
  if (!el) {
    el = document.createElement('div');
    el.id = 'veil';
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#F3ECDD;color:#1E2430;' +
      'font:1.15rem Georgia,"Times New Roman",serif;letter-spacing:.02em;z-index:8;opacity:0;transition:opacity .6s ease';
    document.body.appendChild(el);
  }
  el.textContent = isFrench() ? 'Le jardin se repose…' : 'The garden is resting…';
  el.hidden = false;
  const v = el;
  requestAnimationFrame(() => (v.style.opacity = '1'));
}

export function hideVeil(): void {
  const el = document.getElementById('veil');
  if (!el) return;
  el.style.opacity = '0';
  window.setTimeout(() => el.remove(), 700);
}
