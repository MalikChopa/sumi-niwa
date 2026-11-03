// F-1 : papier washi plein écran, rendu par un fragment shader TSL (Three.js WebGPU, repli WebGL2 automatique).
// Tout est calculé dans l'espace sRVB d'affichage (comme les filtres SVG de la maquette) :
// le renderer sort en `LinearSRGBColorSpace` (pas de conversion), les constantes sont des valeurs sRVB 0-1.
import {
  WebGPURenderer,
  MeshBasicNodeMaterial,
  Mesh,
  PlaneGeometry,
  Scene,
  OrthographicCamera,
  LinearSRGBColorSpace,
} from 'three/webgpu';
import {
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  screenCoordinate,
  screenSize,
  hash,
  floor,
  fract,
  mix,
  smoothstep,
  sin,
  cos,
  dot,
  clamp,
  max,
  length,
  positionGeometry,
  step,
  abs,
} from 'three/tsl';
import {
  COL_WASHI,
  PAPER_BREATH,
  PAPER_BREATH_PERIOD_S,
  PAPER_FBM_OCTAVES,
  PAPER_FIBERS,
  PAPER_GRAIN,
  SHEET_H,
  SHEET_W,
  VIGNETTE,
} from '../constants';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number];
}

// Les types des nœuds TSL sont très variables d'une version à l'autre : alias local unique.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** Hachage d'une cellule entière (x, y) et d'un sel, clé exacte en float32 tant que < 2^24. */
const cellHash = (ix: N, iy: N, salt: number): N =>
  hash(ix.add(64).add(iy.add(64).mul(1024)).add(salt * 1048576));

/** Bruit de valeur lissé, 0-1. */
function vnoise(p: N, salt: number): N {
  const i: N = floor(p);
  const f: N = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = cellHash(i.x, i.y, salt);
  const b = cellHash(i.x.add(1), i.y, salt);
  const c = cellHash(i.x, i.y.add(1), salt);
  const d = cellHash(i.x.add(1), i.y.add(1), salt);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/** Bruit fractal à `PAPER_FBM_OCTAVES` octaves, 0-1 environ. */
function fbm(p: N, salt: number, octaves = PAPER_FBM_OCTAVES): N {
  let sum: N = float(0);
  let amp = 0.5;
  let norm = 0;
  let q = p;
  for (let o = 0; o < octaves; o++) {
    sum = sum.add(vnoise(q, salt + o).mul(amp));
    norm += amp;
    amp *= 0.5;
    q = q.mul(2.03).add(vec2(17.3, 9.1));
  }
  return sum.div(norm);
}

/** Fibres courtes du papier en p (uf) : couvertures sombre et claire (0–1). `aa` = un pixel en uf. */
function fibres(p: N, aa: N): { dark: N; light: N } {
  const cell = Math.sqrt((SHEET_W * SHEET_H) / PAPER_FIBERS);
  const q: N = p.div(cell);
  const c0: N = floor(q);
  let dark: N = float(0);
  let light: N = float(0);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = c0.x.add(dx);
      const cy = c0.y.add(dy);
      const center = vec2(
        cx.add(cellHash(cx, cy, 2).mul(0.8).add(0.1)),
        cy.add(cellHash(cx, cy, 3).mul(0.8).add(0.1)),
      ).mul(cell);
      // Orientations réparties sur tout le demi-tour : aucune direction dominante.
      const ang = cellHash(cx, cy, 4).mul(Math.PI);
      const dir = vec2(cos(ang), sin(ang));
      const half = cellHash(cx, cy, 5).mul(4).add(2.5);
      const wid = cellHash(cx, cy, 6).mul(0.17).add(0.18);
      const strength = cellHash(cx, cy, 7).mul(0.5).add(0.3);
      const isDark = step(0.3, cellHash(cx, cy, 1));
      const d = p.sub(center);
      const along = dot(d, dir);
      const t = clamp(along, half.negate(), half);
      const dist = length(d.sub(dir.mul(t)));
      const cov = float(1)
        .sub(smoothstep(wid.sub(aa.mul(0.5)), wid.add(aa.mul(0.9)), dist))
        .mul(float(1).sub(smoothstep(half.mul(0.55), half, abs(along))))
        .mul(strength);
      dark = max(dark, cov.mul(isDark));
      light = max(light, cov.mul(float(1).sub(isDark)));
    }
  }
  return { dark, light };
}

/**
 * Champs du papier pour la diffusion (SPEC §2.1 `TEX_PAPER`, J3) en p (uf) : R hauteur, G densité de fibres,
 * B capacité d'absorption, A moutonnement. Mêmes nuages et mêmes fibres que le papier affiché (l'encre suit
 * ce qu'on voit), plus un bruit fin (le « grain » de la pâte) pour casser l'uniformité de la diffusion.
 */
