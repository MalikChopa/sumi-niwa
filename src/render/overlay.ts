// Couche d'encre posée sur le papier (ARCHITECTURE §4, étape 4 : « papier + encre + taches ») :
// - densité de la grille de diffusion (F-4, `complet`) : couleur = mélange(papier, sumi, 1 − exp(−K × densité)) ;
// - taches des porteurs posés (`RT_STAIN`, les deux niveaux), qui pâlissent de STAIN_FADE chaque seconde.
import {
  CustomBlending,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  SrcAlphaFactor,
  ZeroFactor,
  AddEquation,
  NormalBlending,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  float as t_float,
  max as t_max,
  positionGeometry as t_positionGeometry,
  screenCoordinate as t_screenCoordinate,
  screenSize as t_screenSize,
  select as t_select,
  smoothstep as t_smoothstep,
  texture as t_texture,
  vec2 as t_vec2,
  vec3 as t_vec3,
  vec4 as t_vec4,
  exp as t_exp,
  hash as t_hash,
  floor as t_floor,
  mix as t_mix,
} from 'three/tsl';
import { COL_SUMI, INK_ABSORB_K, SHEET_H, SHEET_W, STAIN_FADE } from '../constants';
import type { InkGrid } from './ink-grid';
import { inkUniforms } from './ink';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const float: N = t_float, max: N = t_max, positionGeometry: N = t_positionGeometry, screenCoordinate: N = t_screenCoordinate;
const screenSize: N = t_screenSize, select: N = t_select, smoothstep: N = t_smoothstep, texture: N = t_texture, vec2: N = t_vec2;
const vec3: N = t_vec3, vec4: N = t_vec4, exp: N = t_exp, hash: N = t_hash, floor: N = t_floor, mix: N = t_mix;

function rgb(hex: string): N {
  const n = parseInt(hex.slice(1), 16);
  return vec3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** `RT_STAIN` : 1600 x 900, taches (J4 : couleur prémultipliée de la saison du porteur posé, SPEC §5). */
export class Stains {
  readonly rt: RenderTarget;
  readonly stampScene = new Scene();
  private readonly fadeScene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private lastFade = -1;

  constructor(private readonly renderer: WebGPURenderer) {
    // rgba16float au lieu du rgba8 de la SPEC : × 0,995 par seconde se perd dans l'arrondi d'un octet (écart noté).
    this.rt = new RenderTarget(SHEET_W, SHEET_H, { type: HalfFloatType, depthBuffer: false });
    this.rt.texture.minFilter = LinearFilter;
    this.rt.texture.magFilter = LinearFilter;
    this.rt.texture.generateMipmaps = false;
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = vec4(positionGeometry.xy, 0, 1);
    mat.colorNode = vec4(0, 0, 0, STAIN_FADE);
    // destination × alpha source (0,995) sur les quatre canaux
    mat.transparent = true;
    mat.blending = CustomBlending;
    mat.blendSrc = ZeroFactor;
    mat.blendDst = SrcAlphaFactor;
    mat.blendEquation = AddEquation;
    mat.blendSrcAlpha = ZeroFactor;
    mat.blendDstAlpha = SrcAlphaFactor;
    mat.blendEquationAlpha = AddEquation;
    mat.depthTest = false;
    mat.depthWrite = false;
    const quad = new Mesh(new PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    this.fadeScene.add(quad);
    this.clear();
  }

  clear(): void {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.setRenderTarget(prev);
  }

  /** Pâlit (une fois par seconde, temps réel) puis pose les taches de l'image. */
  update(nowS: number): void {
    const prev = this.renderer.getRenderTarget();
    const auto = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.rt);
    if (this.lastFade < 0) this.lastFade = nowS;
    if (nowS - this.lastFade >= 1) {
      this.lastFade += 1;
      if (nowS - this.lastFade > 5) this.lastFade = nowS; // onglet caché longtemps : pas de rattrapage
      this.renderer.render(this.fadeScene, this.camera);
    }
    this.renderer.render(this.stampScene, this.camera);
    this.renderer.setRenderTarget(prev);
    this.renderer.autoClear = auto;
  }

  dispose(): void {
    this.rt.dispose();
    this.fadeScene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as MeshBasicNodeMaterial).dispose();
      }
    });
  }
}

/** Couche plein écran (ordre 1, juste après le papier) : encre de la grille et taches. */
export function buildOverlay(grid: InkGrid | null, stainTex: Texture): Mesh {
  const size = screenSize;
  const px = screenCoordinate;
  const scale = max(size.x.div(SHEET_W), size.y.div(SHEET_H));
  const p = px.sub(size.mul(0.5)).div(scale).add(vec2(SHEET_W / 2, SHEET_H / 2));
  const uv = p.div(vec2(SHEET_W, SHEET_H));
  const inSheet = uv.x.greaterThanEqual(0).and(uv.x.lessThanEqual(1)).and(uv.y.greaterThanEqual(0)).and(uv.y.lessThanEqual(1));
  const st = texture(stainTex, uv);
  const stain = st.w;
  let inkA: N = float(0);
  if (grid) {
    const g = grid.displayNode.sample(uv);
    const pap = texture(grid.paperRT.texture, uv);
    // Granulation visible : la densité suit la hauteur du papier et ses fibres, au pixel près.
    // Dans le lavis pâle (bord humide), la texture du papier domine : bord effrangé, pas un flou lisse ; dans
    // l'encre dense, elle s'efface.
    const d0 = g.z.add(g.y.mul(0.6));
    const tex = float(1.3).sub(pap.x.mul(0.75)).add(pap.y.mul(0.35));
    const dens = d0.mul(mix(float(1), tex, smoothstep(0.25, 0.02, d0)));
    // Grain fin par pixel (statique), pour qu'un lavis ne soit jamais un aplat lisse.
    const pix = floor(px);
    const grain = hash(pix.x.toUint().add(pix.y.toUint().mul(8192)).add(77)).sub(0.5).mul(0.12);
    inkA = float(1).sub(exp(dens.mul(-INK_ABSORB_K))).mul(float(1).add(grain));
  }
  // Encre sumi par-dessus les taches colorées : alpha composé, couleur = (sumi·Ai + tache prémultipliée·(1 − Ai)) / alpha.
  const ai = inkA.clamp(0, 1);
  const as = stain.clamp(0, 1);
  const a = float(1).sub(float(1).sub(ai).mul(float(1).sub(as)));
  const premult = rgb(COL_SUMI).mul(ai).add(st.xyz.mul(float(1).sub(ai)));
  const mat = new MeshBasicNodeMaterial();
  mat.vertexNode = vec4(positionGeometry.xy, 0, 1);
  // J4 : `fade` efface l'encre et les taches en fondu (nouvelle feuille, NEW_SHEET_FADE_MS).
  mat.colorNode = vec4(premult.div(max(a, 1e-4)), select(inSheet, a.mul(smoothstep(0, 0.004, a)).mul(inkUniforms.fade), float(0)));
  mat.transparent = true;
  mat.blending = NormalBlending;
  mat.depthTest = false;
  mat.depthWrite = false;
  const mesh = new Mesh(new PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}
