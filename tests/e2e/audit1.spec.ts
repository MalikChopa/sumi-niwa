// Correction de l'audit J6 (docs/AUDIT_V1.md), points 7 à 12 et 14 : un test déterministe (pas de seuil de temps) par défaut corrigé.
// Playwright pilote Edge installé (msedge), headless ; construction de TEST (crochets actifs). Interface en français.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const J = <R>(page: Page, f: (j: any) => R | Promise<R>) => page.evaluate(`(async () => { const j = window.__jardin; return await (${f.toString()})(j); })()`) as Promise<R>;

async function openGarden(page: Page, query = '', hash = '#g=1.9f3a12c4.0.'): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`/?test=1${query}${hash}`);
  await page.waitForFunction(() => (window as unknown as { __jardin?: { ready(): boolean } }).__jardin?.ready() === true, null, { timeout: 30_000 });
  await page.waitForTimeout(200);
}

interface Live {
  plants: number;
  sceneChildren: number;
  injectChildren: number;
  renderObjects: number;
  passLog: number;
  memory: Record<string, number>;
}
const live = (page: Page) => J<Live>(page, (j) => j.liveObjects());

// ---------------------------------------------------------------------------------------------
// Point 14 : fuite à chaque plante effacée par « Nouvelle feuille » (ou Précédent / Suivant). Cause mesurée : Three garde un objet
// de rendu par (maillage, matériau, scène) dans un Set fort tant que `mesh.dispose()` n'est pas appelé ; `geometry.dispose()` ne
// suffit pas. Garde : des COMPTEURS exacts (objets de rendu, tampons d'uniformes, enfants des scènes, géométries, textures) qui
// reviennent à leur valeur d'une feuille vide, et un tas JS comparé à un témoin de même durée, avec une borne large.
test('point 14 : N × (4 plantes puis Nouvelle feuille) et un aller-retour Précédent / Suivant : compteurs de retour à la ligne de base, tas près du témoin', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await openGarden(page, '&quality=T2');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    return ((await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }).usedSize / 1048576;
  };
  const N = 24;
  const cycle = async () => {
    await J(page, async (j) => {
      [300, 600, 900, 1200].forEach((x, i) => j.plant(x, 700, i));
      await j.step(120);
    });
    await J(page, (j) => j.newSheet()); // 4 plantes : pas de confirmation (seuil 5) ; fondu de 1,2 s réel
  };
  const witness = async () => {
    await J(page, async (j) => {
      await j.step(120);
    });
  };

  // Chauffe : deux cycles complets (compilations, tampons créés à la demande), puis la ligne de base sur une feuille vide.
  await cycle();
  await cycle();
  const base = await live(page);
  expect(base.plants).toBe(0);

  // Témoin : même nombre d'étapes de simulation, ni plantation ni effacement.
  const w0 = await heap();
  for (let i = 0; i < N; i++) await witness();
  const w1 = await heap();

  const h0 = await heap();
  for (let i = 0; i < N; i++) await cycle();
  const h1 = await heap();
  const end = await live(page);

  // Précédent / Suivant : plante 3 fois, nouvelle feuille, retour (le jardin de 3 plantes repousse), avance (feuille vide).
  await J(page, (j) => {
    [400, 800, 1200].forEach((x, i) => j.plant(x, 700, i));
  });
  await page.waitForTimeout(700); // écriture de l'adresse (au plus 2 par seconde)
  await J(page, (j) => j.newSheet());
  await page.goBack();
  await page.waitForFunction(() => (window as unknown as { __jardin: { metrics(): { plants: number } } }).__jardin.metrics().plants === 3, null, { timeout: 20_000 });
  await page.goForward();
  await page.waitForFunction(() => (window as unknown as { __jardin: { metrics(): { plants: number } } }).__jardin.metrics().plants === 0, null, { timeout: 20_000 });
  await page.waitForTimeout(300);
  const nav = await live(page);

  const growth = h1 - h0;
  const witnessGrowth = w1 - w0;
  console.info(
    `[audit1] point 14 : ${N} cycles (4 plantes puis Nouvelle feuille) : tas ${h0.toFixed(2)} -> ${h1.toFixed(2)} Mo (+${growth.toFixed(2)}), témoin ${w0.toFixed(2)} -> ${w1.toFixed(2)} Mo (+${witnessGrowth.toFixed(2)}) ; ` +
      `objets de rendu ${base.renderObjects} -> ${end.renderObjects} (après Précédent / Suivant ${nav.renderObjects}) ; tampons d'uniformes ${base.memory.uniformBuffers} -> ${end.memory.uniformBuffers} ; géométries ${base.memory.geometries} -> ${end.memory.geometries}`,
  );
  // Compteurs exacts : tout revient à la ligne de base (avant le correctif : +8 objets de rendu et +16 tampons par plante effacée).
  for (const o of [end, nav]) {
    expect(o.plants).toBe(0);
    expect(o.renderObjects, 'objets de rendu suivis par Three').toBe(base.renderObjects);
    expect(o.sceneChildren, 'enfants de la scène').toBe(base.sceneChildren);
    expect(o.injectChildren, "enfants de la scène d'injection").toBe(base.injectChildren);
    expect(o.memory.uniformBuffers, "tampons d'uniformes").toBe(base.memory.uniformBuffers);
    expect(o.memory.uniformBuffersSize).toBe(base.memory.uniformBuffersSize);
    expect(o.memory.geometries, 'géométries').toBe(base.memory.geometries);
    expect(o.memory.textures, 'textures').toBe(base.memory.textures);
    expect(o.memory.attributes).toBe(base.memory.attributes);
  }
  // Tas JS : borne large contre le témoin (avant le correctif : ≈ +3,2 Mo pour 20 cycles, soit ≈ 157 Ko par cycle ; après : un plateau
  // de quelques centaines de Ko dû aux listes de mesures, qui se bornent seules).
  expect(growth - witnessGrowth, 'croissance du tas par rapport au témoin (Mo)').toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Points 7 et 8 : récupération du GPU (perte du device simulée).
