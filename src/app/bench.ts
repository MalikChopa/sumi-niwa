// Bench des paliers (ARCHITECTURE 12.4, F-6) : scénario fixe de 40 plantes poussées, automne (saison 2 du lien,
// sans transition : les saisons sont du J4), vent scripté (impulsions de curseur le long d'un huit à ≈ 300 uf/s),
// chaque palier forcé (QC_BENCH_WARM_S de chauffe, QC_BENCH_MEASURE_S de mesure), puis le contrôleur en `auto`
// pendant 20 s : palier tenu. Affiche images/s médianes, 1 % le plus lent, p95, ms GPU par passe et par image
// (si `timestamp-query`), rapports de coût entre paliers (QC_TIER_RATIO à remplacer), adaptateur, résolution.
// Rien n'est envoyé ; « Copier en JSON » met le résultat dans le presse-papiers.
import { createPaper } from '../render/paper';
import { Garden } from './garden';
import { Effects } from './effects';
import { newGarden, type GardenState } from '../core/state';
import { TIERS, type TierId, type SpeciesCode, QC_WINDOW_MS } from '../constants';
import { qcInit, qcWindow, type CompletTier } from '../core/quality';
import { detectLevel } from '../boot/level';

const WARM_S = 5;
const MEASURE_S = 15;
const AUTO_S = 20;

interface TierResult {
  tier: TierId;
  particles: number;
  grid: string;
  frames: number;
  fpsMedian: number;
  msMedian: number;
  msP95: number;
  low1Fps: number;
  gpuFrameMs: number | null;
  gpuPerPass: Record<string, number> | null;
  canvas: string;
}

const pct = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? 0;
};

/** 40 plantes réparties sur la feuille (positions et espèces fixes), toutes poussées. */
function benchState(): GardenState {
  const s = newGarden(0x9f3a12c4, 2);
  const plantes: GardenState['plantes'] = [];
  for (let i = 0; i < 40; i++) {
    const col = i % 10;
    const row = Math.floor(i / 10);
    const x = 90 + col * 158 + (row % 2) * 60;
    const y = 520 + row * 95 + ((i * 37) % 23);
    plantes.push({ x, y, espece: (i % 5) as SpeciesCode });
  }
  return { ...s, plantes };
}

