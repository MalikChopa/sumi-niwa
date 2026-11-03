// Boîte de confirmation de « Nouvelle feuille » (SPEC F-10) et champ de secours du lien (SPEC §11 : presse-papiers
// refusé → champ de texte avec l'URL sélectionnée). <dialog> natif : focus piégé, Échap = annuler, focus rendu à
// l'élément qui l'avait avant.
import { t } from './i18n';

const CSS = `
dialog.jd{border:1px solid rgba(30,36,48,.25);border-radius:14px;background:#F3ECDD;color:#1E2430;padding:1.3rem 1.5rem 1.1rem;max-width:min(30rem,calc(100vw - 2rem));font:1rem/1.5 Georgia,"Times New Roman",serif;box-shadow:0 10px 40px rgba(30,36,48,.18)}
dialog.jd::backdrop{background:rgba(243,236,221,.62)}
dialog.jd h2{font-weight:normal;font-size:1.2rem;margin:0 0 .5rem;letter-spacing:.01em}
dialog.jd p{margin:0 0 1rem}
dialog.jd .row{display:flex;flex-wrap:wrap;gap:.6rem;justify-content:flex-end}
dialog.jd button{font:inherit;font-size:.95rem;color:#1E2430;background:none;border:1px solid rgba(30,36,48,.6);border-radius:999px;padding:.4rem 1.1rem;cursor:pointer}
dialog.jd button:hover{background:rgba(30,36,48,.07)}
dialog.jd button:focus-visible{outline:2px solid #1E2430;outline-offset:2px}
dialog.jd button.danger{border-color:#B8402F;color:#8A2D20}
dialog.jd input{width:100%;box-sizing:border-box;font:.85rem ui-monospace,Consolas,monospace;color:#1E2430;background:#fff8;border:1px solid rgba(30,36,48,.6);border-radius:8px;padding:.5rem .6rem}
dialog.jd input:focus-visible{outline:2px solid #1E2430;outline-offset:2px}
dialog.jd label{display:block;margin-bottom:.4rem}
@media (prefers-reduced-motion:reduce){dialog.jd{transition:none}}
`;

let styled = false;
function ensureStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select,textarea,[href],[tabindex]:not([tabindex="-1"])';

/**
 * Piège du focus : <dialog> modale rend le reste de la page inerte, mais Chromium laisse Tab sortir vers l'interface du
 * navigateur après le dernier élément. On referme la boucle (Tab sur le dernier → premier, Maj+Tab sur le premier → dernier).
 */
function trapFocus(d: HTMLDialogElement): void {
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = Array.from(d.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !d.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !d.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  });
}

function makeDialog(): HTMLDialogElement {
  ensureStyle();
  const d = document.createElement('dialog');
  d.className = 'jd';
  trapFocus(d);
  return d;
}

export function dialogOpen(): boolean {
  return document.querySelector('dialog[open]') !== null;
}

/**
 * Confirmation de « Nouvelle feuille » : focus sur « Annuler », option « Copier le lien d'abord ».
 * Résolu à `true` seulement si l'on confirme.
 */
export function confirmNewSheet(opts: { plants: number; copyLink: () => Promise<boolean> }): Promise<boolean> {
  return new Promise((resolve) => {
    const d = makeDialog();
    d.setAttribute('aria-labelledby', 'jd-title');
    d.setAttribute('aria-describedby', 'jd-text');
    const h = document.createElement('h2');
    h.id = 'jd-title';
    h.textContent = t('dlg_title');
    const p = document.createElement('p');
    p.id = 'jd-text';
    p.textContent = t('dlg_text', { n: opts.plants });
    const row = document.createElement('div');
    row.className = 'row';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.id = 'jd-cancel';
    cancel.textContent = t('dlg_cancel');
    cancel.autofocus = true;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.id = 'jd-copy';
    copy.textContent = t('dlg_copy');
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.id = 'jd-ok';
    ok.className = 'danger';
    ok.textContent = t('dlg_ok');
    row.append(cancel, copy, ok);
    d.append(h, p, row);
    document.body.appendChild(d);
    let result = false;
    cancel.addEventListener('click', () => d.close());
    ok.addEventListener('click', () => {
      result = true;
      d.close();
    });
    copy.addEventListener('click', () => {
      void opts.copyLink().then((done) => {
        if (done) copy.textContent = t('dlg_copied');
      });
    });
    d.addEventListener('close', () => {
      d.remove();
      resolve(result);
    });
    d.showModal();
    cancel.focus();
  });
}

let field: HTMLDialogElement | null = null;

/** Champ de secours : l'URL est dans un champ de texte déjà sélectionné (SPEC §11 « Presse-papiers refusé »). */
export function showLinkField(url: string): void {
  field?.close();
  const d = makeDialog();
  d.id = 'link-field';
  const label = document.createElement('label');
  label.htmlFor = 'link-field-input';
  label.textContent = t('field_label');
  const input = document.createElement('input');
  input.id = 'link-field-input';
  input.type = 'text';
  input.readOnly = true;
  input.value = url;
  input.addEventListener('focus', () => input.select());
  const row = document.createElement('div');
  row.className = 'row';
  row.style.marginTop = '.8rem';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = t('field_close');
  close.addEventListener('click', () => d.close());
  row.appendChild(close);
  d.append(label, input, row);
  document.body.appendChild(d);
  d.addEventListener('close', () => {
    d.remove();
    if (field === d) field = null;
  });
  field = d;
  d.showModal();
  input.focus();
  input.select();
}
