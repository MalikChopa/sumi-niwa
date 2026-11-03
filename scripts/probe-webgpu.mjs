// Sonde WebGPU : Edge et Chrome installés, en headless puis en fenêtré.
// Aucun téléchargement : Playwright pilote les navigateurs déjà installés (channel).
// Usage : npm run probe   (ou node scripts/probe-webgpu.mjs [--no-windowed])
import { chromium } from '@playwright/test';

const WINDOWED = !process.argv.includes('--no-windowed');
const CHANNELS = [
  { name: 'Edge', channel: 'msedge' },
  { name: 'Chrome', channel: 'chrome' },
];
const MODES = [{ label: 'headless', headless: true }, ...(WINDOWED ? [{ label: 'fenêtré', headless: false }] : [])];

// Exécuté dans la page (contexte sécurisé : http://localhost).
async function probeInPage() {
  const out = { hasGpu: typeof navigator.gpu !== 'undefined' };
  if (!out.hasGpu) return out;
  let adapter;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (e) {
    out.error = 'requestAdapter a levé : ' + String(e);
    return out;
  }
  out.adapter = adapter !== null;
  if (!adapter) return out;
  const info = adapter.info || {};
  out.info = {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
    isFallbackAdapter: info.isFallbackAdapter,
  };
  out.topLevelIsFallbackAdapter = adapter.isFallbackAdapter;
  out.timestampQuery = adapter.features.has('timestamp-query');
  out.maxTextureDimension2D = adapter.limits.maxTextureDimension2D;
  return out;
}

const fmt = (v) => (v === undefined ? 'undefined' : JSON.stringify(v));

let failures = 0;
for (const { name, channel } of CHANNELS) {
  for (const mode of MODES) {
    const tag = `${name} / ${mode.label}`;
    let browser;
    try {
      browser = await chromium.launch({ channel, headless: mode.headless, timeout: 30000 });
      const version = browser.version();
      const page = await browser.newPage();
      await page.route('http://localhost/probe', (r) =>
        r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }),
      );
      await page.goto('http://localhost/probe');
      const r = await page.evaluate(probeInPage);
      console.log(`[${tag}] navigateur ${version}`);
      console.log(`  navigator.gpu présent          : ${r.hasGpu}`);
      if (r.error) console.log(`  erreur                         : ${r.error}`);
      if (r.hasGpu && r.adapter !== undefined) {
        console.log(`  requestAdapter() non nul       : ${r.adapter}`);
      }
      if (r.info) {
        console.log(`  info.vendor                    : ${fmt(r.info.vendor)}`);
        console.log(`  info.architecture              : ${fmt(r.info.architecture)}`);
        console.log(`  info.device / description      : ${fmt(r.info.device)} / ${fmt(r.info.description)}`);
        console.log(`  info.isFallbackAdapter         : ${fmt(r.info.isFallbackAdapter)}`);
        console.log(`  adapter.isFallbackAdapter (haut): ${fmt(r.topLevelIsFallbackAdapter)}`);
        console.log(`  timestamp-query                : ${r.timestampQuery}`);
        console.log(`  maxTextureDimension2D          : ${r.maxTextureDimension2D}`);
      }
    } catch (e) {
      failures++;
      const msg = String(e && e.message ? e.message : e).split('\n')[0];
      console.log(`[${tag}] ÉCHEC : ${msg}`);
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
}
console.log(failures ? `Sonde terminée avec ${failures} mode(s) en échec (voir ci-dessus).` : 'Sonde terminée, tous les modes ont répondu.');
