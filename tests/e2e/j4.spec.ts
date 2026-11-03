// Tests du J4 (F-7 saisons, F-8 PNG et lien, F-10 nouvelle feuille, barre, `reduit`) : Playwright pilotant Edge
// installé (msedge), headless. Les temps sont INDICATIFS ; la mesure décisive est celle de l'utilisateur, fenêtrée.
// Repère : fenêtre 1920 x 1080 → 1,2 px par uf, sans décalage (px = 1,2 × uf). Interface en français (locale fr-FR).
import { test, expect, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PX = 1.2;
test.use({ locale: 'fr-FR' });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return errors;
}

type Hooks = {
  ready(): boolean;
  plant(x: number, y: number, e: number): { ok: boolean };
  step(n: number): Promise<void>;
  gardenHash(): string;
  plantHashes(): string[];
  plantTotal(): number;
  metrics(): { plants: number; growing: boolean; backend: string; frames: { t: number; dt: number }[] };
  setSeason(s: number, instant?: boolean): void;
  seasonInfo(): { target: number; weights: number[]; moving: boolean; log: { to: number; startMs: number; endMs: number | null; maxFrameMs: number; frames: number }[]; seasonType: number; part: number; inkWeights: number[] };
  link(): string;
  keep(): Promise<{ name: string; width: number; height: number; ms: number; renderMs: number; readMs: number; encodeMs: number; bytes: number; fallback: boolean } | null>;
  lastExport(): { name: string; width: number; height: number; ms: number; fallback: boolean } | null;
  analyzeExport(a: unknown): Promise<{ w: number; h: number; whitePct: number; translucent: number; mean: number[]; diffAllFrac: number | null; regions: { name: string; pixels: number; mean: number[]; diffFrac: number; redFrac: number; darkFrac: number }[] }>;
  newSheet(): Promise<void>;
  copyLink(): Promise<boolean>;
  setFall(k: number): void;
  particles(): Promise<{ carriersB: number[] }>;
};
// Les fonctions ne traversent pas page.evaluate : on appelle les crochets dans la page.
const call = <R>(page: Page, f: (j: Hooks) => R | Promise<R>) =>
  page.evaluate(`(async () => { const j = window.__jardin; return await (${f.toString()})(j); })()`) as Promise<R>;

async function openGarden(page: Page, query = '', hash = '#g=1.9f3a12c4.0.') {
  await page.goto('about:blank');
  await page.goto(`/?test=1${query}${hash}`);
  await page.waitForFunction(() => (window as unknown as { __jardin?: Hooks }).__jardin?.ready() === true, null, { timeout: 30_000 });
  await page.waitForTimeout(200);
}

const PLANTS: [number, number, number][] = [
  [200, 792, 1],
  [420, 792, 0],
  [640, 800, 2],
  [820, 792, 3],
  [1000, 792, 4],
  [1180, 792, 1],
  [1330, 800, 2],
  [1420, 792, 0],
  [560, 820, 2],
  [760, 830, 3],
  [940, 830, 2],
  [1100, 820, 3],
];

/** Réveille la barre (masquée après 3 s d'immobilité, elle ne reçoit alors plus les clics) : un mouvement de souris. */
async function wake(page: Page) {
  await page.mouse.move(960, 500);
  await page.mouse.move(964, 504);
}

async function plantMany(page: Page, n: number) {
  for (const [x, y, e] of PLANTS.slice(0, n)) await page.evaluate(([x, y, e]) => (window as unknown as { __jardin: Hooks }).__jardin.plant(x!, y!, e!), [x, y, e]);
}

/** Pixels rose / vert / rouge d'une capture (nombre de pixels), pour montrer que la saison change l'image. */
async function colorCounts(page: Page, png: PngBuf) {
  const analyser = await page.context().newPage();
  const r = await analyser.evaluate(async (data) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let pink = 0, green = 0, red = 0, light = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
      if (r > 215 && g < 205 && b > 165 && r - g > 25) pink++;
      if (g > r + 10 && g > b + 25) green++;
      if (r > 150 && g < 110 && b < 100) red++;
      if (r > 235 && g > 235 && b > 235) light++;
    }
    return { pink, green, red, light };
  }, png.toString('base64'));
  await analyser.close();
  return r;
}

// ---------------------------------------------------------------------------------------------
// F-7 saisons

