// Export PNG (F-8, ARCHITECTURE §11, SPEC §8) : `renderSheet` rend la feuille entière (1600 x 900 uf) dans une cible
// hors écran de 3 840 x 2 160 (ou la limite du GPU), relit les pixels, y ajoute le sceau (tracé maison) et produit
// le PNG. L'interface (DOM : barre, jauge, messages) n'est jamais dans le canvas WebGPU / WebGL : elle ne peut pas
// figurer dans le fichier. Plan B (SPEC §8) : `canvas.toBlob` à la taille de l'écran.
// Même code en `complet` (WebGPU) et en `reduit` (WebGL2).
import { RenderTarget, UnsignedByteType } from 'three/webgpu';
import { COL_ERABLE, COL_WASHI, SEAL, SHEET_W } from '../constants';
import { exportFileName, exportSize, type Lang } from '../core/export-name';
import type { Paper } from './paper';
import { setInkView } from './ink';

export interface ExportResult {
  blob: Blob;
  name: string;
  width: number;
  height: number;
  /** durée totale (ms), du début de la demande à l'objet PNG prêt */
  ms: number;
  renderMs: number;
  readMs: number;
  encodeMs: number;
  /** true : plan B (capture du canvas à la taille de l'écran) */
  fallback: boolean;
}

export interface ExportOptions {
  paper: Paper;
  graine: number;
  saison: number;
  lang: Lang;
  /** Appelé juste avant le rendu hors écran ; renvoie la fonction qui remet l'état (graine d'encre masquée, etc.). */
  prepare?: () => () => void;
}

/** Taille maximale d'une texture 2D du backend actif (WebGPU : limites du device ; WebGL2 : MAX_TEXTURE_SIZE). */
export function maxTextureSize(paper: Paper): number {
  const b = paper.renderer.backend as unknown as {
    device?: { limits?: { maxTextureDimension2D?: number } };
    gl?: { getParameter(p: number): unknown; MAX_TEXTURE_SIZE: number };
  };
  const lim = b.device?.limits?.maxTextureDimension2D;
  if (typeof lim === 'number' && lim > 0) return lim;
  if (b.gl) {
    const v = b.gl.getParameter(b.gl.MAX_TEXTURE_SIZE);
    if (typeof v === 'number' && v > 0) return v;
  }
  return 4096;
}

/** Générateur pseudo-aléatoire local (usure du sceau), seulement pour l'aspect. */
function mulberry(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sceau rouge érable de 44 uf en (1500, 820) (SPEC §8) : carré aux angles arrondis et au bord un peu irrégulier,
 * avec en réserve une jeune pousse (tige, deux feuilles), des points d'usure. Tracé à la main (aucun fichier).
 */
export function drawSeal(ctx: CanvasRenderingContext2D, k: number, seed: number): void {
  const rnd = mulberry(seed ^ 0x5ea1);
  const x0 = SEAL.x * k;
  const y0 = SEAL.y * k;
  const s = SEAL.size * k;
  const jit = () => (rnd() - 0.5) * 0.045 * s;
  ctx.save();
  ctx.translate(x0, y0);
  // Fond : quatre sommets légèrement déplacés, angles arrondis par des courbes quadratiques.
  const c = [
    [0 + jit(), 0 + jit()],
    [s + jit(), 0 + jit()],
    [s + jit(), s + jit()],
    [0 + jit(), s + jit()],
  ] as const;
  const r = 0.16 * s;
  const mid = (a: readonly number[], b: readonly number[], t: number) => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t] as const;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const p = c[i]!;
    const prev = c[(i + 3) % 4]!;
    const next = c[(i + 1) % 4]!;
    const len1 = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    const len2 = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const a = mid(p, prev, r / len1);
    const b = mid(p, next, r / len2);
    if (i === 0) ctx.moveTo(a[0], a[1]);
    else ctx.lineTo(a[0], a[1]);
    ctx.quadraticCurveTo(p[0], p[1], b[0], b[1]);
  }
  ctx.closePath();
  ctx.fillStyle = COL_ERABLE;
  ctx.globalAlpha = 0.93;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.clip();
  // Pousse en réserve (couleur du papier).
  ctx.fillStyle = COL_WASHI;
  ctx.strokeStyle = COL_WASHI;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.075 * s;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.moveTo(0.5 * s, 0.84 * s);
  ctx.quadraticCurveTo(0.46 * s, 0.56 * s, 0.52 * s, 0.2 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.49 * s, 0.64 * s);
  ctx.bezierCurveTo(0.3 * s, 0.64 * s, 0.19 * s, 0.52 * s, 0.21 * s, 0.37 * s);
  ctx.bezierCurveTo(0.38 * s, 0.39 * s, 0.47 * s, 0.5 * s, 0.49 * s, 0.64 * s);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.51 * s, 0.5 * s);
  ctx.bezierCurveTo(0.7 * s, 0.5 * s, 0.81 * s, 0.38 * s, 0.79 * s, 0.23 * s);
  ctx.bezierCurveTo(0.62 * s, 0.25 * s, 0.53 * s, 0.36 * s, 0.51 * s, 0.5 * s);
  ctx.fill();
  // Usure : des points de papier épars, comme un sceau tamponné à l'encre.
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    ctx.arc(rnd() * s, rnd() * s, (0.006 + rnd() * 0.02) * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob a renvoyé null'))), 'image/png');
  });
}

