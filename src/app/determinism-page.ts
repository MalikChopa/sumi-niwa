// determinism.html (ARCHITECTURE 12.2) : calcule dans le navigateur les hash des jardins fixes et les affiche ;
// Playwright lit `window.__determinism` et le compare à tests/golden/plants.json. Page retirée ou inerte au J6.
import { computeAllCases } from '../core/determinism-cases';

const t0 = performance.now();
const results = computeAllCases();
const ms = performance.now() - t0;

const body = document.querySelector('#out tbody') as HTMLElement;
for (const r of results) {
  const tr = document.createElement('tr');
  for (const text of [r.name, r.garden, r.plants.join(' ')]) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.appendChild(td);
  }
  body.appendChild(tr);
}
(document.getElementById('engine') as HTMLElement).textContent = `Navigateur : ${navigator.userAgent} · calcul : ${ms.toFixed(1)} ms`;
const pre = document.getElementById('json') as HTMLElement;
pre.textContent = JSON.stringify(results);
(window as unknown as { __determinism: unknown }).__determinism = { cases: results, ms };
document.documentElement.dataset.done = '1';