export function paperFields(p: N, aa: N): N {
  const clouds = fbm(p.div(240), 1);
  const fine = fbm(p.div(3.2), 21, 3);
  const { dark, light } = fibres(p, aa);
  const fib = max(dark, light);
  const height = clamp(fine.mul(0.55).add(clouds.mul(0.25)).add(fib.mul(0.35)).sub(0.05), 0, 1);
  const capacity = clamp(float(0.45).add(fib.mul(0.5)).add(clouds.sub(0.5).mul(0.3)).add(fine.sub(0.5).mul(0.25)), 0, 1);
  return vec4(height, clamp(fib, 0, 1), capacity, clouds);
}

export interface PaperUniforms {
  time: { value: number };
  breath: { value: number };
}

/** Construit le nœud de couleur du papier. */
function buildPaperColor(uTime: N, uBreath: N): N {
  const [wr, wg, wb] = hexToRgb(COL_WASHI);
  const washi = vec3(wr, wg, wb);
  const [vr, vg, vb] = hexToRgb(VIGNETTE.color);

  const size = screenSize; // taille du tampon de dessin en pixels
  const px = screenCoordinate; // pixels, origine en haut à gauche (convention WebGPU, aussi en WebGL2)

  // Coordonnées feuille (uf), ajustement « cover » : max(l/1600, h/900) pixels par uf.
  const scale = max(size.x.div(SHEET_W), size.y.div(SHEET_H));
  const p = px.sub(size.mul(0.5)).div(scale).add(vec2(SHEET_W / 2, SHEET_H / 2));
  const aa = float(1).div(scale); // un pixel, en uf

  // 1. Nuages doux (mottling) : écart de ±1,5 % de luminance.
  const clouds = fbm(p.div(240), 1);
  let col: N = washi.mul(float(1).add(clouds.sub(0.5).mul(0.03)));

  // 2. Veines horizontales (équivalent du filtre `fibers` de la maquette : fréquences 0,012 x 0,3 par uf,
  //    multiplié par un brun chaud), adoucies en correction 1 : très faibles, peu étirées. Deux octaves.
  const streakN = fbm(vec2(p.x.mul(0.045), p.y.mul(0.11)), 8, 2);
  const streak = smoothstep(0.35, 0.85, streakN).mul(0.05);
  col = col.mul(mix(vec3(1, 1, 1), vec3(0.62, 0.53, 0.38), streak));

  // 3. Fibres courtes : une par cellule de ~15,5 uf (6 000 sur la feuille), recherche sur 3 x 3 cellules.
  const { dark, light } = fibres(p, aa);
  col = mix(col, vec3(0.55, 0.47, 0.33), dark.mul(0.14));
  col = mix(col, vec3(0.992, 0.975, 0.94), light.mul(0.35));

  // 4. Grain fin par pixel d'écran, statique (amplitude PAPER_GRAIN), entier hachés (pas de sin).
  const pix = floor(px);
  const gkey = pix.x.toUint().add(pix.y.toUint().mul(8192));
  const g = hash(gkey).add(hash(gkey.add(104729))).sub(1); // loi triangulaire, -1..1
  col = col.mul(float(1).add(g.mul(PAPER_GRAIN)));

  // 5. Vignette (maquette : ellipse r = 75 %, centre 50 % / 48 %, de 62 % à 100 %, opacité max 0,22).
  const uv = px.div(size);
  const vt = length(vec2(uv.x.sub(0.5), uv.y.sub(0.48)).div(0.75));
  const vk = clamp(vt.sub(VIGNETTE.start).div(1 - VIGNETTE.start), 0, 1).mul(VIGNETTE.maxOpacity);
  col = mix(col, vec3(vr, vg, vb), vk);

  // 6. Respiration : variation crête à crête = uBreath (PAPER_BREATH), période PAPER_BREATH_PERIOD_S.
  const phase = uTime.mul((2 * Math.PI) / PAPER_BREATH_PERIOD_S);
  col = col.mul(float(1).add(sin(phase).mul(uBreath).mul(0.5)));

  return vec4(col, 1);
}

export interface Paper {
  renderer: WebGPURenderer;
  /** Scène commune : le papier (ordre 0), puis les couches d'encre ajoutées par le jardin (J2). */
  scene: Scene;
  camera: OrthographicCamera;
  /**
   * Crochet appelé à chaque image avant le rendu (temps `performance.now()`), et à chaque redimensionnement.
   * Il renvoie `true` s'il faut redessiner (croissance en cours), même en mouvement réduit.
   */
  setFrameHook(hook: ((now: number) => boolean) | null): void;
  setResizeHook(hook: ((w: number, h: number) => void) | null): void;
  /** Rendu immédiat hors boucle (crochets de test `step`). */
  renderOnce(): void;
  /** `webgpu` ou `webgl`, lu sur le backend réellement obtenu. */
  backend: 'webgpu' | 'webgl';
  /** Dessine une image tout de suite (premier dessin, redimensionnement). */
  renderNow(): Promise<void>;
  /** Démarre la boucle (respiration) ; en mouvement réduit, ne redessine qu'au besoin. */
  start(): void;
  /** Arrête la boucle (perte du device). */
  stop(): void;
  dispose(): void;
  /** Échelle de rendu d'un palier (SPEC §3) : ratio de pixels = min(devicePixelRatio, maxRatio) × scale. */
  setRenderScale(scale: number, maxRatio: number): void;
  /** Perte du device (raison quelconque, y compris `destroyed` pour la perte simulée du mode test). */
  setDeviceLostHook(hook: ((info: { reason: string | null; message: string }) => void) | null): void;
  /** Taille du tampon de dessin (pixels). */
  drawingSize(): { w: number; h: number; ratio: number };
}