export async function runBench(out: HTMLElement): Promise<void> {
  const log = (s: string) => {
    out.textContent += s + '\n';
  };
  const result: { done: boolean; info: Record<string, unknown>; tiers: TierResult[]; ratios: Record<string, number | null>; auto: unknown; error?: string } = {
    done: false,
    info: {},
    tiers: [],
    ratios: {},
    auto: null,
  };
  (window as unknown as { __bench: typeof result }).__bench = result;
  try {
    const search = location.search;
    const det = await detectLevel(search);
    if (det.level === 'refus') throw new Error('ni WebGPU ni WebGL2');
    const forceWebGL = det.level === 'reduit';
    const canvas = document.createElement('canvas');
    document.getElementById('stage')!.appendChild(canvas);
    const paper = await createPaper({ canvas, forceWebGL });
    await paper.renderNow();
    const level = paper.backend === 'webgpu' ? 'complet' : 'reduit';
    const effects = new Effects({ paper, level, season: 2, fx: true, seed: 12345, tier: level === 'complet' ? 'T2' : 'R' });
    const garden = new Garden({ paper, state: benchState(), effects, grown: true });
    paper.start();
    await garden.warmUp();
    let adapter: Record<string, unknown> = {};
    try {
      const a = await (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info: Record<string, unknown>; features: Set<string> } | null> } }).gpu?.requestAdapter();
      if (a) adapter = { vendor: a.info.vendor, architecture: a.info.architecture, timestampQuery: a.features.has('timestamp-query') };
    } catch {
      /* sans objet */
    }
    const ts = (paper.renderer.backend as { trackTimestamp?: boolean }).trackTimestamp === true;
    result.info = { level, backend: paper.backend, ...adapter, timestamps: ts, window: `${innerWidth}x${innerHeight}`, devicePixelRatio, plants: garden.plantCount, season: 'automne (saison 2 du lien)', ua: navigator.userAgent };
    log(`Jardin d'encre · bench · ${level} (${paper.backend}) · ${JSON.stringify(adapter)} · horodatages GPU ${ts ? 'oui' : 'non'} · fenêtre ${innerWidth}x${innerHeight} x${devicePixelRatio}`);
    log(`Scénario : ${garden.plantCount} plantes poussées, automne, vent scripté ; par palier ${WARM_S} s de chauffe + ${MEASURE_S} s de mesure.`);

    // Vent scripté : un « curseur » parcourt un huit à ≈ 300 uf/s, une impulsion toutes les 33 ms.
    let windT = 0;
    let lastImp = -1;
    let prev = { x: 800, y: 600 };
    const frameDts: number[] = [];
    let recording = false;
    garden.frameListeners.push((now, dt) => {
      if (recording && dt > 0) frameDts.push(dt);
      if (lastImp < 0 || now - lastImp >= 33) {
        windT += 0.033;
        const x = 800 + 520 * Math.sin(windT * 0.35);
        const y = 560 + 200 * Math.sin(windT * 0.7);
        const vx = (x - prev.x) / 0.033;
        const vy = (y - prev.y) / 0.033;
        prev = { x, y };
        effects.wind.add({ x, y, vx: vx * 0.6, vy: vy * 0.6, t: now / 1000 });
        lastImp = now;
      }
    });
    const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

    const tiers: TierId[] = level === 'complet' ? ['T3', 'T2', 'T1', 'T0'] : ['R'];
    for (const id of tiers) {
      effects.applyTier(id);
      log(`… palier ${id} : chauffe`);
      await sleep(WARM_S);
      frameDts.length = 0;
      const gpuSamples: { frameMs: number; perPass: Record<string, number> }[] = [];
      recording = true;
      const poll = window.setInterval(() => {
        effects.pollGpu();
        const g = effects.gpu;
        if (g && g.frames > 0) gpuSamples.push({ frameMs: g.frameMs, perPass: { ...g.perPass } });
      }, QC_WINDOW_MS);
      await sleep(MEASURE_S);
      recording = false;
      window.clearInterval(poll);
      const t = TIERS[id];
      const med = pct(frameDts, 0.5);
      const perPass: Record<string, number> = {};
      for (const s of gpuSamples) for (const [k, v] of Object.entries(s.perPass)) perPass[k] = (perPass[k] ?? 0) + v / gpuSamples.length;
      const ds = paper.drawingSize();
      const r: TierResult = {
        tier: id,
        particles: effects.particles.active.motes + effects.particles.active.carriers,
        grid: t.grid ? `${t.grid[0]}x${t.grid[1]}` : 'aucune',
        frames: frameDts.length,
        fpsMedian: 1000 / med,
        msMedian: med,
        msP95: pct(frameDts, 0.95),
        low1Fps: 1000 / pct(frameDts, 0.99),
        gpuFrameMs: gpuSamples.length ? gpuSamples.reduce((a, s) => a + s.frameMs, 0) / gpuSamples.length : null,
        gpuPerPass: gpuSamples.length ? perPass : null,
        canvas: `${ds.w}x${ds.h} (ratio ${ds.ratio.toFixed(2)})`,
      };
      result.tiers.push(r);
      const passes = r.gpuPerPass ? Object.entries(r.gpuPerPass).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', ') : 'n/d';
      log(
        `${id} : ${r.particles.toLocaleString('fr-FR')} particules, grille ${r.grid}, rendu ${r.canvas} → ${r.fpsMedian.toFixed(1)} images/s médianes (${r.msMedian.toFixed(2)} ms), ` +
          `1 % lent ${r.low1Fps.toFixed(1)} images/s, p95 ${r.msP95.toFixed(2)} ms ; GPU ${r.gpuFrameMs === null ? 'n/d' : r.gpuFrameMs.toFixed(3) + ' ms/image'} [${passes}]`,
      );
    }
    // Rapports de coût GPU d'un palier au suivant (QC_TIER_RATIO).
    const g = (id: TierId) => result.tiers.find((x) => x.tier === id)?.gpuFrameMs ?? null;
    for (const [a, b] of [['T0', 'T1'], ['T1', 'T2'], ['T2', 'T3']] as const) {
      const ga = g(a);
      const gb = g(b);
      result.ratios[`${a}→${b}`] = ga && gb ? gb / ga : null;
    }
    if (level === 'complet') {
      log(`Rapports de coût GPU (QC_TIER_RATIO, défaut 2,0) : ${Object.entries(result.ratios).map(([k, v]) => `${k} ${v === null ? 'n/d' : v.toFixed(2)}`).join(' · ')}`);
      // Contrôleur en `auto` : départ T2, sonde de 2 s, puis décisions ; palier tenu après AUTO_S.
      effects.applyTier('T2');
      let qc = qcInit(performance.now(), 'T2' as CompletTier);
      const changes: string[] = [];
      let winStart = performance.now();
      frameDts.length = 0;
      recording = true;
      await new Promise<void>((resolve) => {
        const end = performance.now() + AUTO_S * 1000;
        const iv = window.setInterval(() => {
          const now = performance.now();
          effects.pollGpu();
          const gp = effects.gpu;
          const fr = frameDts.splice(0);
          if (fr.length) {
            const w = { t: now, frameMs: fr.reduce((a, b) => a + b, 0) / fr.length, gpuMs: gp && gp.frames > 0 ? gp.frameMs : null };
            const r = qcWindow(qc, w);
            qc = r.state;
            if (r.change) {
              changes.push(`${((now - winStart) / 1000).toFixed(1)} s ${r.change.from}→${r.change.to} (${r.change.reason})`);
              effects.applyTier(r.change.to);
            }
          }
          if (now >= end) {
            window.clearInterval(iv);
            resolve();
          }
        }, QC_WINDOW_MS);
      });
      recording = false;
      winStart = 0;
      result.auto = { held: effects.tier.id, changes };
      log(`Contrôleur auto (${AUTO_S} s) : palier tenu ${effects.tier.id} ; changements : ${changes.length ? changes.join(', ') : 'aucun'}`);
    }
    const t3 = result.tiers.find((x) => x.tier === 'T3');
    if (t3) log(`Cible 200 000 particules à 60 images/s : ${t3.fpsMedian >= 59 ? 'tenue' : 'NON tenue'} dans ce passage (T3 : ${t3.fpsMedian.toFixed(1)} images/s médianes, 1 % lent ${t3.low1Fps.toFixed(1)}). Une mesure headless ne dit rien de l'écran.`);
    log('Bench terminé. Note l’utilisation GPU du Gestionnaire des tâches ; deux passages, onglets fermés, portable branché.');
  } catch (e) {
    result.error = String(e instanceof Error ? e.message : e);
    log('ERREUR : ' + result.error);
  }
  result.done = true;
}