test('points 7 et 8 : après une perte du device, une seule jauge dans le document (feuille de style comprise) et l’espèce courante est gardée', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await openGarden(page, '&quality=T2');
  const gaugeCount = () => page.evaluate(() => ({ nodes: document.querySelectorAll('#gauge').length, styles: [...document.head.querySelectorAll('style')].filter((s) => (s.textContent ?? '').includes('#gauge{')).length }));
  expect(await gaugeCount()).toEqual({ nodes: 1, styles: 1 });
  await page.locator('#stage').focus();
  await page.keyboard.press('3'); // espèce 3 = herbes
  const label = () => page.locator('#b-plant').getAttribute('aria-label');
  expect(await label()).toContain('Herbes');
  for (let k = 0; k < 2; k++) {
    expect(await J(page, (j) => j.simulateDeviceLoss())).toBe(true);
    await page.waitForTimeout(400);
    await page.waitForFunction(() => !document.getElementById('veil') && (window as unknown as { __jardin: { ready(): boolean } }).__jardin.ready() === true, null, { timeout: 20_000 });
    await page.waitForTimeout(300);
    expect(await gaugeCount(), `après la perte ${k + 1}`).toEqual({ nodes: 1, styles: 1 });
    expect(await label(), `espèce après la perte ${k + 1}`).toContain('Herbes');
  }
  // Un clic plante bien l'espèce gardée (herbes = code 2 dans le lien).
  await page.mouse.click(960, 700);
  await page.waitForFunction(() => (window as unknown as { __jardin: { metrics(): { plants: number } } }).__jardin.metrics().plants === 1, null, { timeout: 10_000 });
  const link = await J<string>(page, (j) => j.link());
  const code = link.slice(link.indexOf('#g=')).split('.')[3]!;
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const v = [...code.slice(0, 4)].reduce((acc, ch) => acc * 64 + B64.indexOf(ch), 0);
  expect(v & 7, 'code de l’espèce plantée (herbes = 2)').toBe(2);
  expect(await J(page, (j) => j.plantTotal())).toBe(1);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Point 9 : course dans l'interrupteur du son. Deux appuis dans la même tâche : le second coupe pendant l'attente de `resume()`
// du premier ; le son doit rester coupé (avant le correctif : le volume remontait après l'attente).
test('point 9 : « activer » puis « couper » dans la même tâche : le son reste coupé (RMS nul)', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await openGarden(page, '&quality=T2');
  await page.locator('#stage').focus();
  // Deux vrais appuis donnent l'activation de l'utilisateur au document et créent le contexte.
  await page.keyboard.press('m');
  await page.waitForTimeout(500);
  await page.keyboard.press('m');
  await page.waitForTimeout(500);
  expect((await J(page, (j) => j.audio())).on).toBe(false);
  await page.evaluate(() => {
    const stage = document.getElementById('stage')!;
    for (let k = 0; k < 2; k++) stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true }));
  });
  await page.waitForTimeout(1200);
  // Le gain du volume (AudioParam) est lu, pas l'analyseur : contexte suspendu, l'analyseur garde son dernier tampon.
  const a = await J<{ on: boolean; state: string; gain: number; volume: number }>(page, (j) => j.audio());
  console.info(`[audit1] point 9 : son déclaré ${a.on ? 'activé' : 'coupé'}, contexte ${a.state}, gain ${a.gain.toFixed(4)} (volume ${a.volume})`);
  expect(a.on).toBe(false);
  expect(a.gain, 'gain du volume après activer puis couper').toBeLessThan(0.001);
  // Contre-épreuve (le test n'est pas creux) : un appui simple allume bien le son, le gain monte au volume.
  await page.keyboard.press('m');
  await page.waitForTimeout(800);
  const b = await J<{ on: boolean; gain: number; volume: number }>(page, (j) => j.audio());
  expect(b.on).toBe(true);
  expect(b.gain).toBeGreaterThan(b.volume * 0.9);
  await page.keyboard.press('m');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Point 10 : la touche Q ne change pas le palier dans une boîte de dialogue.
