// F-4 : diffusion de l'encre sur une grille 2D en espace feuille (SPEC §2.1, §3, §6), niveau `complet` seulement.
// - `TEX_PAPER` : champs du papier cuits une fois (2048 x 1152, rgba8 : hauteur, fibres, capacité, moutonnement).
// - `TEX_INK_A/B` : StorageTexture rgba16float en ping-pong (R eau, G pigment mobile, B pigment déposé).
// - `RT_WET_INPUT` : cible rgba16float de la taille de la grille ; les traits nés et les porteurs posés y sont
//   rastérisés (mélange additif), puis la passe de diffusion la consomme et elle est vidée.
// Vérifié dans la source de Three 0.187 (2026-11-01) : `StorageTexture` + `type = HalfFloatType` donne le format
// GPU `rgba16float` (WebGPUTextureUtils, getFormat) avec l'usage STORAGE_BINDING ; une StorageTexture lue par
// `texture()` dans une autre passe est liée en texture échantillonnée (textureSampleLevel / textureLoad en compute).
import {
  AddEquation,
  CustomBlending,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  StorageTexture,
  UnsignedByteType,
  type WebGPURenderer,
  type Texture,
} from 'three/webgpu';
import {
  Fn as t_Fn,
  clamp as t_clamp,
  float as t_float,
  instanceIndex as t_instanceIndex,
  ivec2 as t_ivec2,
  max as t_max,
  min as t_min,
  positionGeometry as t_positionGeometry,
  screenCoordinate as t_screenCoordinate,
  select as t_select,
  smoothstep as t_smoothstep,
  texture as t_texture,
  textureStore as t_textureStore,
  uniform as t_uniform,
  vec2 as t_vec2,
  vec4 as t_vec4,
  int as t_int,
  dot as t_dot,
} from 'three/tsl';
import {
  INK_DEPOSIT,
  INK_DIFFUSE,
  INK_EDGE_EVAP,
  INK_EVAP,
  INK_FRONT,
  INK_GRANULATION,
  INK_PIGMENT_FLOW,
  SHEET_H,
  SHEET_W,
  TEX_PAPER_SIZE,
} from '../constants';
import { paperFields } from './paper';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const Fn: N = t_Fn, clamp: N = t_clamp, float: N = t_float, instanceIndex: N = t_instanceIndex, ivec2: N = t_ivec2;
const max: N = t_max, min: N = t_min, positionGeometry: N = t_positionGeometry, screenCoordinate: N = t_screenCoordinate;
const select: N = t_select, smoothstep: N = t_smoothstep, texture: N = t_texture, textureStore: N = t_textureStore;
const uniform: N = t_uniform, vec2: N = t_vec2, vec4: N = t_vec4, int: N = t_int, dot: N = t_dot;

/** Seuil « sec » de l'eau d'une cellule. */
const DRY = 0.02;

/** Décodage d'un demi-flottant IEEE 754 (relecture de la grille en mode test). */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

export interface GridReadback {
  w: number;
  h: number;
  water: Float32Array;
  pigment: Float32Array;
  deposit: Float32Array;
}