for (const level of ['complet', 'reduit'] as const) {
  test(`F-7 (${level}) : S → été en moins de 4 000 ms, aucune image > 50 ms, fleurs → feuilles sans saut, lien mis à jour`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await openGarden(page, (level === 'reduit' ? '&force=reduit' : '&quality=T2') + '&fx=1');
    expect((await call(page, (j) => j.metrics())).backend).toBe(level === 'reduit' ? 'webgl' : 'webgpu');
    await plantMany(page, 1); // cerisier en (200, 792) : fleurs au printemps
    await plant1(page);
    await call(page, (j) => j.step(900));
    await page.waitForTimeout(500);
    const spring = await colorCounts(page, await page.screenshot());
    // Mesure indépendante dans la page : instant où le poids de l'été atteint 1.
    await page.evaluate(`(() => {
      window.__trans = { t0: performance.now(), t1: 0, mid: null };
      const loop = () => {
        const w = window.__jardin.seasonInfo().weights;
        const now = performance.now();
        if (!window.__trans.mid && w[1] >= 0.45 && w[1] <= 0.55) window.__trans.mid = { t: now - window.__trans.t0, w };
        if (w[1] >= 0.99999) window.__trans.t1 = now; else requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    })()`);
    await page.keyboard.press('s');
    await page.waitForTimeout(1800);
    const midShot = await colorCounts(page, await page.screenshot()); // à mi-chemin : fleurs ET feuilles, ni l'un ni l'autre plein
    await page.waitForTimeout(2600);
    const info = await call(page, (j) => j.seasonInfo());
    const trans = (await page.evaluate('window.__trans')) as { t0: number; t1: number; mid: { t: number; w: number[] } | null };
    const rec = info.log[info.log.length - 1]!;
    const dur = rec.endMs! - rec.startMs;
    const polled = trans.t1 - trans.t0;
    console.info(`[J4] F-7 ${level} : printemps → été en ${dur.toFixed(0)} ms (poids lus par rAF : ${polled.toFixed(0)} ms), pire image ${rec.maxFrameMs.toFixed(1)} ms sur ${rec.frames} images`);
    expect(info.target).toBe(1);
    expect(info.weights).toEqual([0, 1, 0, 0]);
    expect(info.inkWeights).toEqual([0, 1, 0, 0]);
    expect(info.seasonType).toBe(2); // les nouveaux porteurs sont de type 2 (feuilles d'été)
    expect(info.part).toBeCloseTo(0.3, 6); // part active de l'été
    expect(dur).toBeGreaterThan(3000);
    expect(dur).toBeLessThan(4000);
    expect(polled).toBeLessThan(4000);
    // Les images : sur une transition sans capture d'écran (la capture mi-chemin ralentit une image, c'est le test, pas l'application).
    await page.keyboard.press('s'); // été → automne
    await page.waitForTimeout(4200);
    const clean = (await call(page, (j) => j.seasonInfo())).log.slice(-1)[0]!;
    console.info(`[J4] F-7 ${level} : transition propre été → automne en ${(clean.endMs! - clean.startMs).toFixed(0)} ms, pire image ${clean.maxFrameMs.toFixed(1)} ms sur ${clean.frames} images ; avec captures : pire image ${rec.maxFrameMs.toFixed(1)} ms`);
    expect(clean.endMs! - clean.startMs).toBeLessThan(4000);
    expect(clean.maxFrameMs).toBeLessThanOrEqual(50);
    await call(page, (j) => j.setSeason(1, true)); // retour à l'été pour la suite (captures et lien)
    const summer = await colorCounts(page, await page.screenshot());
    console.info(`[J4] F-7 ${level} : pixels rose/vert — printemps ${spring.pink}/${spring.green}, mi-chemin ${midShot.pink}/${midShot.green}, été ${summer.pink}/${summer.green}`);
    expect(spring.pink).toBeGreaterThan(summer.pink + 150); // les fleurs ont disparu
    expect(summer.green).toBeGreaterThan(spring.green + 150); // les feuilles sont là
    expect(midShot.pink).toBeGreaterThan(summer.pink); // fleurs encore (plus petites) à mi-chemin
    expect(midShot.green).toBeGreaterThan(spring.green);
    expect(page.url()).toMatch(/#g=1\.9f3a12c4\.1\./);
    expect(errors).toEqual([]);
  });
}

/** Premier cerisier du jeu de plantes (rang 0) : planté en (200, 792) par `plantMany(1)` ; ici on en ajoute un au centre. */
async function plant1(page: Page) {
  await page.evaluate(() => (window as unknown as { __jardin: Hooks }).__jardin.plant(800, 800, 1));
}

test('F-7 commandes : S, Maj+S, points de la barre, molette, clavier sur un bouton ; aria-pressed suit la saison', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await openGarden(page, '&quality=T2');
  const target = () => call(page, (j) => j.seasonInfo().target);
  expect(await target()).toBe(0);
  await page.keyboard.press('s');
  expect(await target()).toBe(1);
  await page.keyboard.press('s');
  await page.keyboard.press('s');
  expect(await target()).toBe(3);
  await page.keyboard.press('s'); // hiver → printemps
  expect(await target()).toBe(0);
  await page.keyboard.press('Shift+S'); // précédente : printemps → hiver
  expect(await target()).toBe(3);
  // Point de la barre (clic = choisir) : l'automne.
  await wake(page);
  await page.click('#bar .seasons button[data-season="2"]');
  expect(await target()).toBe(2);
  await expect(page.locator('#bar .seasons button[data-season="2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#bar .seasons button[data-season="3"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#bar .seasons')).toHaveAttribute('aria-label', 'Saison : automne');
  // Molette : seuil 100 (cumul) ; vers le bas = suivante, vers le haut = précédente.
  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, 60);
  expect(await target()).toBe(2); // 60 < 100 : rien
  await page.mouse.wheel(0, 60);
  expect(await target()).toBe(3); // 120 ≥ 100 : hiver
  await page.waitForTimeout(100);
  await page.mouse.wheel(0, 300); // même geste (verrou) : ignoré
  expect(await target()).toBe(3);
  await page.waitForTimeout(700);
  await page.mouse.wheel(0, -120);
  expect(await target()).toBe(2);
  // Clavier sur un bouton de la barre : Entrée déclenche le bouton (natif), pas une action de la feuille.
  await page.focus('#bar .seasons button[data-season="1"]');
  await page.keyboard.press('Enter');
  expect(await target()).toBe(1);
  expect(await call(page, (j) => j.seasonInfo().moving)).toBe(true); // transition lancée, jamais de saut
  expect(errors).toEqual([]);
});

