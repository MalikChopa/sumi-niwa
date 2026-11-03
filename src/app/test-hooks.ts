// Crochets de test (SPEC §8) : actifs seulement avec `?test=1` ET dans une construction de test (`__TEST_HOOKS__`, voir
// vite.config.ts). En production la constante vaut `false` : chaque lecture de paramètre ci-dessous est inerte, et comme
// src/main.ts garde chaque usage par `__TEST_HOOKS__`, ce fichier n'entre pas dans le paquet livré (audit J6, point 2).
// J1 : marque `paper-visible`. J2 : marque `first-stroke`, `&autoplant=1`, `window.__jardin`
// (`step(n)`, `plant(x, y, espece)`, `gardenHash()`, `metrics()`, plus `plantHashes()` pour F-3).
// J3 : `simulateDeviceLoss()`, `inkRing()` (relecture de la grille, F-4), `tipSway()` et `windAt()` (F-5),
// `setLoad(ms)` (charge simulée, contrôleur), `quality()` / `cycleQuality()` (touche Q), `particles()` (F-6),
// `setFx(on)`, `setFall(k)` (chute accélérée pour compter vite les poses), `motesNear()`. `&fx=1` : particules et brise actives en mode test (coupées par défaut, ARCHITECTURE 12.3).
// J4 : `setSeason(s, instant?)`, `seasonInfo()` (poids, journal des transitions), `link()`, `keep()` (export PNG, retourne les
// mesures), `lastExport()`, `analyzeExport()` (décode un PNG gardé dans la page), `exportThumb()`, `newSheet()`, `copyLink()`.
// J5 : `audio()`, `audioRms()`, `audioPeakHz()`, `startGainTrace()` / `stopGainTrace()` (rampe de volume), `contemplative()`,
// `advanceClock()` (horloge de l'inactivité), `setPilotSpeed()` (compression du temps du PILOTE seulement), `fakeFullscreen()`,
// `gpuMemory()` (`renderer.info.memory`), `motion()` (échelles du mouvement réduit), `brush()`.
import { SWAY_MAX, type SpeciesCode } from '../constants';
import { V } from '../core/layout';
import { STROKE_VERTEX_FLOATS } from '../constants';
import { swayAt, windAt, windUniforms } from '../sim/wind';
import { inkUniforms } from '../render/ink';
import type { Garden } from './garden';
import type { QualityRuntime } from './quality-runtime';
import type { ExportResult } from '../render/export';
import type { SoundEngine } from '../audio/engine';
import type { Contemplative } from './contemplative-runtime';
import type { Brush } from '../ui/brush';
import { clock } from './clock';

export function testModeOn(search: string): boolean {
  return __TEST_HOOKS__ && new URLSearchParams(search).get('test') === '1';
}

export function autoplantOn(search: string): boolean {
  return __TEST_HOOKS__ && new URLSearchParams(search).get('autoplant') === '1';
}

export function windRingOn(search: string): boolean {
  return __TEST_HOOKS__ && new URLSearchParams(search).get('windring') === '1';
}

export function welcomeOn(search: string): boolean {
  return __TEST_HOOKS__ && new URLSearchParams(search).get('welcome') === '1';
}

export function fxOn(search: string): boolean {
  return __TEST_HOOKS__ && new URLSearchParams(search).get('fx') === '1';
}

const hudLines: string[] = [];
function hud(line: string): void {
  // Cartouche de marques : créé ici (il n'existe pas dans index.html, donc pas dans la page de production).
  let el = document.getElementById('test-hud');
  if (!el) {
    el = document.createElement('p');
    el.id = 'test-hud';
    el.style.cssText = 'position:fixed;top:8px;left:8px;margin:0;padding:2px 8px;font:12px/1.4 ui-monospace,Consolas,monospace;background:rgba(243,236,221,.85);border:1px solid rgba(30,36,48,.2);z-index:9';
    document.body.appendChild(el);
  }
  hudLines.push(line);
  el.textContent = hudLines.join(' · ');
}

