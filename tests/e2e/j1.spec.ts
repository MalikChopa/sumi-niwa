// Tests du J1 (F-1, F-12) : Playwright pilotant Edge installé (channel msedge), sur l'aperçu du build.
// Les temps (paper-visible) sont INDICATIFS (headless) ; la mesure décisive est celle de l'utilisateur, fenêtrée.
import { test, expect, type Browser, type Page } from '@playwright/test';

const SHOTS = process.env.JARDIN_SHOTS ?? `${process.env.TEMP ?? '.'}/jardin-j1-shots`;
const WASHI = [243, 236, 221];

interface Stats {
  whitePct: number;
  /** Part (%) de pixels sombres (texte sumi) : prouve qu'un message est dessiné. */
  darkPct: number;
  mean: number[];
  /** Écart-type de luminance (niveaux 0-255) d'une zone de 64 x 64 au centre. */
  std64: number;
  /** Luminance moyenne de l'image entière (niveaux 0-255). */
  lum: number;
}

/** Décode un PNG dans une page vierge (JavaScript actif) : aucune dépendance Node. */
async function analyse(analyser: Page, png: unknown): Promise<Stats> {
  const b64 = (png as { toString(enc: string): string }).toString('base64');
  return analyser.evaluate(async (data) => {
    const blob = await (await fetch('data:image/png;base64,' + data)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let white = 0;
    let dark = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    const n = c.width * c.height;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i]! >= 254 && d[i + 1]! >= 254 && d[i + 2]! >= 254) white++;
      if (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]! < 120) dark++;
      r += d[i]!;
      g += d[i + 1]!;
      b += d[i + 2]!;
    }
    const lumOf = (i: number) => 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    const x0 = Math.floor(c.width / 2) - 32;
    const y0 = Math.floor(c.height / 2) - 32;
    let s = 0;
    let s2 = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const l = lumOf(((y0 + y) * c.width + x0 + x) * 4);
        s += l;
        s2 += l * l;
      }
    }
    const m = s / 4096;
    const std64 = Math.sqrt(Math.max(0, s2 / 4096 - m * m));
    return {
      whitePct: (white / n) * 100,
      darkPct: (dark / n) * 100,
      mean: [r / n, g / n, b / n],
      std64,
      lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n,
    };
  }, b64);
}