test('F-7 : la saison du lien s’applique sans transition ; Précédent la restitue', async ({ page }) => {
  await openGarden(page, '&quality=T2', '#g=1.9f3a12c4.3.');
  const info = await call(page, (j) => j.seasonInfo());
  expect(info.target).toBe(3);
  expect(info.weights).toEqual([0, 0, 0, 1]);
  expect(info.moving).toBe(false);
});

test('F-7 : les nouveaux porteurs sont de type 2 en été (réapparition), chute et part active selon la saison', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await openGarden(page, '&quality=T2&fx=1', '#g=1.9f3a12c4.0.');
  await call(page, (j) => j.setSeason(1, true));
  await call(page, (j) => j.setFall(60));
  await page.waitForTimeout(22_000); // chute accélérée (x 60 x 0,4 de l'été), repos de 2 à 6 s, fondu de 1 s, réapparition
  const p = await call(page, (j) => j.particles());
  const types: number[] = [];
  for (let i = 0; i < p.carriersB.length; i += 4) types.push(Math.round(p.carriersB[i + 3]!) % 8);
  const n2 = types.filter((t) => t === 2).length;
  console.info(`[J4] F-7 porteurs 22 s après le passage à l'été : ${n2}/${types.length} de type 2 (feuille d'été)`);
  expect(n2 / types.length).toBeGreaterThanOrEqual(0.85);
  expect((await call(page, (j) => j.seasonInfo())).part).toBeCloseTo(0.3, 6);
  await call(page, (j) => j.setSeason(2, true));
  expect((await call(page, (j) => j.seasonInfo())).part).toBeCloseTo(1, 6);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// F-8 PNG

for (const level of ['complet', 'reduit'] as const) {
  test(`F-8 PNG (${level}) : 12 plantes, barre visible et jauge ouverte → 3 840 x 2 160, ≤ 3 s, sceau, aucun pixel d’interface, nom du fichier`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors = watchErrors(page);
    await openGarden(page, (level === 'reduit' ? '&force=reduit' : '&quality=T2') + '', '#g=1.9f3a12c4.2.');
    await plantMany(page, 12);
    await call(page, (j) => j.step(1500));
    await page.waitForTimeout(400);
    // Barre visible (mouvement récent) et jauge ouverte (appui maintenu 1 s sur une zone vide, en haut à droite).
    await page.mouse.move(1500 * PX, 150 * PX);
    await page.mouse.down();
    await page.waitForFunction(() => document.getElementById('gauge')?.dataset.visible === '1', null, { timeout: 5000 });
    expect(await page.evaluate(() => (document.getElementById('bar') as HTMLElement).dataset.idle)).toBeUndefined();
    const barRect = await page.evaluate(() => {
      const r = (document.getElementById('bar') as HTMLElement).getBoundingClientRect();
      return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
    });
    const downloadA = page.waitForEvent('download', { timeout: 30_000 });
    await page.keyboard.press('p'); // « Garder ce jardin » au clavier, le doigt toujours appuyé
    const dl = await downloadA;
    expect(dl.suggestedFilename()).toBe('jardin-encre-9f3a12c4-automne.png');
    const info = (await call(page, (j) => j.lastExport()))!;
    // En-tête du PNG téléchargé : signature + IHDR (largeur, hauteur).
    const file = readFileSync((await dl.path())!);
    expect(file.subarray(1, 4).toString('latin1')).toBe('PNG');
    const wh = [file.readUInt32BE(16), file.readUInt32BE(20)];
    console.info(`[J4] F-8 PNG ${level} : ${wh[0]} x ${wh[1]}, fichier ${(file.length / 1e6).toFixed(1)} Mo, ${info.ms.toFixed(0)} ms (premier export, nuanceurs compris)`);
    expect(wh).toEqual([3840, 2160]);
    expect(info.width).toBe(3840);
    expect(info.height).toBe(2160);
    expect(info.ms).toBeLessThanOrEqual(3000);
    // Relâche en s'éloignant de plus de 12 px : le geste devient du vent, rien n'est planté (le jardin reste identique).
    await page.mouse.move(1500 * PX + 30, 150 * PX + 30);
    await page.mouse.up();
    expect(await call(page, (j) => j.plantTotal())).toBe(12);
    // Seconde capture, barre masquée après 3 s d'immobilité de la souris.
    await page.waitForFunction(() => (document.getElementById('bar') as HTMLElement).dataset.idle === '1', null, { timeout: 6000 });
    const downloadB = page.waitForEvent('download', { timeout: 30_000 });
    await page.keyboard.press('p');
    await downloadB;
    const margin = 6;
    const barUf = { name: 'barre', x0: (barRect.x0 - margin) / PX, y0: (barRect.y0 - margin) / PX, x1: (barRect.x1 + margin) / PX, y1: (barRect.y1 + margin) / PX };
    const jaugeUf = { name: 'jauge', x0: 1500 - 90, y0: 150 - 90, x1: 1500 + 90, y1: 150 + 140 };
    const a = await page.evaluate(`window.__jardin.analyzeExport({ index: 0, against: 1, regions: [${JSON.stringify(barUf)}, ${JSON.stringify(jaugeUf)},
      { name: 'sceau', x0: 1500, y0: 820, x1: 1544, y1: 864 }, { name: 'sceau-miroir', x0: 1500, y0: 36, x1: 1544, y1: 80 }, { name: 'sol', x0: 150, y0: 740, x1: 1500, y1: 880 }, { name: 'ciel', x0: 150, y0: 60, x1: 1300, y1: 160 }] })`) as Awaited<ReturnType<Hooks['analyzeExport']>>;
    const reg = Object.fromEntries(a.regions.map((r) => [r.name, r]));
    console.info(
      `[J4] F-8 ${level} : pixels qui diffèrent (barre + jauge visibles / masquées) : image ${(a.diffAllFrac! * 100).toFixed(3)} %, zone de la barre ${(reg.barre!.diffFrac * 100).toFixed(3)} %, zone de la jauge ${(reg.jauge!.diffFrac * 100).toFixed(3)} % ; ` +
        `sceau rouge ${(reg.sceau!.redFrac * 100).toFixed(0)} % (miroir ${(reg['sceau-miroir']!.redFrac * 100).toFixed(0)} %), blancs purs ${a.whitePct.toFixed(3)} %, pixels translucides ${a.translucent}`,
    );
    expect(a.w).toBe(3840);
    expect(a.h).toBe(2160);
    expect(a.translucent).toBe(0); // opaque
    expect(a.whitePct).toBeLessThan(0.5);
    // Le sceau est en bas à droite (1500, 820), pas en haut : orientation correcte.
    expect(reg.sceau!.redFrac).toBeGreaterThan(0.4);
    expect(reg['sceau-miroir']!.redFrac).toBeLessThan(0.01);
    // Le jardin (encre sombre) est en bas, le haut est du papier.
    expect(reg.sol!.darkFrac).toBeGreaterThan(reg.ciel!.darkFrac);
    // Aucun pixel d'interface : avec la barre et la jauge visibles ou non, l'image est la même (tolérance : respiration du papier).
    expect(reg.barre!.diffFrac).toBeLessThan(0.002);
    expect(reg.jauge!.diffFrac).toBeLessThan(0.002);
    expect(a.diffAllFrac!).toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });
}