/**
 * Rend la feuille entière (hors écran) et la relit : pixels RGBA, première ligne = haut de la feuille, opaques.
 * Le rendu suit exactement celui de l'écran (mêmes nuanceurs, ajustement « cover » sur une cible de 16:9).
 */
export async function renderSheet(paper: Paper, w: number, h: number, prepare?: () => () => void): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const renderer = paper.renderer;
  const rt = new RenderTarget(w, h, { type: UnsignedByteType, depthBuffer: false });
  rt.texture.generateMipmaps = false;
  const restore = prepare ? prepare() : null;
  let data: ArrayLike<number>;
  try {
    setInkView(w, h); // projection « cover » de la cible : la feuille entière, sans marge
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(paper.scene, paper.camera);
    renderer.setRenderTarget(prev);
  } finally {
    setInkView(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
    restore?.();
  }
  try {
    data = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as unknown as ArrayLike<number>;
  } finally {
    rt.dispose();
  }
  const px = new Uint8ClampedArray(w * h * 4);
  px.set(data as ArrayLike<number>);
  // Orientation : WebGPU renvoie la première ligne en haut ; WebGL2 (readPixels) en bas → on retourne les lignes.
  if (paper.backend === 'webgl') {
    const row = w * 4;
    const tmp = new Uint8ClampedArray(row);
    for (let y = 0; y < h >> 1; y++) {
      const a = y * row;
      const b = (h - 1 - y) * row;
      tmp.set(px.subarray(a, a + row));
      px.copyWithin(a, b, b + row);
      px.set(tmp, b);
    }
  }
  for (let i = 3; i < px.length; i += 4) px[i] = 255; // PNG opaque
  return px;
}

/** Exporte la feuille en PNG (SPEC §8). Plan B si le rendu hors écran échoue : capture du canvas. */
export async function exportSheetPng(o: ExportOptions): Promise<ExportResult> {
  const t0 = performance.now();
  const name = exportFileName(o.graine, o.saison, o.lang);
  const { w, h } = exportSize(maxTextureSize(o.paper));
  try {
    const px = await renderSheet(o.paper, w, h, o.prepare);
    const t1 = performance.now();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D indisponible');
    ctx.putImageData(new ImageData(px, w, h), 0, 0);
    drawSeal(ctx, w / SHEET_W, o.graine);
    const t2 = performance.now();
    const blob = await toBlob(canvas);
    const t3 = performance.now();
    canvas.width = canvas.height = 1; // libère les 33 Mo
    return { blob, name, width: w, height: h, ms: t3 - t0, renderMs: t1 - t0, readMs: t2 - t1, encodeMs: t3 - t2, fallback: false };
  } catch (e) {
    console.warn('Export hors écran échoué, capture du canvas (plan B)', e);
    const restore = o.prepare ? o.prepare() : null;
    o.paper.renderOnce();
    const src = o.paper.renderer.domElement;
    const copy = document.createElement('canvas');
    copy.width = src.width;
    copy.height = src.height;
    const ctx = copy.getContext('2d');
    if (!ctx) throw e;
    ctx.drawImage(src, 0, 0);
    restore?.();
    const blob = await toBlob(copy);
    const t3 = performance.now();
    return { blob, name, width: copy.width, height: copy.height, ms: t3 - t0, renderMs: 0, readMs: 0, encodeMs: 0, fallback: true };
  }
}

/** Provoque le téléchargement du fichier (lien temporaire). */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

