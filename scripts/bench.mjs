// Mesure de performance (ARCHITECTURE 12.4) : construit (construction de TEST : bench.html n'existe pas en production), sert node_modules/.jardin-test sur un port libre, ouvre bench.html dans
// Edge installé (fenêtre réelle par défaut, plein écran maximisé), attend la fin et imprime les résultats.
// Usage :
//   npm run bench                         paliers forcés (bench.html), fenêtré
//   npm run probe:particles               sonde particules 50 000 / 100 000 / 200 000 (bench.html?mode=probe)
//   node scripts/bench.mjs [--probe] [--headless] [--webgl] [--no-build] [--port 4240] [--chrome]
// Rien n'est envoyé ; aucun navigateur téléchargé (canal msedge ou chrome). Le serveur est arrêté à la fin.
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const PROBE = has('--probe');
const HEADLESS = has('--headless');
const portArg = args.indexOf('--port');
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 4240;
const CHANNEL = has('--chrome') ? 'chrome' : 'msedge';

if (!has('--no-build')) {
  console.log('[bench] construction de test (npm run build:test)…');
  const b = spawnSync('npm run build:test', { shell: true, stdio: ['ignore', 'ignore', 'inherit'] });
  if (b.status !== 0) {
    console.error('[bench] échec de la construction');
    process.exit(1);
  }
}

console.log(`[bench] aperçu sur http://localhost:${PORT}/ (port strict)`);
const server = spawn(`npx vite preview --mode test --port ${PORT} --strictPort`, { shell: true, stdio: 'ignore' });
const stopServer = () => {
  if (server.exitCode === null) {
    if (process.platform === 'win32') spawnSync(`taskkill /pid ${server.pid} /T /F`, { shell: true, stdio: 'ignore' });
    else server.kill('SIGTERM');
  }
};
process.on('exit', stopServer);

async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/bench.html`);
      if (r.ok) return;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`aperçu injoignable sur le port ${PORT}`);
}

let browser;
try {
  await waitServer();
  browser = await chromium.launch({
    channel: CHANNEL,
    headless: HEADLESS,
    // Horodatages GPU à pleine résolution (sinon Chromium les quantifie, ≈ 0,065 ms vu au J3) : drapeau de développeur,
    // local à ce navigateur lancé pour la mesure.
    args: ['--enable-webgpu-developer-features', ...(HEADLESS ? [] : ['--start-maximized'])],
  });
  const ctx = await browser.newContext(HEADLESS ? { viewport: { width: 1920, height: 1080 } } : { viewport: null });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[page] erreur : ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[page] console.error : ' + m.text());
  });
  const q = [];
  if (PROBE) q.push('mode=probe');
  if (has('--webgl')) q.push(PROBE ? 'backend=webgl' : 'force=reduit');
  const url = `http://localhost:${PORT}/bench.html${q.length ? '?' + q.join('&') : ''}`;
  console.log(`[bench] ${CHANNEL} ${HEADLESS ? 'headless (INDICATIF)' : 'fenêtré'} : ${url}`);
  await page.goto(url);
  const key = PROBE ? '__probe' : '__bench';
  await page.waitForFunction((k) => window[k]?.done === true, key, { timeout: 15 * 60_000, polling: 1000 });
  const text = await page.evaluate(() => document.getElementById('out')?.textContent ?? '');
  console.log(text.trim());
  const json = await page.evaluate((k) => window[k], key);
  console.log('[bench] JSON : ' + JSON.stringify(json));
  console.log(`[bench] navigateur ${browser.version()}`);
} catch (e) {
  console.error('[bench] ÉCHEC : ' + String(e && e.message ? e.message : e).split('\n')[0]);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  stopServer();
}