test('F-8 PNG : taille réduite à la limite du GPU et plan B (rendu hors écran en échec)', async ({ page }) => {
  test.setTimeout(90_000);
  // Limite de texture simulée à 2048 : largeur 2048, hauteur 1152 (SPEC §8).
  // (requiredLimits ne peut pas descendre sous la valeur par défaut : on déguise la limite lue par l'application.)
  await page.addInitScript(() => {
    if (typeof GPUDevice === 'undefined') return; // about:blank : pas de contexte sécurisé
    const d = Object.getOwnPropertyDescriptor(GPUDevice.prototype, 'limits')!;
    Object.defineProperty(GPUDevice.prototype, 'limits', {
      get() {
        const l = d.get!.call(this) as GPUSupportedLimits;
        return new Proxy(l, { get: (t, k) => (k === 'maxTextureDimension2D' ? 2048 : (t as unknown as Record<string | symbol, unknown>)[k]) });
      },
    });
  });
  const errors = watchErrors(page);
  await openGarden(page, '&quality=T2');
  await plantMany(page, 3);
  const r = await call(page, (j) => j.keep());
  console.info(`[J4] F-8 limite GPU simulée à 2048 : export ${r!.width} x ${r!.height}`);
  expect([r!.width, r!.height]).toEqual([2048, 1152]);
  expect(r!.fallback).toBe(false);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// F-8 lien

async function reopen(browser: Browser, link: string, extra = '') {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  const u = new URL(link);
  await page.goto(`${u.origin}${u.pathname}?test=1${extra}${u.hash}`);
  await page.waitForFunction(() => (window as unknown as { __jardin?: Hooks }).__jardin?.ready() === true, null, { timeout: 30_000 });
  return { ctx, page, errors };
}

for (const level of ['complet', 'reduit'] as const) {
  test(`F-8 lien (${level}) : « Copier le lien » met l’URL #g=1.… dans le presse-papiers ; contexte neuf : même gardenHash(), même ordre, même saison`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'fr-FR', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    const q = level === 'reduit' ? '&force=reduit' : '&quality=T2';
    await openGarden(page, q, '#g=1.9f3a12c4.0.');
    await plantMany(page, 12);
    await page.keyboard.press('s');
    await page.keyboard.press('s'); // automne
    await call(page, (j) => j.step(600));
    await page.waitForTimeout(600);
    await wake(page);
    await page.click('#b-link'); // le vrai bouton
    await expect(page.locator('#notice')).toHaveText('Lien copié');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const h1 = await call(page, (j) => j.gardenHash());
    const order1 = await call(page, (j) => j.plantHashes());
    expect(clip).toMatch(/^http:\/\/localhost:\d+\/#g=1\.9f3a12c4\.2\.[A-Za-z0-9_-]{48}$/); // 12 plantes x 4 caractères, aucune requête (?test, ?force)
    expect(clip).toBe(await call(page, (j) => j.link()));
    expect(clip).not.toContain('?');
    // Contexte neuf (aucun stockage, aucun cache) : mêmes plantes, même saison, dans le même ordre.
    const t0 = Date.now();
    const { ctx: ctx2, page: p2, errors: e2 } = await reopen(page.context().browser()!, clip, level === 'reduit' ? '&force=reduit' : '&quality=T2');
    await p2.waitForFunction(() => {
      const j = (window as unknown as { __jardin: Hooks }).__jardin;
      return j.metrics().plants === 12;
    }, null, { timeout: 60_000 });
    const reopenMs = Date.now() - t0;
    const h2 = await call(p2, (j) => j.gardenHash());
    const order2 = await call(p2, (j) => j.plantHashes());
    const info2 = await call(p2, (j) => j.seasonInfo());
    console.info(`[J4] F-8 lien ${level} : gardenHash ${h1} → ${h2} (contexte neuf, 12 plantes repoussées en ${reopenMs} ms), saison ${info2.target}`);
    expect(h2).toBe(h1);
    expect(order2).toEqual(order1);
    expect(info2.target).toBe(2);
    expect(info2.weights).toEqual([0, 0, 1, 0]);
    expect(e2).toEqual([]);
    await ctx2.close();
    expect(errors).toEqual([]);
    await ctx.close();
  });
}

test('F-8 lien : presse-papiers refusé → champ de texte avec l’URL sélectionnée, Échap le ferme', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('refusé', 'NotAllowedError')) }, configurable: true });
  });
  await openGarden(page, '&quality=T2');
  await plantMany(page, 2);
  await page.keyboard.press('l');
  const field = page.locator('#link-field-input');
  await expect(field).toBeVisible();
  const v = await field.inputValue();
  expect(v).toBe(await call(page, (j) => j.link()));
  expect(v).toMatch(/#g=1\.9f3a12c4\.0\.[A-Za-z0-9_-]{8}$/);
  const sel = await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd, el.value.length]);
  expect(sel).toEqual([0, sel[2], sel[2]]); // tout est sélectionné
  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('lien abîmé, version future ou absent : feuille vide, message, jamais d’écran d’erreur ni d’erreur console', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const bad = [
    '#g=1.9f3a12c.0.', // graine trop courte
    '#g=1.9f3a12c4.7.',
    '#g=1.9f3a12c4.0.ZBj', // longueur
    '#g=1.9f3a12c4.0.ZB*A',
    '#g=1.9f3a12c4.0.____', // hors feuille
    '#g=1.9f3a12c4.0.' + 'ZBjA'.repeat(161), // plus de 160 plantes
    '#g=garbage',
    '#g=1',
  ];
  for (const frag of bad) {
    await openGarden(page, '&quality=T2', frag);
    expect(await call(page, (j) => j.plantTotal()), frag).toBe(0);
    await expect(page.locator('#notice'), frag).toHaveText('Lien illisible : nouvelle feuille');
    await expect(page.locator('#refus')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.dataset.niveau)).toBe('complet');
    expect(page.url(), frag).toMatch(/#g=1\.[0-9a-f]{8}\.0\.$/); // l'adresse est remise à une feuille neuve valide
  }
  await openGarden(page, '&quality=T2', '#g=2.9f3a12c4.0.ZBjA');
  await expect(page.locator('#notice')).toHaveText("Ce lien vient d'une version plus récente");
  expect(await call(page, (j) => j.plantTotal())).toBe(0);
  // Pas de fragment du tout, ou fragment étranger : feuille neuve sans message.
  await openGarden(page, '&quality=T2', '');
  await page.waitForTimeout(300);
  await expect(page.locator('#notice')).toBeHidden();
  expect(page.url()).toMatch(/#g=1\.[0-9a-f]{8}\.0\.$/);
  await openGarden(page, '&quality=T2', '#autre');
  await expect(page.locator('#notice')).toBeHidden();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// F-10 nouvelle feuille

test('F-10 : 4 plantes → aucune confirmation ; 1 200 ms de fondu, nouvelle graine, entrée empilée ; Précédent rend l’ancien jardin avec le même hash', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await openGarden(page, '&quality=T2');
  await plantMany(page, 4);
  await page.keyboard.press('s');
  await call(page, (j) => j.step(900));
  await page.waitForTimeout(700);
  const h1 = await call(page, (j) => j.gardenHash());
  const url1 = page.url();
  const len1 = await page.evaluate(() => history.length);
  await wake(page);
  await page.click('#b-new');
  expect(await page.locator('dialog[open]').count()).toBe(0); // sous le seuil de 5 : pas de confirmation
  await page.waitForTimeout(500);
  expect(await call(page, (j) => j.plantTotal())).toBe(4); // le fondu n'est pas fini
  await page.waitForFunction(() => (window as unknown as { __jardin: Hooks }).__jardin.plantTotal() === 0, null, { timeout: 5000 });
  const url2 = page.url();
  expect(url2).not.toBe(url1);
  expect(url2).toMatch(/#g=1\.[0-9a-f]{8}\.0\.$/); // nouvelle graine, printemps, aucune plante
  expect(await page.evaluate(() => history.length)).toBe(len1 + 1); // entrée empilée
  expect(await call(page, (j) => j.gardenHash())).not.toBe(h1);
  // Plante sur la nouvelle feuille, puis Précédent : l'ancien jardin revient, mêmes plantes, même saison.
  await page.goBack();
  await page.waitForFunction(() => (window as unknown as { __jardin: Hooks }).__jardin.metrics().plants === 4, null, { timeout: 30_000 });
  await page.waitForTimeout(400);
  expect(page.url()).toBe(url1);
  expect(await call(page, (j) => j.gardenHash())).toBe(h1);
  expect((await call(page, (j) => j.seasonInfo())).target).toBe(1);
  // Suivant : la feuille vide.
  await page.goForward();
  await page.waitForFunction(() => (window as unknown as { __jardin: Hooks }).__jardin.plantTotal() === 0, null, { timeout: 10_000 });
  expect(page.url()).toBe(url2);
  expect(errors).toEqual([]);
});

test('F-10 : dès 5 plantes, boîte de confirmation (focus sur « Annuler », « Copier le lien d’abord »), Échap annule, confirmer efface en 1 200 ms', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'fr-FR', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await openGarden(page, '&quality=T2');
  await plantMany(page, 5);
  await page.waitForTimeout(600);
  const h1 = await call(page, (j) => j.gardenHash());
  const url1 = page.url();
  await page.keyboard.press('n');
  // `dialog` sans [open] : la boîte n'est retirée du document qu'à l'événement `close` (après l'attribut open).
  const dialog = page.locator('dialog');
  await expect(dialog).toHaveCount(1);
  await expect(dialog.locator('h2')).toHaveText('Recommencer sur une nouvelle feuille ?');
  await expect(page.locator('#jd-cancel')).toBeFocused();
  expect(await dialog.locator('button').allTextContents()).toEqual(['Annuler', "Copier le lien d'abord", 'Effacer et recommencer']);
  // Échap : annule, rien ne change.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await call(page, (j) => j.plantTotal())).toBe(5);
  expect(page.url()).toBe(url1);
  // Les raccourcis sont inactifs derrière la boîte : S ne change pas la saison.
  await page.keyboard.press('n');
  await expect(page.locator('#jd-cancel')).toBeFocused();
  await page.keyboard.press('s');
  expect((await call(page, (j) => j.seasonInfo())).target).toBe(0);
  // « Copier le lien d'abord » : le lien est copié, la boîte reste ouverte.
  await page.click('#jd-copy');
  await expect(page.locator('#jd-copy')).toHaveText('Lien copié');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url1.replace('?test=1&quality=T2', ''));
  await expect(dialog).toHaveCount(1);
  // Annuler (bouton) : rien ne change.
  await page.click('#jd-cancel');
  await expect(dialog).toHaveCount(0);
  expect(await call(page, (j) => j.plantTotal())).toBe(5);
  // Confirmer : l'encre s'efface en 1 200 ms, nouvelle graine, URL empilée.
  const len1 = await page.evaluate(() => history.length);
  await page.keyboard.press('n');
  const t0 = Date.now();
  await page.click('#jd-ok');
  await page.waitForTimeout(500);
  expect(await call(page, (j) => j.plantTotal())).toBe(5); // encore en fondu
  await page.waitForFunction(() => (window as unknown as { __jardin: Hooks }).__jardin.plantTotal() === 0, null, { timeout: 5000 });
  const fadeMs = Date.now() - t0;
  console.info(`[J4] F-10 : confirmation → feuille vide en ${fadeMs} ms (fondu de 1 200 ms) ; entrée d'historique ${len1} → ${await page.evaluate(() => history.length)}`);
  expect(fadeMs).toBeGreaterThanOrEqual(1100);
  expect(fadeMs).toBeLessThan(2500);
  expect(await page.evaluate(() => history.length)).toBe(len1 + 1);
  await page.goBack();
  await page.waitForFunction(() => (window as unknown as { __jardin: Hooks }).__jardin.metrics().plants === 5, null, { timeout: 30_000 });
  expect(await call(page, (j) => j.gardenHash())).toBe(h1);
  expect(errors).toEqual([]);
  await ctx.close();
});

