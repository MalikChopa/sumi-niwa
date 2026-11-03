// Correctif G1 : indicateur du vent sous le curseur (maquette A écran 2, « curseur-vent »). En `?test=1` il est masqué par
// défaut ; `&windring=1` l'affiche. Edge installé, headless, 1920 x 1080 (1,2 px par uf).
import { test, expect, type Page } from '@playwright/test';

test.use({ locale: 'fr-FR' });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return errors;
}

type H = {
  ready(): boolean;
  plantTotal(): number;
  keep(): Promise<{ name: string } | null>;
  analyzeExport(a: unknown): Promise<{ regions: { name: string; diffFrac: number; darkFrac: number }[] }>;
};
async function open(page: Page, query: string) {
  await page.goto('about:blank');
  await page.goto(`/?test=1${query}#g=1.9f3a12c4.0.`);
  await page.waitForFunction(() => (window as unknown as { __jardin?: H }).__jardin?.ready() === true, null, { timeout: 30_000 });
  await page.waitForTimeout(300);
}
const ring = (page: Page) =>
  page.evaluate(() => {
    const e = document.getElementById('windring');
    return e ? { op: Number(e.style.opacity || '0'), vis: e.dataset.visible ?? '', tf: e.style.transform } : null;
  });
const LEVELS = [
  { level: 'complet', q: '&windring=1&quality=T2' },
  { level: 'reduit', q: '&windring=1&force=reduit' },
] as const;

for (const L of LEVELS) {
  test(`indicateur du vent (${L.level}) : visible quand la souris bouge, fondu lent ensuite, ne capte aucun clic, aria-hidden, à l'échelle de la feuille`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    await open(page, L.q);
    const el = page.locator('#windring');
    expect(await el.getAttribute('aria-hidden')).toBe('true');
    expect(await el.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    expect((await ring(page))!.op).toBe(0); // au repos, rien
    // 3 cercles de la maquette, rayons 11, 2,4 et 36 uf
    expect(await el.locator('circle').evaluateAll((cs) => cs.map((c) => c.getAttribute('r')))).toEqual(['11', '2.4', '36']);
    expect(await el.locator('circle').nth(2).getAttribute('stroke-dasharray')).toBe('3 6');
    // le mouvement l'affiche, centré sous le pointeur
    for (let i = 0; i < 6; i++) await page.mouse.move(600 + i * 12, 400 + i * 6);
    const r = (await ring(page))!;
    expect(r.op).toBeGreaterThan(0.95);
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(r.tf)!;
    expect(Math.abs(Number(m[1]) - 660)).toBeLessThan(1.5);
    expect(Math.abs(Number(m[2]) - 430)).toBeLessThan(1.5);
    // échelle : anneau de rayon 36 uf, soit 76 uf de large avec la marge, × 1,2 px
    const box = (await el.boundingBox())!;
    expect(Math.abs(box.width - 76 * 1.2)).toBeLessThan(1);
    expect(Math.abs(box.x + box.width / 2 - 660)).toBeLessThan(1.5);
    // fondu : on échantillonne l'opacité jusqu'à zéro
    const seen: number[] = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 1600) {
      seen.push((await ring(page))!.op);
      await page.waitForTimeout(40);
    }
    const mid = seen.filter((v) => v > 0.05 && v < 0.95);
    console.info(`[J5] G1 ${L.level} : ${seen.length} échantillons d'opacité en 1,6 s, ${mid.length} valeurs intermédiaires, dernière ${seen[seen.length - 1]}`);
    expect(mid.length).toBeGreaterThanOrEqual(5); // fondu lent, pas un saut
    expect(seen[seen.length - 1]).toBe(0);
    // il ne capte aucun clic : un clic à l'endroit où il est plante, et l'appui le masque
    await page.mouse.move(700, 800);
    await page.mouse.move(704, 802);
    await page.mouse.down();
    expect((await ring(page))!.op).toBe(0);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __jardin: H }).__jardin.plantTotal())).toBe(1);
    // pas de focus volé
    expect(await page.evaluate(() => document.activeElement?.id === 'windring')).toBe(false);
    // toucher : pas de curseur, donc pas d'indicateur (événement synthétique de type touch)
    await page.evaluate(() => document.getElementById('stage')!.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', isPrimary: true, clientX: 300, clientY: 300, bubbles: true })));
    expect((await ring(page))!.op).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('indicateur du vent : absent en mode contemplatif, absent de l\'image PNG gardée, masqué par défaut en ?test=1', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await open(page, '&quality=T2'); // sans &windring=1
  await expect(page.locator('#windring')).toHaveCount(0);
  await open(page, '&windring=1&quality=T2');
  const x = 960;
  const y = 540;
  // PNG : on garde le jardin pendant que l'indicateur est affiché (mouvements synthétiques toutes les 50 ms), puis une fois masqué.
  await page.evaluate(
    ([x, y]) => {
      const stage = document.getElementById('stage')!;
      const w = window as unknown as { __ringTimer: number };
      w.__ringTimer = window.setInterval(() => stage.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', isPrimary: true, clientX: x!, clientY: y!, bubbles: true })), 50);
    },
    [x, y],
  );
  await page.waitForTimeout(200);
  expect((await ring(page))!.op).toBeGreaterThan(0.95);
  await page.evaluate(() => (window as unknown as { __jardin: H }).__jardin.keep());
  const during = (await ring(page))!.op;
  await page.evaluate(() => window.clearInterval((window as unknown as { __ringTimer: number }).__ringTimer));
  await page.waitForTimeout(1300);
  expect((await ring(page))!.op).toBe(0);
  await page.evaluate(() => (window as unknown as { __jardin: H }).__jardin.keep());
  // zone de l'indicateur en uf : centre (800, 450), rayon 38
  const a = await page.evaluate(
    () => (window as unknown as { __jardin: H }).__jardin.analyzeExport({ index: 1, against: 0, regions: [{ name: 'anneau', x0: 760, y0: 410, x1: 840, y1: 490 }] }),
  );
  console.info(`[J5] G1 PNG : indicateur à l'écran pendant l'export (opacité ${during.toFixed(2)}), différence entre les deux PNG dans sa zone : ${(a.regions[0]!.diffFrac * 100).toFixed(3)} % des pixels`);
  expect(during).toBeGreaterThan(0.5);
  expect(a.regions[0]!.diffFrac).toBe(0);
  // mode contemplatif : l'indicateur ne s'affiche plus
  await page.locator('#stage').focus();
  await page.keyboard.press('c');
  await page.waitForTimeout(300);
  for (let i = 0; i < 6; i++) await page.mouse.move(500 + i * 15, 500 + i * 7);
  expect((await ring(page))!.op).toBe(0);
  await page.keyboard.press('x'); // sortie
  await page.waitForTimeout(300);
  for (let i = 0; i < 6; i++) await page.mouse.move(520 + i * 15, 520 + i * 7);
  expect((await ring(page))!.op).toBeGreaterThan(0.95); // revenu après la sortie
  expect(errors).toEqual([]);
});

test('indicateur du vent : mouvement réduit = affiché puis masqué net, sans valeur intermédiaire', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '&windring=1&quality=T2');
  for (let i = 0; i < 5; i++) await page.mouse.move(600 + i * 12, 400 + i * 6);
  const seen: number[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 900) {
    seen.push((await ring(page))!.op);
    await page.waitForTimeout(30);
  }
  expect(seen[0]).toBe(1);
  expect(seen[seen.length - 1]).toBe(0);
  expect(seen.every((v) => v === 0 || v === 1)).toBe(true);
});
