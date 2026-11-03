// Sonde particules (J3, « en tête ») : 50 000 / 100 000 / 200 000 particules dans une boucle compute TSL
// simple (tampons de stockage, dessin instancié), images/s et, si `timestamp-query` est là, temps GPU.
// Page : bench.html?mode=probe (option `&backend=webgl` : essai du compute émulé de Three sous WebGL2).
// Rien n'est envoyé : résultats affichés dans la page et dans `window.__probe` (lu par scripts/bench.mjs).
import { DoubleSide, Mesh, MeshBasicNodeMaterial, OrthographicCamera, PlaneGeometry, Scene, WebGPURenderer, LinearSRGBColorSpace, Color } from 'three/webgpu';
import {
  Fn as t_Fn,
  instancedArray as t_instancedArray,
  instanceIndex as t_instanceIndex,
  uniform as t_uniform,
  vec2 as t_vec2,
  vec4 as t_vec4,
  float as t_float,
  sin as t_sin,
  cos as t_cos,
  fract as t_fract,
  positionGeometry as t_positionGeometry,
  length as t_length,
  smoothstep as t_smoothstep,
  hash as t_hash,
  uv as t_uv,
} from 'three/tsl';

// Imports nommés (un import global ferait grossir le paquet partagé) ; types TSL lus sans contrôle (voir ink.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const Fn: N = t_Fn, instancedArray: N = t_instancedArray, instanceIndex: N = t_instanceIndex, uniform: N = t_uniform;
const vec2: N = t_vec2, vec4: N = t_vec4, float: N = t_float, sin: N = t_sin, cos: N = t_cos, fract: N = t_fract;
const positionGeometry: N = t_positionGeometry, length: N = t_length, smoothstep: N = t_smoothstep, hash: N = t_hash, uv: N = t_uv;

const COUNTS = [50_000, 100_000, 200_000];
const WARM_MS = 2000;
const MEASURE_MS = 5000;

export interface ProbeRow {
  count: number;
  frames: number;
  fpsMedian: number;
  msMedian: number;
  msP95: number;
  low1Fps: number;
  gpuComputeMs: number | null;
  gpuRenderMs: number | null;
}

const pct = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? 0;
};

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