test('point 10 : Q dans la boîte « Nouvelle feuille » ne change pas le palier ; Q sur la feuille le change', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await openGarden(page, '&quality=T2');
  await J(page, (j) => {
    [200, 450, 700, 950, 1200].forEach((x, i) => j.plant(x, 700, i));
  });
  const manual = () => J<string>(page, (j) => j.quality().manual);
  const before = await manual();
  await J(page, (j) => {
    void j.newSheet(); // 5 plantes : la boîte de confirmation s'ouvre
  });
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('q');
  await page.waitForTimeout(300);
  expect(await manual(), 'palier inchangé dans la boîte').toBe(before);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.locator('#stage').focus();
  await page.keyboard.press('q');
  await page.waitForTimeout(300);
  expect(await manual(), 'palier changé sur la feuille').not.toBe(before);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Point 11 : `pointerup` perdu (alt-tab pendant l'appui) : la fenêtre perd le focus, l'appui est abandonné.
test('point 11 : perte de focus de la fenêtre pendant un appui : rien n’est planté au relâchement, le clic suivant plante', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await openGarden(page, '&quality=T2');
  await page.mouse.move(700, 600);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await J<{ plants: number }>(page, (j) => j.metrics())).plants, 'appui abandonné : aucune plante').toBe(0);
  expect(await page.evaluate(() => document.querySelector('#gauge')?.getAttribute('data-visible') ?? null)).toBeNull();
  await page.mouse.click(700, 600);
  await page.waitForFunction(() => (window as unknown as { __jardin: { metrics(): { plants: number } } }).__jardin.metrics().plants === 1, null, { timeout: 10_000 });
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Point 12 : sans horodatages GPU lus (WebGL2 de repli), le journal des passes reste vide (aucune chaîne fabriquée par image).
test('point 12 : en version réduite (WebGL2) le journal des passes reste vide', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await openGarden(page, '&force=reduit&fx=1');
  await J(page, async (j) => {
    await j.step(120);
  });
  await page.waitForTimeout(1500);
  const o = await live(page);
  console.info(`[audit1] point 12 : entrées du journal des passes en version réduite : ${o.passLog}`);
  expect(o.passLog).toBe(0);
  expect(errors).toEqual([]);
});