/** Écoute console et erreurs de page. Retourne la liste des erreurs. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return errors;
}

async function ready(page: Page) {
  await page.waitForFunction(() => document.documentElement.classList.contains('ready'), null, { timeout: 20_000 });
  await page.waitForTimeout(600); // quelques images
}

async function niveau(page: Page) {
  return page.evaluate(() => ({
    niveau: document.documentElement.dataset.niveau,
    backend: document.documentElement.dataset.backend,
  }));
}

function expectNotBlank(s: Stats) {
  expect(s.whitePct, 'pixels blancs purs (%)').toBeLessThan(1);
  s.mean.forEach((v, i) => expect(Math.abs(v - WASHI[i]!), `canal ${i} proche du washi`).toBeLessThan(30));
}

let analyser: Page;
test.beforeAll(async ({ browser }: { browser: Browser }) => {
  analyser = await browser.newPage();
});
test.afterAll(async () => {
  await analyser.close();
});

test('complet : WebGPU, papier visible, aucune erreur console, pas d\'écran blanc', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1');
  await ready(page);
  expect(await niveau(page)).toEqual({ niveau: 'complet', backend: 'webgpu' });
  expectNotBlank(await analyse(analyser, await page.screenshot()));
  expect(errors).toEqual([]);
});

test('reduit forcé : WebGL2, papier + message, aucune erreur console, pas d\'écran blanc', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1&force=reduit');
  await ready(page);
  expect(await niveau(page)).toEqual({ niveau: 'reduit', backend: 'webgl' });
  await expect(page.locator('#notice')).toBeVisible();
  await expect(page.locator('#notice')).toContainText(/WebGPU/);
  expectNotBlank(await analyse(analyser, await page.screenshot()));
  expect(errors).toEqual([]);
});

test('reduit naturel : sans navigator.gpu', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }));
  await page.goto('/');
  await ready(page);
  expect(await niveau(page)).toEqual({ niveau: 'reduit', backend: 'webgl' });
  expect(errors).toEqual([]);
});

test('reduit naturel : adaptateur logiciel (adapter.info.isFallbackAdapter)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'gpu', {
      value: { requestAdapter: async () => ({ info: { isFallbackAdapter: true } }) },
      configurable: true,
    }),
  );
  await page.goto('/');
  await ready(page);
  expect(await niveau(page)).toEqual({ niveau: 'reduit', backend: 'webgl' });
  expect(errors).toEqual([]);
});

test('reduit naturel : requestAdapter() nul', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => null }, configurable: true }),
  );
  await page.goto('/');
  await ready(page);
  expect((await niveau(page)).niveau).toBe('reduit');
});

test('refus forcé : message FR + EN, liste des navigateurs, bouton, pas d\'écran blanc', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?force=refus');
  await ready(page);
  expect((await niveau(page)).niveau).toBe('refus');
  const panel = page.locator('#refus');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Ce navigateur ne peut pas ouvrir le jardin');
  await expect(panel).toContainText('Neither WebGPU nor WebGL2');
  // Audit J6 point 6 : la page cite une annonce datée et sourcée, sans promesse de compatibilité.
  await expect(panel).toContainText('WebGPU est annoncé par ses éditeurs dans : Chrome et Edge 113+, Safari 26, Firefox 141+ (source : wiki gpuweb, liste du 2026-11-01)');
  await expect(panel).toContainText("n'est pas une garantie");
  await expect(panel).not.toContainText('est livré');
  await expect(page.locator('#retry')).toBeVisible();
  const st = await analyse(analyser, await page.screenshot());
  expectNotBlank(st);
  expect(st.darkPct, 'texte dessiné (pixels sombres, %)').toBeGreaterThan(0.1);
  expect(errors).toEqual([]);
});

test('refus naturel : ni WebGPU ni WebGL2', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
  await page.goto('/');
  await ready(page);
  expect((await niveau(page)).niveau).toBe('refus');
  await expect(page.locator('#refus')).toBeVisible();
  expectNotBlank(await analyse(analyser, await page.screenshot()));
  expect(errors).toEqual([]);
});

test('sans JavaScript : message <noscript> sur fond washi, pas d\'écran blanc', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto('/');
  // Avec JavaScript coupé, les localisateurs de Playwright ne fonctionnent pas : on lit le HTML et les pixels.
  const html = await page.content();
  expect(html).toContain("Jardin d'encre a besoin de JavaScript");
  expect(html).toContain('Chrome et Edge 113+');
  const png = await page.screenshot();
  await ctx.close();
  const st = await analyse(analyser, png);
  expectNotBlank(st);
  expect(st.darkPct, 'texte dessiné (pixels sombres, %)').toBeGreaterThan(0.1);
});

test('secours CSS : le message apparaît après 6 s si le script ne démarre pas', async ({ page }) => {
  await page.route('**/assets/*.js', (r) => r.abort());
  await page.goto('/');
  await expect(page.locator('#rescue')).toBeHidden();
  await page.waitForTimeout(6600);
  await expect(page.locator('#rescue')).toBeVisible();
  expectNotBlank(await analyse(analyser, await page.screenshot()));
});

test('paper-visible <= 3000 ms (5 chargements à froid, indicatif en headless)', async ({ browser }) => {
  const values: number[] = [];
  for (let i = 0; i < 5; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } }); // cache neuf
    const page = await ctx.newPage();
    await page.goto('/?test=1');
    await page.waitForFunction(() => performance.getEntriesByName('paper-visible').length > 0, null, { timeout: 20_000 });
    values.push(await page.evaluate(() => performance.getEntriesByName('paper-visible')[0]!.startTime));
    await ctx.close();
  }
  console.log('paper-visible (ms), 5 chargements :', values.map((v) => Math.round(v)).join(', '), '; pire :', Math.round(Math.max(...values)));
  expect(Math.max(...values)).toBeLessThanOrEqual(3000);
});

test('grain : écart-type de luminance d\'une zone vide de 64 x 64 >= 2,55 niveaux', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const s = await analyse(analyser, await page.screenshot());
  console.log('écart-type luminance 64x64 :', s.std64.toFixed(2), 'niveaux');
  expect(s.std64).toBeGreaterThanOrEqual(2.55);
});

test('respiration : crête à crête entre 0,5 % et 2 % de la moyenne, période 9 s +- 0,5 s (20 s de captures)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await ready(page);
  const samples: { t: number; lum: number }[] = [];
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    const t = (Date.now() - start) / 1000;
    const s = await analyse(analyser, await page.screenshot());
    samples.push({ t, lum: s.lum });
    await page.waitForTimeout(250);
  }
  const lums = samples.map((s) => s.lum);
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const pp = ((Math.max(...lums) - Math.min(...lums)) / mean) * 100;
  // Période : recherche de la sinusoïde qui colle le mieux (moindres carrés, pas de 0,05 s).
  let best = { period: 0, err: Infinity };
  for (let period = 7; period <= 11; period += 0.05) {
    const w = (2 * Math.PI) / period;
    let ab = 0;
    let aa = 0;
    let bb = 0;
    let ya = 0;
    let yb = 0;
    for (const s of samples) {
      const sn = Math.sin(w * s.t);
      const cs = Math.cos(w * s.t);
      aa += sn * sn;
      bb += cs * cs;
      ab += sn * cs;
      ya += (s.lum - mean) * sn;
      yb += (s.lum - mean) * cs;
    }
    const det = aa * bb - ab * ab;
    const ca = (ya * bb - yb * ab) / det;
    const cb = (yb * aa - ya * ab) / det;
    let err = 0;
    for (const s of samples) err += (s.lum - mean - ca * Math.sin(w * s.t) - cb * Math.cos(w * s.t)) ** 2;
    if (err < best.err) best = { period, err };
  }
  console.log(`respiration : ${samples.length} captures, crête à crête ${pp.toFixed(2)} % de la moyenne, période ajustée ${best.period.toFixed(2)} s`);
  expect(pp).toBeGreaterThanOrEqual(0.5);
  expect(pp).toBeLessThanOrEqual(2);
  expect(Math.abs(best.period - 9)).toBeLessThanOrEqual(0.5);
});

test('mouvement réduit : respiration coupée (variation < 0,1 %)', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await ready(page);
  const lums: number[] = [];
  for (let i = 0; i < 8; i++) {
    lums.push((await analyse(analyser, await page.screenshot())).lum);
    await page.waitForTimeout(700);
  }
  await ctx.close();
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const pp = ((Math.max(...lums) - Math.min(...lums)) / mean) * 100;
  console.log('mouvement réduit : crête à crête', pp.toFixed(3), '%');
  expect(pp).toBeLessThan(0.1);
});

for (const [w, h] of [
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`capture du papier complet en ${w}x${h} (hors projet)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await ready(page);
    await page.screenshot({ path: `${SHOTS}/papier-${w}x${h}.png` });
    console.log('capture :', `${SHOTS}/papier-${w}x${h}.png`);
  });
}