// ---------------------------------------------------------------------------------------------
// Barre, langue, mouvement réduit, stockage

test('barre : vrais boutons nommés (FR puis EN), focus visible, masquée après 3 s sans mouvement, réapparaît, langue gardée', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await openGarden(page, '&quality=T2');
  const bar = page.locator('#bar');
  await expect(bar).toHaveAttribute('role', 'toolbar');
  const buttons = bar.locator('button');
  expect(await buttons.count()).toBe(13); // J5 : planter, vent, 4 saisons, son, garder, lien, nouvelle feuille, plein écran, FR, EN (9 au J4)
  for (let i = 0; i < 13; i++) {
    const b = buttons.nth(i);
    expect(await b.evaluate((el) => el.tagName)).toBe('BUTTON');
    expect((await b.getAttribute('aria-label'))!.length).toBeGreaterThan(1);
  }
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('fr');
  await expect(page.locator('#b-keep')).toHaveAttribute('aria-label', 'Garder ce jardin (PNG)');
  await expect(page.locator('#b-keep')).toHaveAttribute('title', 'Garder ce jardin (P)');
  await expect(page.locator('#b-link')).toHaveAttribute('aria-label', 'Copier le lien');
  await expect(page.locator('#b-new')).toHaveAttribute('aria-label', 'Nouvelle feuille');
  // Focus visible : contour de 2 px sumi décalé de 2 px (SPEC §7.2) au clavier.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab'); // J5 : feuille, planter, vent, puis le premier point de saison
  const focus = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    return { id: el.id, season: el.dataset.season, w: cs.outlineWidth, c: cs.outlineColor, o: cs.outlineOffset, style: cs.outlineStyle };
  });
  expect(focus.season).toBe('0');
  expect([focus.w, focus.c, focus.o, focus.style]).toEqual(['2px', 'rgb(30, 36, 48)', '2px', 'solid']);
  // FR · EN : les libellés, les infobulles et <html lang> changent ; la préférence est écrite.
  await wake(page);
  await page.click('#bar button[data-lang="en"]');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(page.locator('#b-keep')).toHaveAttribute('aria-label', 'Keep this garden (PNG)');
  await expect(page.locator('#b-link')).toHaveAttribute('title', 'Copy link (L)');
  await expect(page.locator('#b-new')).toHaveAttribute('aria-label', 'New sheet');
  await expect(page.locator('#bar .seasons')).toHaveAttribute('aria-label', 'Season : spring');
  await expect(page.locator('#bar button[data-lang="en"]')).toHaveAttribute('aria-pressed', 'true');
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('jardin-encre.v1.prefs')))!).lang).toBe('en');
  // Masquage après 3 s d'immobilité de la souris ; réapparition au moindre mouvement.
  await page.mouse.move(700, 300);
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => (document.getElementById('bar') as HTMLElement).dataset.idle)).toBeUndefined();
  await page.waitForTimeout(1200); // 3,7 s
  expect(await page.evaluate(() => (document.getElementById('bar') as HTMLElement).dataset.idle)).toBe('1');
  await page.waitForTimeout(1200);
  expect(await bar.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await page.mouse.move(720, 320);
  expect(await page.evaluate(() => (document.getElementById('bar') as HTMLElement).dataset.idle)).toBeUndefined();
  await page.waitForTimeout(1200);
  expect(Number(await bar.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.9);
  // La langue est gardée au rechargement.
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __jardin?: Hooks }).__jardin?.ready() === true);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(page.locator('#b-link')).toHaveAttribute('aria-label', 'Copy link');
  expect(errors).toEqual([]);
});

