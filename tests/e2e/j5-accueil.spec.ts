// Correctif J5 : écran d'ouverture (maquette A écran 1, SPEC §8 `jardin-encre.v1.accueil`, §11 stockage bloqué).
// En `?test=1` il est masqué par défaut ; `&welcome=1` l'affiche. Edge installé, headless.
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

type H = { ready(): boolean; plantTotal(): number };
async function open(page: Page, query: string, hash = '#g=1.9f3a12c4.0.') {
  await page.goto('about:blank');
  await page.goto(`/?test=1${query}${hash}`);
  await page.waitForFunction(() => (window as unknown as { __jardin?: H }).__jardin?.ready() === true, null, { timeout: 30_000 });
  await page.waitForTimeout(400);
}
const plants = (page: Page) => page.evaluate(() => (window as unknown as { __jardin: H }).__jardin.plantTotal());

const LEVELS = [
  { level: 'complet', q: '&welcome=1&quality=T2' },
  { level: 'reduit', q: '&welcome=1&force=reduit' },
] as const;

for (const L of LEVELS) {
  test(`accueil (${L.level}) : affiché sur feuille vide, ne capte pas le clic, disparaît à la première plantation, mémorisé, ne revient pas`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    await open(page, L.q);
    const w = page.locator('#welcome');
    await expect(w.locator('.t1')).toBeVisible();
    await expect(w.locator('.t1')).toHaveText('Clique pour planter');
    await expect(w.locator('.t2')).toHaveText('Click to plant');
    expect(await w.getAttribute('role')).toBe('status');
    expect(await w.getAttribute('aria-live')).toBe('polite');
    expect(await w.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    // centre de la graine : (800, 430) uf = (960, 516) px à 1920 x 1080
    const box = await w.evaluate((el) => {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec((el as HTMLElement).style.transform)!;
      return [Number(m[1]), Number(m[2])];
    });
    expect(Math.abs(box[0]! - 960)).toBeLessThan(2);
    expect(Math.abs(box[1]! - 516)).toBeLessThan(2);
    // pas de focus volé
    expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement === null)).toBe(true);
    // deux anneaux qui pulsent (désactivé en mouvement réduit, voir plus bas)
    expect(await w.locator('.ring').count()).toBe(2);
    // contraste du texte (couleur lue dans la page, composée sur le washi)
    const col = await w.locator('.t1').evaluate((el) => getComputedStyle(el).color);
    const m = /rgba?\(([^)]+)\)/.exec(col)![1]!.split(',').map(Number);
    const a = m[3] ?? 1;
    const fg = [0, 1, 2].map((i) => m[i]! * a + [243, 236, 221][i]! * (1 - a));
    const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
    const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
    const ratio = (lum([243, 236, 221]) + 0.05) / (lum(fg) + 0.05);
    console.info(`[J5] accueil ${L.level} : couleur du texte ${col}, contraste ${ratio.toFixed(2)}:1 sur le washi (≥ 4,5)`);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    // Un clic à travers le message plante (il n'intercepte rien) et le fait disparaître.
    await page.mouse.click(960, 516);
    await expect.poll(() => plants(page)).toBe(1);
    await expect(w.locator('.t1')).toBeHidden({ timeout: 4000 });
    expect(await w.getAttribute('aria-hidden')).toBe('true');
    expect(await page.evaluate(() => window.localStorage.getItem('jardin-encre.v1.accueil'))).toBe('1');
    // Rechargé (même contexte) : il ne revient pas.
    await open(page, L.q);
    await expect(page.locator('#welcome')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('accueil : masqué par défaut en ?test=1, absent si le lien ouvre un jardin non vide, texte anglais selon la langue', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '&quality=T2'); // sans &welcome=1
  await expect(page.locator('#welcome')).toHaveCount(0);
  await open(page, '&welcome=1&quality=T2', '#g=1.9f3a12c4.0.ZBjA'); // un bambou : jardin non vide
  await expect(page.locator('#welcome')).toHaveCount(0);
  await open(page, '&welcome=1&quality=T2');
  await expect(page.locator('#welcome .t1')).toHaveText('Clique pour planter');
  await page.mouse.move(960, 500);
  await page.mouse.move(964, 504);
  await page.click('#bar [data-lang="en"]');
  await expect(page.locator('#welcome .t1')).toHaveText('Click to plant');
  await expect(page.locator('#welcome .t2')).toHaveText('Clique pour planter');
  expect(errors).toEqual([]);
});

test('accueil : mouvement réduit = anneaux sans animation (opacité 0,25 comme la maquette)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '&welcome=1&quality=T2');
  const r = await page.locator('#welcome .ring').first().evaluate((el) => ({ anim: getComputedStyle(el).animationName, op: getComputedStyle(el).opacity }));
  expect(r.anim).toBe('none');
  expect(Number(r.op)).toBeCloseTo(0.25, 2);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => page.locator('#welcome .ring').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('wpulse');
});

test('accueil : stockage bloqué = il revient à chaque visite, sans erreur', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  await open(page, '&welcome=1&quality=T2');
  await expect(page.locator('#welcome .t1')).toBeVisible();
  await page.mouse.click(960, 516);
  await expect.poll(() => plants(page)).toBe(1);
  await expect(page.locator('#welcome .t1')).toBeHidden({ timeout: 4000 });
  await open(page, '&welcome=1&quality=T2');
  await expect(page.locator('#welcome .t1')).toBeVisible(); // pas de mémoire : il revient
  expect(errors).toEqual([]);
});
