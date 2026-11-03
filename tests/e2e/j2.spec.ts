// Tests du J2 (F-2, F-3, critère 1 / C-1, non-régression `reduit`) : Playwright pilotant Edge installé (msedge),
// et Chrome installé pour le déterminisme seulement. Les temps sont INDICATIFS (headless, cette machine) ;
// la mesure décisive est celle de l'utilisateur, fenêtrée.
// Repère : fenêtre 1920 x 1080 → 1,2 px par uf, sans décalage (px = 1,2 × uf).
import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import golden from '../golden/plants.json' with { type: 'json' };

const PX = 1.2;
const toPx = (x: number, y: number) => ({ x: x * PX, y: y * PX });

interface Ink {
  /** pixels d'encre (nettement plus sombres que le papier, ou roses) */
  ink: number;
  dark: number;
  pink: number;
  /** boîte englobante des pixels d'encre, en uf */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** plus longue suite verticale de pixels sombres dans une colonne, en uf */
  vrun: number;
}

/** Analyse une capture (PNG) dans une page vierge : pixels d'encre d'une zone donnée en uf. */
async function inkIn(analyser: Page, png: PngBuf, zone: { x0: number; y0: number; x1: number; y1: number }): Promise<Ink> {
  return analyser.evaluate(
    async ({ data, zone, px }) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      const X0 = Math.max(0, Math.floor(zone.x0 * px));
      const Y0 = Math.max(0, Math.floor(zone.y0 * px));
      const X1 = Math.min(c.width, Math.ceil(zone.x1 * px));
      const Y1 = Math.min(c.height, Math.ceil(zone.y1 * px));
      const d = ctx.getImageData(X0, Y0, X1 - X0, Y1 - Y0).data;
      const W = X1 - X0;
      let ink = 0;
      let dark = 0;
      let pink = 0;
      let bx0 = 1e9;
      let by0 = 1e9;
      let bx1 = -1;
      let by1 = -1;
      const runs = new Array(W).fill(0);
      const best = new Array(W).fill(0);
      for (let y = 0; y < Y1 - Y0; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const r = d[i]!;
          const g = d[i + 1]!;
          const b = d[i + 2]!;
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const isPink = r - g > 25 && r > 150;
          const isDark = l < 120;
          // Papier : luminance ≈ 225–240 ; encre = au moins 30 niveaux plus sombre, ou rose.
          const isInk = l < 195 || isPink;
          if (isInk) {
            ink++;
            bx0 = Math.min(bx0, x);
            by0 = Math.min(by0, y);
            bx1 = Math.max(bx1, x);
            by1 = Math.max(by1, y);
          }
          if (isDark) dark++;
          if (isPink) pink++;
          runs[x] = isDark ? runs[x] + 1 : 0;
          if (runs[x] > best[x]) best[x] = runs[x];
        }
      }
      const vrun = Math.max(0, ...best) / px;
      return {
        ink,
        dark,
        pink,
        box: bx1 < 0 ? null : { x0: (X0 + bx0) / px, y0: (Y0 + by0) / px, x1: (X0 + bx1) / px, y1: (Y0 + by1) / px },
        vrun,
      };
    },
    { data: png.toString('base64'), zone, px: PX },
  );
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return errors;
}

async function openGarden(page: Page, query = '', seed = '9f3a12c4') {
  // Page vierge d'abord : un `goto` qui ne change que le fragment ne recharge pas la page.
  await page.goto('about:blank');
  await page.goto(`/?test=1${query}#g=1.${seed}.0.`);
  await page.waitForFunction(() => (window as any).__jardin?.ready() === true, null, { timeout: 30_000 });
  // J4 : la barre d'icônes (bas de page, pastille rose de la saison) n'est pas l'objet de ces tests : ses boutons
  // recevraient des clics de plantation et ses pixels fausseraient les comptes de rose. Aucune assertion changée.
  await page.addStyleTag({ content: '#bar{display:none!important}' });
  await page.waitForTimeout(200);
}

const metrics = (page: Page) => page.evaluate(() => (window as any).__jardin.metrics());
const plantHook = (page: Page, x: number, y: number, e: number) => page.evaluate(([x, y, e]) => (window as any).__jardin.plant(x, y, e), [x, y, e]);
const step = (page: Page, n: number) => page.evaluate((n) => (window as any).__jardin.step(n), n);
const pct = (arr: number[], q: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
};