test('barre : fenêtre étroite (400 x 700), la barre tient dans l’écran sur plusieurs lignes', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await openGarden(page, '&quality=T2');
  const r = await page.evaluate(() => {
    const b = (document.getElementById('bar') as HTMLElement).getBoundingClientRect();
    return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: innerWidth, h: innerHeight };
  });
  expect(r.l).toBeGreaterThanOrEqual(0);
  expect(r.r).toBeLessThanOrEqual(r.w);
  expect(r.b).toBeLessThanOrEqual(r.h);
  expect(r.b - r.t).toBeGreaterThan(40); // plusieurs lignes
});

test('mouvement réduit : le lien repousse d’un coup, la transition de saison est gardée', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'fr-FR', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  // 12 plantes écrites à la main dans un lien : ouverture instantanée (sinon 12 x 150 ms = 1,8 s).
  const link = await (async () => {
    const p0 = await ctx.newPage();
    await p0.goto('/?test=1&quality=T2#g=1.9f3a12c4.1.');
    await p0.waitForFunction(() => (window as unknown as { __jardin?: Hooks }).__jardin?.ready() === true);
    for (const [x, y, e] of PLANTS) await p0.evaluate(([x, y, e]) => (window as unknown as { __jardin: Hooks }).__jardin.plant(x!, y!, e!), [x, y, e]);
    const l = await call(p0, (j) => j.link());
    await p0.close();
    return l;
  })();
  const u = new URL(link);
  await page.goto(`${u.origin}${u.pathname}?test=1&quality=T2${u.hash}`);
  await page.waitForFunction(() => (window as unknown as { __jardin?: Hooks }).__jardin?.ready() === true);
  await page.waitForTimeout(500);
  const m = await call(page, (j) => j.metrics());
  expect(m.plants).toBe(12); // d'un coup
  expect((await call(page, (j) => j.seasonInfo())).weights).toEqual([0, 1, 0, 0]);
  await page.keyboard.press('s');
  await page.waitForTimeout(1200);
  const w = (await call(page, (j) => j.seasonInfo())).weights;
  expect(w[2]).toBeGreaterThan(0.05); // la transition (été → automne) est conservée (SPEC §11)
  expect(w[2]).toBeLessThan(0.95);
  expect(await page.locator('#bar').evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('stockage bloqué : aucune erreur, langue et saison fonctionnent, préférences en mémoire seulement', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Stockage bloqué', 'SecurityError');
      },
      configurable: true,
    });
  });
  await openGarden(page, '', '#g=1.9f3a12c4.0.');
  await page.waitForTimeout(300);
  await wake(page);
  await page.click('#bar button[data-lang="en"]');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(page.locator('#b-new')).toHaveAttribute('aria-label', 'New sheet');
  await page.keyboard.press('q'); // le contrôleur de qualité écrit sa préférence : toléré
  await page.keyboard.press('s');
  expect((await call(page, (j) => j.seasonInfo())).target).toBe(1);
  await plantMany(page, 2);
  await page.waitForTimeout(700);
  expect(page.url()).toMatch(/#g=1\.9f3a12c4\.1\.[A-Za-z0-9_-]{8}$/);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Les trois niveaux : aucune erreur console au chargement avec le code du J4

for (const [level, query] of [['complet', ''], ['reduit', '&force=reduit'], ['refus', '&force=refus']] as const) {
  test(`aucune erreur console au chargement (${level}), barre présente sauf en refus`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('about:blank');
    await page.goto(`/?test=1${query}#g=1.9f3a12c4.2.ZBjA`);
    await page.waitForTimeout(4000);
    expect(await page.evaluate(() => document.documentElement.dataset.niveau)).toBe(level);
    expect(await page.locator('#bar').count()).toBe(level === 'refus' ? 0 : 1);
    expect(errors).toEqual([]);
  });
}