export async function runProbe(out: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const forceWebGL = params.get('backend') === 'webgl';
  const state: { done: boolean; rows: ProbeRow[]; info: Record<string, unknown>; error?: string } = { done: false, rows: [], info: {} };
  (window as unknown as { __probe: typeof state }).__probe = state;
  const log = (s: string) => {
    out.textContent += s + '\n';
  };

  try {
    const canvas = document.createElement('canvas');
    document.getElementById('stage')!.appendChild(canvas);
    const renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL, trackTimestamp: true });
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.setClearColor(new Color(0xf3ecdd), 1);
    await renderer.init();
    const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl';
    let adapterInfo: Record<string, unknown> = {};
    try {
      const a = await (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info: Record<string, unknown>; features: Set<string> } | null> } }).gpu?.requestAdapter();
      if (a) adapterInfo = { vendor: a.info.vendor, architecture: a.info.architecture, timestampQuery: a.features.has('timestamp-query') };
    } catch {
      /* sans objet */
    }
    const ts = (renderer.backend as { trackTimestamp?: boolean }).trackTimestamp === true;
    state.info = { backend, ...adapterInfo, timestamps: ts, width: innerWidth, height: innerHeight, pixelRatio: renderer.getPixelRatio(), ua: navigator.userAgent };
    log(`backend ${backend} · ${JSON.stringify(adapterInfo)} · timestamps ${ts ? 'oui' : 'non'} · ${innerWidth}x${innerHeight} x${renderer.getPixelRatio()}`);

    const MAX = COUNTS[COUNTS.length - 1]!;
    const init = new Float32Array(MAX * 4);
    for (let i = 0; i < MAX; i++) {
      init[i * 4] = Math.random() * 1600;
      init[i * 4 + 1] = Math.random() * 900;
    }
    const buf = instancedArray(init, 'vec4');
    const uTime = uniform(0);
    const uDt = uniform(1 / 60);

    // Boucle simple : vitesse attirée vers un champ analytique (somme de sinus, rotationnel), dérive, rebouclage.
    const update = Fn(() => {
      const p = buf.element(instanceIndex);
      const x = p.x;
      const y = p.y;
      const t = uTime;
      const wx = sin(y.mul(0.011).add(t.mul(0.3))).mul(40).add(cos(x.mul(0.007).sub(t.mul(0.2))).mul(20)).add(15);
      const wy = cos(x.mul(0.009).add(t.mul(0.25))).mul(30).add(sin(y.mul(0.013).sub(t.mul(0.4))).mul(12));
      const k = float(0.9).mul(uDt);
      const vx = p.z.add(wx.sub(p.z).mul(k));
      const vy = p.w.add(wy.sub(p.w).mul(k));
      const nx = fract(x.add(vx.mul(uDt)).add(50).div(1700)).mul(1700).sub(50);
      const ny = fract(y.add(vy.mul(uDt)).add(50).div(1000)).mul(1000).sub(50);
      p.assign(vec4(nx, ny, vx, vy));
    });
    const computeNode = update().compute(MAX);

    const uView = uniform(vec2(1 / 800, 1 / 450));
    const mat = new MeshBasicNodeMaterial();
    const d = buf.element(instanceIndex);
    const corner = positionGeometry.xy; // -0,5 … 0,5
    const sp = length(d.zw);
    const dir = d.zw.div(sp.max(1e-3));
    const len = float(1.4).add(sp.mul(0.03));
    const off = vec2(dir.x.mul(corner.x.mul(len)).sub(dir.y.mul(corner.y.mul(1.2))), dir.y.mul(corner.x.mul(len)).add(dir.x.mul(corner.y.mul(1.2))));
    const pos = d.xy.add(off);
    mat.vertexNode = vec4(pos.x.sub(800).mul(uView.x), float(450).sub(pos.y).mul(uView.y), 0, 1);
    const r = length(uv().sub(0.5)).mul(2);
    const a = float(1).sub(smoothstep(0.4, 1, r)).mul(hash(instanceIndex).mul(0.06).add(0.04));
    mat.colorNode = vec4(0.118, 0.141, 0.188, a);
    mat.transparent = true;
    mat.depthTest = false;
    mat.depthWrite = false;
    mat.side = DoubleSide; // repère feuille (y vers le bas) : quad retourné
    const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
    mesh.frustumCulled = false;
    (mesh as unknown as { count: number }).count = COUNTS[0]!;
    const scene = new Scene();
    scene.add(mesh);
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const setView = () => {
      const s = Math.max(innerWidth / 1600, innerHeight / 900);
      (uView.value as { set(x: number, y: number): void }).set((2 * s) / innerWidth, (2 * s) / innerHeight);
    };
    setView();

    for (const count of COUNTS) {
      computeNode.count = count;
      (mesh as unknown as { count: number }).count = count;
      const dts: number[] = [];
      const gpuC: number[] = [];
      const gpuR: number[] = [];
      let resolving = false;
      await new Promise<void>((resolve) => {
        const t0 = performance.now();
        let last = -1;
        let frame = 0;
        renderer.setAnimationLoop(() => {
          const now = performance.now();
          const dt = last < 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
          if (last >= 0 && now - t0 > WARM_MS) dts.push(now - last);
          last = now;
          uTime.value = (now - t0) / 1000;
          uDt.value = dt;
          renderer.compute(computeNode);
          renderer.render(scene, cam);
          frame++;
          if (ts && !resolving && frame % 10 === 0 && now - t0 > WARM_MS) {
            resolving = true;
            Promise.all([renderer.resolveTimestampsAsync('compute'), renderer.resolveTimestampsAsync('render')])
              .then(([c, rr]) => {
                // Zéros gardés : sans le drapeau de développeur, Chromium quantifie les horodatages (moyenne non biaisée).
                if (typeof c === 'number') gpuC.push(c);
                if (typeof rr === 'number') gpuR.push(rr);
              })
              .catch(() => undefined)
              .finally(() => (resolving = false));
          }
          if (now - t0 > WARM_MS + MEASURE_MS) {
            renderer.setAnimationLoop(null);
            resolve();
          }
        });
      });
      const med = pct(dts, 0.5);
      const row: ProbeRow = {
        count,
        frames: dts.length,
        fpsMedian: 1000 / med,
        msMedian: med,
        msP95: pct(dts, 0.95),
        low1Fps: 1000 / pct(dts, 0.99),
        gpuComputeMs: gpuC.length ? mean(gpuC) : null,
        gpuRenderMs: gpuR.length ? mean(gpuR) : null,
      };
      state.rows.push(row);
      log(
        `${count.toLocaleString('fr-FR')} particules : ${row.fpsMedian.toFixed(1)} images/s médianes (${row.msMedian.toFixed(2)} ms), p95 ${row.msP95.toFixed(2)} ms, 1 % lent ${row.low1Fps.toFixed(1)} images/s, ` +
          `GPU compute (moyenne) ${row.gpuComputeMs === null ? 'n/d' : row.gpuComputeMs.toFixed(3) + ' ms'}, GPU rendu ${row.gpuRenderMs === null ? 'n/d' : row.gpuRenderMs.toFixed(3) + ' ms'} (${row.frames} images)`,
      );
    }
    log('Sonde terminée.');
  } catch (e) {
    state.error = String(e instanceof Error ? e.message : e);
    log('ERREUR : ' + state.error);
  }
  state.done = true;
}