/** Pose la marque `paper-visible` et l'affiche en haut à gauche. Retourne la date en ms depuis navigationStart. */
export function markPaperVisible(): number {
  const m = performance.mark('paper-visible'); // startTime est relatif à navigationStart
  hud(`paper-visible : ${Math.round(m.startTime)} ms`);
  return m.startTime;
}

/** Pose la marque `first-stroke` (image suivant le premier dessin de trait non vide, SPEC §1 `FIRST_PLANT_MS`). */
export function markFirstStroke(): number {
  const m = performance.mark('first-stroke');
  hud(`first-stroke : ${Math.round(m.startTime)} ms`);
  return m.startTime;
}

export interface JardinHooks {
  step(n: number): Promise<void>;
  plant(x: number, y: number, espece: number): { ok: boolean; rank: number; hash: string; reason?: string };
  gardenHash(): string;
  plantHashes(): string[];
  metrics(): unknown;
  ready(): boolean;
  simulateDeviceLoss(): boolean;
  inkRing(rank: number, r0: number, r1: number): Promise<unknown>;
  tipSway(rank: number): unknown;
  windAt(x: number, y: number): [number, number];
  setLoad(ms: number): void;
  quality(): unknown;
  cycleQuality(): string | null;
  particles(): Promise<unknown>;
  setFx(on: boolean): void;
  setFall(k: number): void;
  setBreeze(k: number): void;
  motesNear(x: number, y: number, r: number): Promise<{ n: number; vx: number; vy: number }>;
  setSeason(s: number, instant?: boolean): void;
  seasonInfo(): unknown;
  link(): string;
  keep(): Promise<unknown>;
  lastExport(): unknown;
  analyzeExport(a: ExportAnalysis): Promise<unknown>;
  exportThumb(index: number, width: number): Promise<string | null>;
  newSheet(): Promise<void>;
  copyLink(): Promise<boolean>;
  plantTotal(): number;
  audio(): unknown;
  audioRms(): number;
  audioPeakHz(lo: number, hi: number): number;
  startGainTrace(): void;
  stopGainTrace(): unknown;
  contemplative(): unknown;
  advanceClock(ms: number): number;
  setPilotSpeed(k: number): void;
  fakeFullscreen(v: boolean | null): void;
  gpuMemory(): unknown;
  liveObjects(): unknown;
  motion(): unknown;
  brush(): unknown;
  paused(): boolean;
}

/** Demande d'analyse d'un PNG exporté (J4) : zones en uf, comparaison avec un autre export. */
export interface ExportAnalysis {
  index: number;
  /** autre export à comparer (index) */
  against?: number;
  /** zones (uf) dont on veut la fraction de pixels qui diffèrent de `against` et la couleur moyenne */
  regions?: { name: string; x0: number; y0: number; x1: number; y1: number }[];
}

export interface HookInfo {
  level: string;
  backend: string;
  quality: () => QualityRuntime | null;
  simulateDeviceLoss: () => boolean;
  session: () => { garden: Garden } | null;
  lossLog: () => number[];
  setSeason: (i: number, instant?: boolean) => void;
  shareUrl: () => string;
  keep: () => Promise<ExportResult | null>;
  lastExport: () => ExportResult | null;
  exportBlob: (i: number) => Blob | null;
  newSheet: () => Promise<void>;
  copyLink: () => Promise<boolean>;
  sound: () => SoundEngine | null;
  contemplative: () => Contemplative | null;
  brush: () => Brush | null;
}

async function decodePng(blob: Blob): Promise<{ w: number; h: number; data: Uint8ClampedArray<ArrayBuffer> }> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  bmp.close();
  return { w: c.width, h: c.height, data: img.data };
}