test('reduit : saison, lien rouvert (même gardenHash) et PNG, sans interface', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'fr-FR', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await openGarden(page, '&force=reduit', '#g=1.9f3a12c4.0.');
  expect((await call(page, (j) => j.metrics())).backend).toBe('webgl');
  await plantMany(page, 6);
  await page.keyboard.press('s');
  await page.waitForTimeout(4100);
  expect((await call(page, (j) => j.seasonInfo())).weights).toEqual([0, 1, 0, 0]);
  await wake(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#b-keep')]);
  expect(dl.suggestedFilename()).toBe('jardin-encre-9f3a12c4-été.png');
  const e = (await call(page, (j) => j.lastExport()))!;
  console.info(`[J4] reduit : PNG ${e.width} x ${e.height} en ${e.ms.toFixed(0)} ms`);
  expect([e.width, e.height]).toEqual([3840, 2160]);
  const h1 = await call(page, (j) => j.gardenHash());
  const link = await call(page, (j) => j.link());
  await ctx.close();
  const { ctx: c2, page: p2, errors: e2 } = await reopen(browser, link, '&force=reduit');
  await p2.waitForFunction(() => (window as unknown as { __jardin: Hooks }).__jardin.metrics().plants === 6, null, { timeout: 60_000 });
  expect((await call(p2, (j) => j.metrics())).backend).toBe('webgl');
  expect(await call(p2, (j) => j.gardenHash())).toBe(h1);
  expect((await call(p2, (j) => j.seasonInfo())).target).toBe(1);
  expect(e2).toEqual([]);
  expect(errors).toEqual([]);
  await c2.close();
});