let analyser: Page;
test.beforeAll(async ({ browser }: { browser: Browser }) => {
  analyser = await browser.newPage();
});
test.afterAll(async () => {
  await analyser.close();
});

test('F-2 : clic court = graine à l’image suivante, puis un bambou (espèce courante) qui pousse ; aucune erreur', async ({ page }) => {
  const errors = watchErrors(page);
  await openGarden(page);
  const p = toPx(800, 700);
  // 1) Graine visible pendant l'appui (la capture prend du temps : cet appui est ensuite annulé par un
  //    déplacement de plus de 12 px, pour ne pas planter une autre espèce par maintien).
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const seedShot = await inkIn(analyser, await page.screenshot(), { x0: 785, y0: 685, x1: 815, y1: 715 });
  expect(seedShot.dark, 'graine d’encre visible sous le pointeur').toBeGreaterThan(20);
  await page.mouse.move(p.x + 40, p.y, { steps: 2 });
  await page.mouse.up();
  expect((await metrics(page)).plants).toBe(0);
  // 2) Clic de 100 ms (F-2) : un bambou, espèce courante au départ.
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const m = await metrics(page);
  expect(m.plants).toBe(1);
  expect(m.especes).toEqual([0]);
  expect(m.seedFrameDelays[0], 'graine dessinée à l’image suivant l’appui').toBeLessThanOrEqual(1);
  expect(await page.locator('#gauge').getAttribute('data-visible')).toBeNull(); // pas de jauge pour un clic
  const shot = await inkIn(analyser, await page.screenshot(), { x0: 700, y0: 400, x1: 900, y1: 700 });
  expect(shot.ink, 'pixels de trait au-dessus du pied').toBeGreaterThan(500);
  expect(errors).toEqual([]);
});

test('F-2 variante : appui de 1 500 ms → jauge « Herbes », des herbes poussent et deviennent l’espèce courante', async ({ page }) => {
  await openGarden(page);
  const p = toPx(500, 790);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(1400);
  // Lecture d'un coup (la fenêtre « Herbes » est [1 300, 1 800[ ms), puis relâchement aussitôt.
  const g = await page.evaluate(() => {
    const el = document.getElementById('gauge')!;
    return { visible: el.dataset.visible, name: el.querySelector('.name')!.textContent, big: el.querySelectorAll('circle[r="4.4"]').length };
  });
  await page.mouse.up();
  const gauge = page.locator('#gauge');
  expect(g.visible).toBe('1');
  expect(g.name).toMatch(/Herbes|Grass/);
  expect(g.big).toBe(1); // un seul point en avant
  const q = toPx(1100, 790);
  await page.mouse.click(q.x, q.y, { delay: 80 }); // clic court : espèce courante = herbes
  await page.waitForTimeout(300);
  const m = await metrics(page);
  expect(m.especes, `jauge lue : ${g.name}`).toEqual([2, 2]);
  expect(await gauge.getAttribute('data-visible')).toBeNull();
});

test('F-2 : un déplacement de plus de 12 px pendant l’appui ne plante rien', async ({ page }) => {
  await openGarden(page);
  const p = toPx(600, 700);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 30, p.y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect((await metrics(page)).plants).toBe(0);
});