/** Segments (centre, demi-largeur) des traits d'une plante, pour mesurer un anneau autour du trait. */
function strokeSegments(verts: Float32Array, n: number): number[][] {
  const pts: { x: number; y: number; hw: number; seed: number }[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * STROKE_VERTEX_FLOATS;
    const side = ((verts[o + V.NOISE] as number) % 4) - 1;
    if (side > 0) continue; // un sommet par paire (côté −1)
    pts.push({ x: verts[o + V.CX]!, y: verts[o + V.CY]!, hw: Math.hypot(verts[o + V.OX]!, verts[o + V.OY]!), seed: Math.floor((verts[o + V.NOISE] as number) / 4) });
  }
  const segs: number[][] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (a.seed !== b.seed || Math.hypot(b.x - a.x, b.y - a.y) > 60) continue;
    segs.push([a.x, a.y, b.x, b.y, a.hw, b.hw]);
  }
  return segs;
}

export function installHooks(garden0: Garden, info: HookInfo): void {
  const g = () => info.session()?.garden ?? garden0;
  const hooks: JardinHooks = {
    async step(n) {
      g().step(n);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    },
    plant(x, y, espece) {
      return g().plantAt(x, y, espece as SpeciesCode, null);
    },
    gardenHash: () => g().gardenHash(),
    plantHashes: () => g().plantHashes(),
    metrics: () => {
      const garden = g();
      const fx = garden.effects;
      const q = info.quality();
      return {
        ...info,
        level: document.documentElement.dataset.niveau,
        backend: document.documentElement.dataset.backend,
        graine: garden.state.graine.toString(16).padStart(8, '0'),
        especes: garden.state.plantes.map((p) => p.espece),
        ...garden.metrics,
        tier: fx?.tier.id ?? null,
        activeParticles: fx ? { ...fx.particles.active } : null,
        windResponses: fx ? fx.windResponses.slice() : [],
        gpu: fx?.gpu ?? null,
        grid: fx?.grid ? [fx.grid.w, fx.grid.h] : null,
        qualityHistory: q ? q.history.slice() : [],
        losses: info.lossLog(),
      };
    },
    ready: () => g().isReady,
    simulateDeviceLoss: () => info.simulateDeviceLoss(),
    async inkRing(rank, r0, r1) {
      const garden = g();
      const grid = garden.effects?.grid;
      const p = garden.plantInfo(rank);
      if (!grid || !p) return null;
      const rb = await grid.readback();
      if (!rb) return null;
      const segs = strokeSegments(p.geo.verts, p.geo.vertCount);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of segs) {
        x0 = Math.min(x0, s[0]!, s[2]!);
        y0 = Math.min(y0, s[1]!, s[3]!);
        x1 = Math.max(x1, s[0]!, s[2]!);
        y1 = Math.max(y1, s[1]!, s[3]!);
      }
      const cw = 1600 / rb.w;
      const ch = 900 / rb.h;
      let sum = 0, water = 0, cells = 0, totalWater = 0;
      for (let i = 0; i < rb.w * rb.h; i++) totalWater += rb.water[i]!;
      const cx0 = Math.max(0, Math.floor((x0 - r1 - 30) / cw));
      const cx1 = Math.min(rb.w - 1, Math.ceil((x1 + r1 + 30) / cw));
      const cy0 = Math.max(0, Math.floor((y0 - r1 - 30) / ch));
      const cy1 = Math.min(rb.h - 1, Math.ceil((y1 + r1 + 30) / ch));
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const x = (cx + 0.5) * cw;
          const y = (cy + 0.5) * ch;
          let best = Infinity;
          for (const s of segs) {
            const [ax, ay, bx, by, ha, hb] = s as [number, number, number, number, number, number];
            const dx = bx - ax, dy = by - ay;
            const L2 = dx * dx + dy * dy;
            const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
            const d = Math.hypot(x - ax - t * dx, y - ay - t * dy) - (ha + (hb - ha) * t);
            if (d < best) best = d;
          }
          if (best >= r0 && best <= r1) {
            const i = cy * rb.w + cx;
            sum += rb.deposit[i]! + 0.6 * rb.pigment[i]!;
            water += rb.water[i]!;
            cells++;
          }
        }
      }
      return { mean: cells ? sum / cells : 0, water: cells ? water / cells : 0, cells, totalWater, grid: [rb.w, rb.h], simTime: garden.time };
    },
    tipSway(rank) {
      const garden = g();
      const p = garden.plantInfo(rank);
      const fx = garden.effects;
      if (!p || !fx) return null;
      const v = p.geo.verts;
      let best = -1, bi = 0;
      for (let i = 0; i < p.geo.vertCount; i++) {
        const sw = v[i * STROKE_VERTEX_FLOATS + V.SWAY] as number;
        if (sw > best) {
          best = sw;
          bi = i;
        }
      }
      const o = bi * STROKE_VERTEX_FLOATS;
      const t = windUniforms.time.value as number;
      const d = swayAt(fx.wind.impulses, v[o + V.BX]!, v[o + V.BY]!, best, SWAY_MAX[p.espece as 0] ?? 0, t, windUniforms.breeze.value as number, windUniforms.scale.value as number, windUniforms.sway.value as number);
      return { dx: d[0], dy: d[1], mag: Math.hypot(d[0], d[1]), sway: best, tip: [v[o + V.CX], v[o + V.CY]], impulses: fx.wind.impulses.length };
    },
    windAt(x, y) {
      const fx = g().effects;
      return fx ? windAt(fx.wind.impulses, x, y, windUniforms.time.value as number, windUniforms.breeze.value as number, windUniforms.scale.value as number) : [0, 0];
    },
    setLoad(ms) {
      const fx = g().effects;
      if (fx) fx.simulatedLoadMs = ms;
    },
    quality() {
      const q = info.quality();
      return q ? { tier: g().effects?.tier.id, manual: q.manual, frozen: q.state.frozen, flipflops: q.state.flipflops, history: q.history.slice(), windows: q.windows.slice(-80) } : null;
    },
    cycleQuality() {
      return info.quality()?.cycle() ?? null;
    },
    async particles() {
      const fx = g().effects;
      if (!fx) return null;
      const counters = await fx.particles.counters();
      const motes = Array.from(await fx.particles.sample('motes', 64));
      const carriers = Array.from(await fx.particles.sample('carriers', 64));
      const carriersB = Array.from(await fx.particles.sample('carriersB', 64));
      return { active: fx.particles.active, counters, motes, carriers, carriersB };
    },
    setFx(on) {
      g().effects?.setFx(on);
    },
    setBreeze(k) {
      windUniforms.breeze.value = k;
    },
    setFall(k) {
      const fx = g().effects;
      if (fx) fx.particles.uniforms.fall.value = k;
    },
    setSeason(s, instant) {
      info.setSeason(s, instant);
    },
    seasonInfo() {
      const garden = g();
      return {
        target: garden.season,
        weights: Array.from(garden.seasonWeights()),
        moving: garden.seasonMoving,
        log: garden.seasonLog.slice(),
        now: performance.now(),
        seasonType: garden.effects?.particles.uniforms.seasonType.value ?? null,
        part: garden.effects?.particles.uniforms.part.value ?? null,
        inkWeights: (() => {
          const v = inkUniforms.season.value as { x: number; y: number; z: number; w: number };
          return [v.x, v.y, v.z, v.w];
        })(),
      };
    },
    link: () => info.shareUrl(),
    async keep() {
      const r = await info.keep();
      return r ? { name: r.name, width: r.width, height: r.height, ms: r.ms, renderMs: r.renderMs, readMs: r.readMs, encodeMs: r.encodeMs, bytes: r.blob.size, fallback: r.fallback } : null;
    },
    lastExport() {
      const r = info.lastExport();
      return r ? { name: r.name, width: r.width, height: r.height, ms: r.ms, renderMs: r.renderMs, readMs: r.readMs, encodeMs: r.encodeMs, bytes: r.blob.size, fallback: r.fallback } : null;
    },
    async analyzeExport(a) {
      const A = info.exportBlob(a.index);
      if (!A) return null;
      const pa = await decodePng(A);
      const B = a.against !== undefined ? info.exportBlob(a.against) : null;
      const pb = B ? await decodePng(B) : null;
      const n = pa.w * pa.h;
      let white = 0;
      let translucent = 0;
      const mean = [0, 0, 0];
      for (let i = 0; i < pa.data.length; i += 4) {
        if (pa.data[i] === 255 && pa.data[i + 1] === 255 && pa.data[i + 2] === 255) white++;
        if (pa.data[i + 3] !== 255) translucent++;
        mean[0]! += pa.data[i]!;
        mean[1]! += pa.data[i + 1]!;
        mean[2]! += pa.data[i + 2]!;
      }
      const kx = pa.w / 1600;
      const ky = pa.h / 900;
      const same = pb !== null && pb.w === pa.w && pb.h === pa.h;
      const chDiff = (i: number) => Math.max(Math.abs(pa.data[i]! - pb!.data[i]!), Math.abs(pa.data[i + 1]! - pb!.data[i + 1]!), Math.abs(pa.data[i + 2]! - pb!.data[i + 2]!));
      const region = (name: string, x0: number, y0: number, x1: number, y1: number) => {
        const X0 = Math.max(0, Math.floor(x0 * kx)), X1 = Math.min(pa.w, Math.ceil(x1 * kx));
        const Y0 = Math.max(0, Math.floor(y0 * ky)), Y1 = Math.min(pa.h, Math.ceil(y1 * ky));
        let cnt = 0, diff = 0, red = 0, dark = 0;
        const m = [0, 0, 0];
        for (let y = Y0; y < Y1; y++)
          for (let x = X0; x < X1; x++) {
            const i = (y * pa.w + x) * 4;
            cnt++;
            m[0]! += pa.data[i]!;
            m[1]! += pa.data[i + 1]!;
            m[2]! += pa.data[i + 2]!;
            if (pa.data[i]! > 140 && pa.data[i + 1]! < 110 && pa.data[i + 2]! < 100) red++;
            if (pa.data[i]! + pa.data[i + 1]! + pa.data[i + 2]! < 3 * 120) dark++;
            if (same && chDiff(i) > 24) diff++;
          }
        return { name, pixels: cnt, mean: m.map((v) => v / Math.max(1, cnt)), diffFrac: cnt ? diff / cnt : 0, redFrac: cnt ? red / cnt : 0, darkFrac: cnt ? dark / cnt : 0 };
      };
      let diffAll = 0;
      if (same) for (let i = 0; i < pa.data.length; i += 4) if (chDiff(i) > 24) diffAll++;
      return {
        w: pa.w,
        h: pa.h,
        whitePct: (white / n) * 100,
        translucent,
        mean: mean.map((v) => v / n),
        diffAllFrac: same ? diffAll / n : null,
        regions: (a.regions ?? []).map((r) => region(r.name, r.x0, r.y0, r.x1, r.y1)),
      };
    },
    async exportThumb(index, width) {
      const blob = info.exportBlob(index);
      if (!blob) return null;
      const p = await decodePng(blob);
      const src = document.createElement('canvas');
      src.width = p.w;
      src.height = p.h;
      src.getContext('2d')!.putImageData(new ImageData(p.data, p.w, p.h), 0, 0);
      const c = document.createElement('canvas');
      c.width = width;
      c.height = Math.round((width * p.h) / p.w);
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    },
    newSheet: () => info.newSheet(),
    copyLink: () => info.copyLink(),
    plantTotal: () => g().plantTotal,
    audio() {
      const e = info.sound();
      return e ? { created: e.created, state: e.state, on: e.on, volume: e.volume, gain: e.gainNow().param, stats: { ...e.stats }, sampleRate: e.sampleRate, supported: e.supported } : null;
    },
    audioRms: () => info.sound()?.analyserRms() ?? 0,
    audioPeakHz: (lo, hi) => info.sound()?.analyserPeakHz(lo, hi) ?? 0,
    startGainTrace() {
      const trace: { t: number; param: number; probe: number | null }[] = [];
      const w = window as unknown as { __gainTrace?: { samples: typeof trace; inputAt: number[]; stop: boolean } };
      const st = { samples: trace, inputAt: [] as number[], stop: false };
      w.__gainTrace = st;
      document.addEventListener('input', () => st.inputAt.push(performance.now()), { capture: true });
      const loop = () => {
        const e = info.sound();
        if (e) {
          const gn = e.gainNow();
          trace.push({ t: gn.time, param: gn.param, probe: gn.probe });
        }
        if (!st.stop) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    stopGainTrace() {
      const st = (window as unknown as { __gainTrace?: { samples: unknown[]; inputAt: number[]; stop: boolean } }).__gainTrace;
      if (!st) return null;
      st.stop = true;
      return { samples: st.samples, inputAt: st.inputAt };
    },
    contemplative() {
      const c = info.contemplative();
      return c ? c.stats() : null;
    },
    advanceClock: (ms) => {
      clock.advance(ms);
      return clock.offset;
    },
    setPilotSpeed(k) {
      const c = info.contemplative();
      if (c) c.speed = k;
    },
    fakeFullscreen(v) {
      const c = info.contemplative();
      if (c) c.fullscreenOverride = v;
    },
    gpuMemory() {
      const m = g().effects ? (info.session() as unknown as { paper: { renderer: { info: { memory: Record<string, number> } } } } | null)?.paper.renderer.info.memory : null;
      return m ? { ...m } : null;
    },
    liveObjects() {
      // Objets vivants lisibles (audit J6 point 14) : fiches de plantes, enfants des scènes, objets de rendu suivis par Three
      // (`_objects._renderObjects`, un Set fort : c'est lui qui retenait les maillages effacés) et mémoire déclarée par `renderer.info`.
      const r = (info.session() as unknown as { paper: { renderer: { info: { memory: Record<string, number> }; _objects?: { _renderObjects?: Set<unknown> } } } } | null)?.paper.renderer;
      return { ...g().liveCounts(), passLog: g().effects?.passLogSize ?? -1, renderObjects: r?._objects?._renderObjects?.size ?? -1, memory: r ? { ...r.info.memory } : null };
    },
    motion() {
      const fx = g().effects;
      return {
        reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        windScale: windUniforms.scale.value,
        swayScale: windUniforms.sway.value,
        fall: fx ? fx.particles.uniforms.fall.value : null,
        activeParticles: fx ? { ...fx.particles.active } : null,
        tierMotes: fx ? fx.tier.motes : null,
        gusts: fx ? fx.gustCount : 0,
      };
    },
    brush() {
      const b = info.brush();
      return b ? { x: b.x, y: b.y, visible: b.visible } : null;
    },
    paused: () => g().paused,
    async motesNear(x, y, r) {
      const fx = g().effects;
      if (!fx) return { n: 0, vx: 0, vy: 0 };
      const a = await fx.particles.sample('motes', fx.particles.active.motes);
      let n = 0, vx = 0, vy = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.hypot(a[i]! - x, a[i + 1]! - y) <= r) {
          n++;
          vx += a[i + 2]!;
          vy += a[i + 3]!;
        }
      }
      return { n, vx: n ? vx / n : 0, vy: n ? vy / n : 0 };
    },
  };
  (window as unknown as { __jardin: JardinHooks }).__jardin = hooks;
}