test('160 plantes : « La feuille est pleine », plantation refusée, lien de 160 plantes (640 caractères)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await openGarden(page, '&quality=T2');
  await page.evaluate(() => {
    const j = (window as unknown as { __jardin: Hooks }).__jardin;
    for (let i = 0; i < 160; i++) j.plant(40 + (i % 16) * 95, 790 + Math.floor(i / 16) * 8, i % 5);
  });
  expect(await call(page, (j) => j.plantTotal())).toBe(160);
  await page.mouse.click(700, 300); // appui sur la feuille : refusé, avec un message
  await expect(page.locator('#notice')).toHaveText('La feuille est pleine');
  expect(await call(page, (j) => j.plantTotal())).toBe(160);
  const link = await call(page, (j) => j.link());
  expect(link.split('#g=1.')[1]!.split('.')[2]!.length).toBe(640);
  expect(errors).toEqual([]);
});

test('F-8 PNG : plan B (canvas 2D refusé au rendu hors écran) → capture du canvas à la taille de l’écran, fichier valide', async ({ page }) => {
  test.setTimeout(90_000);
  // Le premier `getContext('2d')` échoue (l'export hors écran est son premier usage) : le plan B de la SPEC §8 prend le relais.
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    let failed = false;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === '2d' && !failed) {
        failed = true;
        return null;
      }
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await openGarden(page, '&quality=T2');
  await plantMany(page, 3);
  await call(page, (j) => j.step(900));
  await page.waitForTimeout(300);
  const dl = page.waitForEvent('download', { timeout: 30_000 });
  await page.keyboard.press('p');
  const d = await dl;
  const r = (await call(page, (j) => j.lastExport()))!;
  console.info(`[J4] F-8 plan B : ${r.width} x ${r.height} en ${r.ms.toFixed(0)} ms, fallback=${r.fallback}`);
  expect(r.fallback).toBe(true);
  expect([r.width, r.height]).toEqual([1920, 1080]); // taille de l'écran (ratio 1)
  expect(d.suggestedFilename()).toBe('jardin-encre-9f3a12c4-printemps.png');
  const a = await page.evaluate(`window.__jardin.analyzeExport({ index: 0, regions: [{ name: 'sol', x0: 150, y0: 740, x1: 1500, y1: 880 }, { name: 'ciel', x0: 150, y0: 60, x1: 1300, y1: 160 }] })`) as Awaited<ReturnType<Hooks['analyzeExport']>>;
  expect(a.mean[0]!).toBeGreaterThan(200); // du papier (pas une image noire ni blanche)
  expect(a.whitePct).toBeLessThan(1);
  expect(a.regions[0]!.darkFrac).toBeGreaterThan(a.regions[1]!.darkFrac);
});