test('réponse : graine ≤ 1 image après l’appui, 1er trait ≤ 200 ms après le relâchement (p95 sur 20 clics, indicatif)', async ({ page }) => {
  await openGarden(page);
  for (let i = 0; i < 20; i++) {
    const p = toPx(120 + i * 70, 760 + (i % 3) * 40);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(300);
  const m = await metrics(page);
  expect(m.plants).toBe(20);
  expect(m.plantResponses).toHaveLength(20);
  const p95 = pct(m.plantResponses, 0.95);
  const seedMax = Math.max(...m.seedFrameDelays);
  console.info(
    `[J2] 1er trait après relâchement (ms, 20 clics) : min ${Math.min(...m.plantResponses).toFixed(1)}, médiane ${pct(m.plantResponses, 0.5).toFixed(1)}, p95 ${p95.toFixed(1)}, max ${Math.max(...m.plantResponses).toFixed(1)}` +
      ` · graine : images après l’appui max ${seedMax}, ms jusqu’à l’image suivante médiane ${pct(m.seedResponses, 0.5).toFixed(1)}, max ${Math.max(...m.seedResponses).toFixed(1)}`,
  );
  expect(seedMax).toBeLessThanOrEqual(1);
  expect(p95).toBeLessThanOrEqual(200);
});

test('C-1 : first-stroke ≤ 3 000 ms depuis navigationStart (5 chargements à froid, autoplant, indicatif) et trait à +500 ms', async ({ browser }) => {
  const values: number[] = [];
  for (let i = 0; i < 5; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto('/?test=1&autoplant=1');
    await page.waitForFunction(() => performance.getEntriesByName('first-stroke').length > 0, null, { timeout: 15_000 });
    const t = await page.evaluate(() => performance.getEntriesByName('first-stroke')[0]!.startTime);
    values.push(t);
    if (i === 0) {
      await page.waitForTimeout(500);
      const s = await inkIn(analyser, await page.screenshot(), { x0: 740, y0: 640, x1: 860, y1: 800 });
      expect(s.ink, 'pixels de trait autour de (800, 792) à +500 ms').toBeGreaterThan(200);
    }
    await ctx.close();
  }
  console.info(`[J2] first-stroke (ms) : ${values.map((v) => v.toFixed(0)).join(' / ')} ; pire ${Math.max(...values).toFixed(0)}`);
  expect(Math.max(...values)).toBeLessThanOrEqual(3000);
});

// Une plante par page, graine fixe, croissance terminée par `step` : traits caractéristiques de chaque espèce.
const SPECIES_ZONES = { x0: 300, y0: 60, x1: 1300, y1: 899 };
async function grownSpecies(page: Page, espece: number, query = ''): Promise<Ink> {
  await openGarden(page, query, '00c0ffee');
  await plantHook(page, 800, 792, espece);
  for (let i = 0; i < 10; i++) await step(page, 60);
  await page.waitForTimeout(150);
  return inkIn(analyser, await page.screenshot(), SPECIES_ZONES);
}

test('cinq espèces reconnaissables par des traits de pixels (une plante par page)', async ({ page }) => {
  const f: Ink[] = [];
  for (let e = 0; e < 5; e++) f.push(await grownSpecies(page, e));
  const dims = f.map((s) => ({ w: s.box!.x1 - s.box!.x0, h: s.box!.y1 - s.box!.y0, pink: s.pink, dark: s.dark, vrun: s.vrun }));
  console.info('[J2] espèces (uf) ' + dims.map((d, e) => `${e}: ${d.w.toFixed(0)}x${d.h.toFixed(0)} rose ${d.pink} sombre ${d.dark} colonne ${d.vrun.toFixed(0)}`).join(' | '));
  const [bam, cer, her, piv, roc] = dims as [typeof dims[0], typeof dims[0], typeof dims[0], typeof dims[0], typeof dims[0]];
  // Bambou : une tige sombre verticale continue d'au moins 150 uf, sans rose, plus haut que large.
  expect(bam.vrun).toBeGreaterThan(150);
  expect(bam.pink).toBeLessThan(50);
  expect(bam.h).toBeGreaterThan(300);
  // Cerisier : des fleurs roses en nombre, grand.
  expect(cer.pink).toBeGreaterThan(2000);
  expect(cer.h).toBeGreaterThan(250);
  // Herbes : petites (≤ 160 uf de haut), sans rose.
  expect(her.h).toBeLessThan(160);
  expect(her.pink).toBeLessThan(50);
  // Pivoine : une fleur rose, compacte (moins haute que 180 uf et moins large que 220 uf).
  expect(piv.pink).toBeGreaterThan(300);
  expect(piv.h).toBeLessThan(180);
  expect(piv.w).toBeLessThan(260);
  expect(piv.pink).toBeLessThan(cer.pink);
  // Roche : plus large que haute, basse, peu de sombre.
  expect(roc.w / roc.h).toBeGreaterThan(1.6);
  expect(roc.h).toBeLessThan(140);
  expect(roc.pink).toBeLessThan(50);
});

test('déterminisme : determinism.html dans Edge = valeurs de Node (tests/golden/plants.json)', async ({ page }) => {
  await page.goto('/determinism.html');
  await page.waitForFunction(() => document.documentElement.dataset.done === '1');
  const r = await page.evaluate(() => (window as any).__determinism);
  console.info(`[J2] determinism.html Edge : ${r.cases.map((c: any) => `${c.name}=${c.garden}`).join(' ')} (${r.ms.toFixed(1)} ms)`);
  expect(r.cases).toEqual(golden.cases);
});

test('déterminisme : determinism.html dans Chrome installé = valeurs de Node', async ({ baseURL }) => {
  let browser: Browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (e) {
    test.skip(true, `Chrome installé introuvable : ${(e as Error).message.split('\n')[0]}`);
    return;
  }
  const page = await browser.newPage();
  await page.goto(`${baseURL}/determinism.html`);
  await page.waitForFunction(() => document.documentElement.dataset.done === '1');
  const r = await page.evaluate(() => (window as any).__determinism);
  const ua = await page.evaluate(() => navigator.userAgent);
  console.info(`[J2] determinism.html Chrome (${ua.match(/Chrome\/[\d.]+/)?.[0]}) : ${r.cases.map((c: any) => `${c.name}=${c.garden}`).join(' ')}`);
  expect(r.cases).toEqual(golden.cases);
  await browser.close();
});

for (const level of ['complet', 'reduit'] as const) {
  test(`F-3 et non-régression (${level}) : une plante de chaque espèce pousse, hash = Node`, async ({ page }) => {
    const errors = watchErrors(page);
    const query = level === 'reduit' ? '&force=reduit' : '';
    // F-3 : graine 9f3a12c4, bambous en (500, 792) puis (1100, 792).
    await openGarden(page, query, '9f3a12c4');
    expect((await metrics(page)).backend).toBe(level === 'reduit' ? 'webgl' : 'webgpu');
    await plantHook(page, 500, 792, 0);
    await plantHook(page, 1100, 792, 0);
    const f3 = golden.cases.find((c) => c.name === 'F-3')!;
    expect(await page.evaluate(() => (window as any).__jardin.plantHashes())).toEqual(f3.plants);
    expect(await page.evaluate(() => (window as any).__jardin.gardenHash())).toBe(f3.garden);
    // Cinq espèces (cas « cinq-especes ») dans une feuille neuve.
    await openGarden(page, query, '00c0ffee');
    const five = golden.cases.find((c) => c.name === 'cinq-especes')!;
    const pos = [
      [240, 800, 1],
      [520, 790, 2],
      [760, 800, 3],
      [1040, 780, 4],
      [1320, 795, 0],
    ] as const;
    for (const [x, y, e] of pos) await plantHook(page, x, y, e);
    await page.waitForTimeout(700); // croissance en temps réel : premiers traits
    const early = await page.screenshot();
    for (const [x, y] of pos) {
      const s = await inkIn(analyser, early, { x0: x - 60, y0: y - 120, x1: x + 60, y1: y + 10 });
      expect(s.ink, `pixels de trait près de (${x}, ${y}) après 0,7 s`).toBeGreaterThan(30);
    }
    expect(await page.evaluate(() => (window as any).__jardin.gardenHash())).toBe(five.garden);
    expect(errors).toEqual([]);
  });
}

test('fluidité : pendant la croissance, 95 % des images ≤ 33 ms (10 plantes, indicatif headless)', async ({ page }) => {
  await openGarden(page);
  const pts = [
    [180, 805, 1], [420, 795, 2], [600, 800, 3], [820, 790, 0], [1010, 790, 4],
    [1180, 800, 2], [1330, 795, 0], [1480, 800, 3], [300, 820, 4], [1560, 810, 1],
  ] as const;
  for (const [x, y, e] of pts) {
    await plantHook(page, x, y, e); // même chemin que le clic (génération + maillages), espèces variées
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(6000);
  const m = await metrics(page);
  const dts = (m.frames as { dt: number; growing: boolean }[]).filter((f) => f.growing && f.dt > 0).map((f) => f.dt);
  const within = dts.filter((d) => d <= 33).length / dts.length;
  console.info(`[J2] images pendant la croissance : ${dts.length}, ≤ 33 ms : ${(within * 100).toFixed(1)} %, médiane ${pct(dts, 0.5).toFixed(1)} ms, p95 ${pct(dts, 0.95).toFixed(1)} ms, max ${Math.max(...dts).toFixed(1)} ms`);
  expect(dts.length).toBeGreaterThan(100);
  expect(within).toBeGreaterThanOrEqual(0.95);
});

test('160 plantes au plus : la 161e est refusée', async ({ page }) => {
  await openGarden(page);
  const r = await page.evaluate(() => {
    const out: any[] = [];
    for (let i = 0; i < 161; i++) out.push((window as any).__jardin.plant(100 + (i % 20) * 70, 500 + Math.floor(i / 20) * 45, i % 5));
    return out;
  });
  expect(r.slice(0, 160).every((x: any) => x.ok)).toBe(true);
  expect(r[160]).toMatchObject({ ok: false, reason: 'plein' });
});