export interface PaperOptions {
  canvas: HTMLCanvasElement;
  /** `true` : backend WebGL2 de Three (niveau reduit). */
  forceWebGL: boolean;
}

/** Ratio de pixels plafonné au J1 (2) ; les paliers du J3 le réduisent (SPEC §3). */
const ratioCfg = { scale: 1, max: 2 };
const pixelRatio = () => Math.max(0.25, Math.min(window.devicePixelRatio || 1, ratioCfg.max) * ratioCfg.scale);

export async function createPaper({ canvas, forceWebGL }: PaperOptions): Promise<Paper> {
  // Horodatages GPU (contrôleur, bench) en WebGPU seulement ; sans `timestamp-query`, Three les ignore.
  const renderer = new WebGPURenderer({ canvas, antialias: false, alpha: false, forceWebGL, trackTimestamp: !forceWebGL });
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
  await renderer.init();
  // Perte du device (ARCHITECTURE §7) : remplace le gestionnaire de Three (qui journalise une erreur sans rien recréer).
  let lostHook: ((info: { reason: string | null; message: string }) => void) | null = null;
  (renderer as unknown as { onDeviceLost: (i: { reason?: string | null; message?: string }) => void }).onDeviceLost = (i) => {
    renderer.setAnimationLoop(null);
    lostHook?.({ reason: i.reason ?? null, message: i.message ?? '' });
  };

  const uTime = uniform(0);
  const uBreath = uniform(PAPER_BREATH);
  const material = new MeshBasicNodeMaterial();
  material.vertexNode = vec4(positionGeometry.xy, 0, 1);
  material.colorNode = buildPaperColor(uTime, uBreath);
  material.depthTest = false;
  material.depthWrite = false;

  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0; // le papier d'abord, l'encre par-dessus
  const scene = new Scene();
  scene.add(mesh);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motion.matches;
  const applyMotion = () => {
    reduced = motion.matches;
    uBreath.value = reduced ? 0 : PAPER_BREATH; // REDUCED_MOTION : respiration 0
    dirty = true;
  };
  let dirty = true;
  motion.addEventListener('change', applyMotion);
  uBreath.value = reduced ? 0 : PAPER_BREATH;

  let frameHook: ((now: number) => boolean) | null = null;
  let resizeHook: ((w: number, h: number) => void) | null = null;
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 1 || h < 1) return; // fenêtre de taille nulle : rendu suspendu (SPEC §11)
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(w, h);
    resizeHook?.(w, h);
    dirty = true;
  };
  window.addEventListener('resize', resize);

  const t0 = performance.now();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl';

  const renderNow = async () => {
    uTime.value = (performance.now() - t0) / 1000;
    await renderer.compileAsync(scene, camera); // pipeline prêt avant le premier dessin
    renderer.render(scene, camera);
    dirty = false;
  };

  const start = () => {
    renderer.setAnimationLoop(() => {
      if (window.innerWidth < 1 || window.innerHeight < 1) return;
      const now = performance.now();
      const wants = frameHook ? frameHook(now) : false;
      if (reduced && !dirty && !wants) return; // papier immobile : aucun redessin inutile
      uTime.value = (now - t0) / 1000;
      renderer.render(scene, camera);
      dirty = false;
    });
  };

  const stop = () => renderer.setAnimationLoop(null);
  const dispose = () => {
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', resize);
    motion.removeEventListener('change', applyMotion);
    lostHook = null;
    try {
      material.dispose();
      mesh.geometry.dispose();
      renderer.dispose();
    } catch {
      /* device perdu : la libération peut échouer, sans conséquence */
    }
  };
  const setRenderScale = (scale: number, maxRatio: number) => {
    if (ratioCfg.scale === scale && ratioCfg.max === maxRatio) return;
    ratioCfg.scale = scale;
    ratioCfg.max = maxRatio;
    resize();
  };
  const setDeviceLostHook = (hook: ((info: { reason: string | null; message: string }) => void) | null) => {
    lostHook = hook;
  };
  const drawingSize = () => ({ w: canvas.width, h: canvas.height, ratio: renderer.getPixelRatio() });

  const setFrameHook = (hook: ((now: number) => boolean) | null) => {
    frameHook = hook;
  };
  const setResizeHook = (hook: ((w: number, h: number) => void) | null) => {
    resizeHook = hook;
    hook?.(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
  };
  const renderOnce = () => {
    uTime.value = (performance.now() - t0) / 1000;
    renderer.render(scene, camera);
  };

  return { renderer, backend, scene, camera, setFrameHook, setResizeHook, renderOnce, renderNow, start, stop, dispose, setRenderScale, setDeviceLostHook, drawingSize };
}