function makeStorage(w: number, h: number): StorageTexture {
  const t = new StorageTexture(w, h);
  t.type = HalfFloatType;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

export class InkGrid {
  readonly paperRT: RenderTarget;
  readonly injectScene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Nœud de texture lu par la couche d'affichage ; sa valeur suit la texture courante du ping-pong. */
  readonly displayNode: N;
  /** Dérive par le vent (INK_WIND_DRIFT × vent moyen, en cellules par sous-pas). */
  readonly drift = uniform(vec2(0, 0));
  /** Échelle de l'évaporation par sous-pas (temps réel constant d'un palier à l'autre). */
  readonly evapScale = uniform(1);
  w = 0;
  h = 0;
  private texs: [StorageTexture, StorageTexture] | null = null;
  private wet: RenderTarget | null = null;
  private steps: [N, N] | null = null;
  private cur = 0;
  private dummy: StorageTexture;

  constructor(private readonly renderer: WebGPURenderer) {
    const [pw, ph] = TEX_PAPER_SIZE;
    this.paperRT = new RenderTarget(pw, ph, { type: UnsignedByteType, depthBuffer: false });
    this.paperRT.texture.minFilter = LinearFilter;
    this.paperRT.texture.magFilter = LinearFilter;
    this.paperRT.texture.generateMipmaps = false;
    this.dummy = makeStorage(1, 1);
    this.displayNode = texture(this.dummy);
  }

  /** Cuit `TEX_PAPER` (une fois). */
  bakePaper(): void {
    const [pw, ph] = TEX_PAPER_SIZE;
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = vec4(positionGeometry.xy, 0, 1);
    const p = screenCoordinate.div(vec2(pw, ph)).mul(vec2(SHEET_W, SHEET_H));
    mat.colorNode = paperFields(p, float(SHEET_W / pw));
    mat.depthTest = false;
    mat.depthWrite = false;
    const mesh = new Mesh(new PlaneGeometry(2, 2), mat);
    mesh.frustumCulled = false;
    const scene = new Scene();
    scene.add(mesh);
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.paperRT);
    this.renderer.render(scene, this.camera);
    this.renderer.setRenderTarget(prev);
    mat.dispose();
    mesh.geometry.dispose();
  }

  get texture(): StorageTexture | null {
    return this.texs ? (this.texs[this.cur] ?? null) : null;
  }

  get wetTarget(): RenderTarget | null {
    return this.wet;
  }

  /** (Re)dimensionne la grille ; l'encre existante est rééchantillonnée (SPEC §3 : « rééchantillonnée »). */
  setSize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    const old = this.texs ? (this.texs[this.cur] ?? null) : null;
    const texs: [StorageTexture, StorageTexture] = [makeStorage(w, h), makeStorage(w, h)];
    const wet = new RenderTarget(w, h, { type: HalfFloatType, depthBuffer: false });
    wet.texture.generateMipmaps = false;
    // Remise à zéro (une StorageTexture neuve n'est pas garantie vide) puis copie rééchantillonnée de l'ancienne.
    const init = Fn(() => {
      const i = instanceIndex;
      const x = int(i.mod(w));
      const y = int(i.div(w));
      let v: N = vec4(0, 0, 0, 0);
      if (old) {
        const uv = vec2(float(x).add(0.5).div(w), float(y).add(0.5).div(h));
        v = texture(old, uv).level(0);
      }
      textureStore(texs[0], ivec2(x, y), v);
      textureStore(texs[1], ivec2(x, y), v);
    })().compute(w * h);
    this.renderer.compute(init);
    init.dispose();
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(wet);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.setRenderTarget(prevTarget);
    if (this.texs) {
      this.texs[0].dispose();
      this.texs[1].dispose();
    }
    this.wet?.dispose();
    this.steps?.forEach((s) => s.dispose());
    this.texs = texs;
    this.wet = wet;
    this.w = w;
    this.h = h;
    this.cur = 0;
    this.steps = [this.buildStep(texs[0], texs[1], wet.texture), this.buildStep(texs[1], texs[0], wet.texture)];
    this.displayNode.value = texs[0];
  }

  /** Efface toute l'encre (nouvelle feuille, J4) : les deux textures et l'entrée d'eau sont remises à zéro. */
  clear(): void {
    if (!this.texs || !this.wet) return;
    const texs = this.texs;
    const w = this.w;
    const zero = Fn(() => {
      const i = instanceIndex;
      const x = int(i.mod(w));
      const y = int(i.div(w));
      textureStore(texs[0], ivec2(x, y), vec4(0, 0, 0, 0));
      textureStore(texs[1], ivec2(x, y), vec4(0, 0, 0, 0));
    })().compute(this.w * this.h);
    this.renderer.compute(zero);
    zero.dispose();
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.wet);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.setRenderTarget(prev);
  }

  /** Une passe de diffusion (A → B ou B → A). */
  private buildStep(src: StorageTexture, dst: StorageTexture, wetTex: Texture): N {
    const w =(src.image as { width: number }).width;
    const h = (src.image as { height: number }).height;
    const paper = this.paperRT.texture;
    const drift = this.drift;
    const evapScale = this.evapScale;
    return Fn(() => {
      const i = instanceIndex;
      const x = int(i.mod(w));
      const y = int(i.div(w));
      const ld = (dx: number, dy: number) => texture(src).load(ivec2(clamp(x.add(dx), 0, w - 1), clamp(y.add(dy), 0, h - 1)));
      const c = ld(0, 0);
      const inp = texture(wetTex).load(ivec2(x, y));
      const uv = vec2(float(x).add(0.5).div(w), float(y).add(0.5).div(h));
      const pap = texture(paper, uv).level(0);
      const hgt = pap.x;
      const cap = pap.z;
      const W0 = c.x.add(inp.x).toVar();
      const P0 = c.y.add(inp.y).toVar();
      const D0 = c.z;
      // Résistance du papier : une crête (hauteur) retient le front d'eau, d'où un bord irrégulier qui suit
      // les fibres au lieu d'un flou uniforme.
      const res = float(INK_FRONT.base).add(hgt.mul(INK_FRONT.height));
      const k = float(INK_DIFFUSE).mul(cap.mul(0.45).add(0.55));
      const conc0 = P0.div(max(W0, 0.05));
      const wet0 = W0.greaterThan(DRY);
      const fW = float(0).toVar();
      const fP = float(0).toVar();
      const minN = float(10).toVar();
      const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dx, dy] of dirs) {
        const n = ld(dx, dy);
        const Wn = n.x;
        minN.assign(min(minN, Wn));
        const diff = Wn.sub(W0);
        const gIn = select(wet0, float(1), smoothstep(res, res.add(INK_FRONT.soft), Wn));
        const gOut = select(Wn.greaterThan(DRY), float(1), smoothstep(res, res.add(INK_FRONT.soft), W0));
        // Dérive (INK_WIND_DRIFT) : l'eau suit le vent, de la cellule amont vers l'aval.
        const toward = dot(drift, vec2(-dx, -dy));
        const fl = k.mul(diff).mul(select(diff.greaterThan(0), gIn, gOut)).add(max(toward, 0).mul(Wn)).sub(max(toward.negate(), 0).mul(W0));
        const concN = n.y.div(max(Wn, 0.05));
        fW.addAssign(fl);
        fP.addAssign(fl.mul(select(fl.greaterThan(0), concN, conc0)).mul(INK_PIGMENT_FLOW));
      }
      const edge = wet0.and(minN.lessThan(DRY));
      const evap = float(INK_EVAP).mul(evapScale).mul(select(edge, float(INK_EDGE_EVAP), float(1)));
      const W1 = max(W0.add(fW).mul(float(1).sub(evap)).sub(evapScale.mul(INK_FRONT.evapSub)), 0).toVar();
      const P1 = max(P0.add(fP), 0).toVar();
      // Dépôt : plus fort dans les creux du papier (granulation) et là où l'eau manque (bord qui sèche).
      const gran = float(1).add(float(INK_GRANULATION).mul(float(1).sub(hgt.mul(2))));
      const low = float(1).sub(smoothstep(0, 0.2, W1)).mul(INK_FRONT.low);
      const rate = clamp(float(INK_DEPOSIT).mul(gran).add(low), 0, 1);
      const dry = W1.lessThan(0.003);
      const dep = select(dry, P1, P1.mul(rate));
      textureStore(dst, ivec2(x, y), vec4(select(dry, float(0), W1), P1.sub(dep), D0.add(dep), 0));
    })().compute(w * h);
  }

  /** Un sous-pas : consomme `RT_WET_INPUT`, le vide, échange les textures. */
  step(): void {
    if (!this.steps || !this.wet || !this.texs) return;
    this.renderer.compute(this.steps[this.cur]);
    this.cur = 1 - this.cur;
    this.displayNode.value = this.texs[this.cur];
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.wet);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.setRenderTarget(prev);
  }

  /** Rastérise `injectScene` (traits nés, porteurs posés) dans `RT_WET_INPUT`, sans effacer. */
  inject(): void {
    if (!this.wet) return;
    const prev = this.renderer.getRenderTarget();
    const auto = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.wet);
    this.renderer.render(this.injectScene, this.camera);
    this.renderer.setRenderTarget(prev);
    this.renderer.autoClear = auto;
  }

  /** Relecture de la grille (mode test). */
  async readback(): Promise<GridReadback | null> {
    const t = this.texture;
    if (!t) return null;
    const raw = (await (this.renderer.backend as unknown as { copyTextureToBuffer(t: Texture, x: number, y: number, w: number, h: number, f: number): Promise<Uint16Array> }).copyTextureToBuffer(
      t,
      0,
      0,
      this.w,
      this.h,
      0,
    )) as Uint16Array;
    const n = this.w * this.h;
    const water = new Float32Array(n);
    const pigment = new Float32Array(n);
    const deposit = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      water[i] = halfToFloat(raw[i * 4]!);
      pigment[i] = halfToFloat(raw[i * 4 + 1]!);
      deposit[i] = halfToFloat(raw[i * 4 + 2]!);
    }
    return { w: this.w, h: this.h, water, pigment, deposit };
  }

  dispose(): void {
    this.texs?.forEach((t) => t.dispose());
    this.wet?.dispose();
    this.steps?.forEach((s) => s.dispose());
    this.paperRT.dispose();
    this.dummy.dispose();
  }
}

/** Mélange additif (eau, pigment) pour les matériaux d'injection. */
export function additive(mat: MeshBasicNodeMaterial): MeshBasicNodeMaterial {
  mat.transparent = true;
  mat.blending = CustomBlending;
  mat.blendSrc = OneFactor;
  mat.blendDst = OneFactor;
  mat.blendEquation = AddEquation;
  mat.blendSrcAlpha = OneFactor;
  mat.blendDstAlpha = OneFactor;
  mat.blendEquationAlpha = AddEquation;
  mat.depthTest = false;
  mat.depthWrite = false;
  return mat;
}
