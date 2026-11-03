// Effets du J3, orchestrés image par image (ARCHITECTURE §4, étape 5) :
// (1) particules (compute, vent analytique en uniformes) ; (2) injection des traits nés et des porteurs posés
// dans `RT_WET_INPUT`, taches dans `RT_STAIN` ; (3) diffusion + séchage selon le palier (absente en `reduit`) ;
// (4) le rendu principal (papier, couche d'encre, traits, marques, particules) reste celui de paper.ts.
// Les passes sont nommées pour les horodatages GPU (bench, contrôleur).
import type { Mesh } from 'three/webgpu';
import { REDUCED_MOTION, SEASON_CARRIER_TYPE, SEASON_FALL_REF, SEASON_MIST_REF, TIERS, type TierId, type TierSpec } from '../constants';
import { settingsFor, type Weights } from '../core/seasons';
import type { Paper } from '../render/paper';
import { InkGrid } from '../render/ink-grid';
import { Particles } from '../render/particles';
import { Stains, buildOverlay } from '../render/overlay';
import { inkUniforms } from '../render/ink';
import { Wind, windUniforms, breezeAt } from '../sim/wind';
import { INK_WIND_DRIFT } from '../constants';

export interface EffectsOptions {
  paper: Paper;
  level: 'complet' | 'reduit';
  /** saison du jardin (0 printemps … 3 hiver) : type des porteurs */
  season: number;
  /** particules et brise actives (coupées par défaut en mode test, `&fx=1` les rallume) */
  fx: boolean;
  seed: number;
  tier: TierId;
}

export interface PassStats {
  /** ms GPU moyennes par image et par passe (dernière fenêtre résolue) */
  perPass: Record<string, number>;
  /** ms GPU moyennes par image (toutes passes) */
  frameMs: number;
  frames: number;
}

export class Effects {
  readonly wind = new Wind();
  readonly grid: InkGrid | null;
  readonly particles: Particles;
  readonly stains: Stains;
  readonly level: 'complet' | 'reduit';
  tier: TierSpec;
  private readonly paper: Paper;
  private readonly overlay: Mesh;
  private fx: boolean;
  /** facteur de brise de la saison (SPEC §5), appliqué à `windUniforms.breeze` quand les effets sont actifs */
  private breezeK = 1;
  private reduced = false;
  private readonly motion: MediaQueryList;
  private lastInject = -1e9;
  private frameNo = 0;
  private cadence = 0;
  /** passes nommées : `type:indice:fimage` → nom */
  private readonly passLog = new Map<string, string>();
  private resolving = false;
  private last: PassStats = { perPass: {}, frameMs: 0, frames: 0 };
  /** Réponse au vent : de `event.timeStamp` à l'image qui suit celle où l'impulsion est envoyée au GPU (ms). */
  readonly windResponses: number[] = [];
  private windShown: number[] = [];
  /** Charge simulée (mode test) : attente active par image, en ms. */
  simulatedLoadMs = 0;
  /** Rafales en cours (J5) : un curseur virtuel balaie la feuille et alimente le vent comme le ferait la souris. */
  private readonly gusts: { x0: number; y0: number; x1: number; y1: number; start: number; durMs: number }[] = [];
  /** Rafales lancées depuis la création (mesure). */
  gustCount = 0;

  constructor(opts: EffectsOptions) {
    this.paper = opts.paper;
    this.level = opts.level;
    this.fx = opts.fx;
    const renderer = opts.paper.renderer;
    const complet = opts.level === 'complet';
    this.grid = complet ? new InkGrid(renderer) : null;
    this.stains = new Stains(renderer);
    const maxT = complet ? TIERS.T3 : TIERS.R;
    this.particles = new Particles(renderer, { maxMotes: maxT.motes, maxCarriers: maxT.carriers, counters: complet, seed: opts.seed });
    this.particles.uniforms.seasonType.value = SEASON_CARRIER_TYPE[opts.season as 0 | 1 | 2 | 3] ?? 1;
    this.overlay = buildOverlay(this.grid, this.stains.rt.texture);
    this.particles.motesMesh.renderOrder = 800_000;
    this.particles.carriersMesh.renderOrder = 900_000;
    this.stains.stampScene.add(this.particles.stainStamp);
    if (this.grid) this.grid.injectScene.add(this.particles.wetStamp);
    inkUniforms.fringe.value = complet ? 0 : 1;
    windUniforms.breeze.value = this.fx ? 1 : 0;
    this.tier = complet ? TIERS[opts.tier] : TIERS.R;
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', this.onMotion);
    this.reduced = this.motion.matches;
  }

  private readonly onMotion = () => {
    this.reduced = this.motion.matches;
    this.applyMotion();
    this.applyCounts();
  };

  private applyMotion(): void {
    const r = this.reduced;
    windUniforms.scale.value = r ? REDUCED_MOTION.wind : 1;
    windUniforms.sway.value = r ? REDUCED_MOTION.sway : 1;
    this.particles.uniforms.fall.value = r ? REDUCED_MOTION.fall : 1;
  }

  private applyCounts(): void {
    const t = this.tier;
    const mist = this.reduced ? REDUCED_MOTION.mist : 1;
    this.particles.setActive(this.fx ? Math.round(t.motes * mist) : 0, this.fx ? t.carriers : 0);
  }

  /** Préparation : papier cuit, grille du palier, scène. */
  init(): void {
    this.grid?.bakePaper();
    this.paper.scene.add(this.overlay);
    this.paper.scene.add(this.particles.motesMesh);
    this.paper.scene.add(this.particles.carriersMesh);
    this.applyMotion();
    this.applyTier(this.tier.id);
  }

  /** Applique un palier (SPEC §3) : particules actives, grille rééchantillonnée, cadence, échelle de rendu. */
  applyTier(id: TierId): void {
    this.tier = this.level === 'complet' ? TIERS[id] : TIERS.R;
    const t = this.tier;
    this.applyCounts();
    if (this.grid && t.grid) {
      this.grid.setSize(t.grid[0], t.grid[1]);
      // Évaporation à temps réel constant : un sous-pas représente 1/(60 × sous-pas) s.
      this.grid.evapScale.value = t.substeps > 0 ? 1 / t.substeps : -t.substeps;
    }
    this.paper.setRenderScale(t.renderScale, t.maxPixelRatio);
  }

  /** Rafale (touche V, bouton Vent, pilote) : balayage de (x0, y0) à (x1, y1) en `durS` secondes à partir de `nowMs`. */
  gust(x0: number, y0: number, x1: number, y1: number, durS: number, nowMs: number = performance.now()): void {
    if (this.gusts.length >= 4) this.gusts.shift();
    this.gusts.push({ x0, y0, x1, y1, start: nowMs, durMs: Math.max(200, durS * 1000) });
    this.gustCount++;
  }

  get gusting(): boolean {
    return this.gusts.length > 0;
  }

  setFx(on: boolean): void {
    this.fx = on;
    windUniforms.breeze.value = on ? this.breezeK : 0;
    this.applyCounts();
  }

  /** Saison cible (J4) : type des nouveaux porteurs ; les porteurs en vol changent à leur réapparition (SPEC §5). */
  setSeasonType(season: 0 | 1 | 2 | 3): void {
    this.particles.uniforms.seasonType.value = SEASON_CARRIER_TYPE[season];
  }

  /** Réglages de la saison pour des poids donnés (continus pendant la transition) : part des porteurs, chute, brume, brise. */
  applySeasonBlend(w: Weights): void {
    const st = settingsFor(w, SEASON_FALL_REF, SEASON_MIST_REF);
    const u = this.particles.uniforms;
    u.part.value = st.part;
    u.seasonFall.value = st.fall;
    u.seasonMist.value = st.mist;
    // Brume : sumi (30, 36, 48) → gris bleuté (hiver × 0,62) avec le poids de l'hiver.
    const k = w[3];
    (u.mistColor.value as { set(a: number, b: number, c: number): void }).set(0.1176 + (0.6824 * 0.62 - 0.1176) * k, 0.1412 + (0.7216 * 0.62 - 0.1412) * k, 0.1882 + (0.7686 * 0.62 - 0.1882) * k);
    this.breezeK = st.breeze;
    if (this.fx) windUniforms.breeze.value = st.breeze;
  }

  /** Nouvelle feuille (J4) : grille d'encre, taches et copies d'injection des plantes effacées. */
  clearInk(): void {
    this.grid?.clear();
    this.stains.clear();
    if (this.grid) {
      for (const m of [...this.grid.injectScene.children]) {
        if ((m.userData as { until?: number }).until !== undefined) this.grid.injectScene.remove(m);
      }
    }
    this.lastInject = -1e9;
  }

  /**
   * Maillages d'une plante : balancement par espèce, et copies d'injection (même géométrie) dans la grille.
   * `until` : temps simulé après lequel plus rien de la plante ne naît (les copies ne sont plus dessinées).
   */
  addPlant(meshes: { stroke: Mesh | null; mark: Mesh | null }, swayMax: number, inject: { stroke: Mesh | null; mark: Mesh | null }, until = Infinity): void {
    for (const m of [meshes.stroke, meshes.mark]) if (m) m.userData.swayMax = swayMax;
    if (this.grid) for (const m of [inject.stroke, inject.mark]) if (m) {
      m.userData.until = until;
      this.grid.injectScene.add(m);
    }
  }

  /** Après une recréation (perte du device) : tout ce qui est né est réinjecté une fois. */
  reinjectAll(): void {
    this.lastInject = -1e9;
  }

  private mark(type: 'r' | 'c', name: string, offset = 1): void {
    // Journal des passes : utile seulement si les horodatages GPU sont lus (Chrome, Edge avec `timestamp-query`). Ailleurs, aucune
    // chaîne fabriquée, aucune purge (audit J6 point 12).
    if (!(this.paper.renderer.backend as unknown as { trackTimestamp?: boolean }).trackTimestamp) return;
    const info = this.paper.renderer.info as unknown as { frame: number; render: { frameCalls: number }; compute: { frameCalls: number } };
    const idx = (type === 'r' ? info.render.frameCalls : info.compute.frameCalls) + offset;
    this.passLog.set(`${type}:${idx}:f${info.frame}`, name);
  }

  /**
   * Une image : `nowMs` = performance.now(), `simTime` = temps simulé (s), `dtS` = pas simulé (s).
   * Retourne `true` (les effets animent toujours quelque chose, sauf mouvement réduit sans particules).
   */
  frame(nowMs: number, simTime: number, dtS: number): boolean {
    this.frameNo++;
    if (this.simulatedLoadMs > 0) {
      const until = performance.now() + this.simulatedLoadMs;
      while (performance.now() < until) {
        /* charge simulée (mode test) */
      }
    }
    // Réponse au vent : l'impulsion montée à l'image n est mesurée au début de l'image n + 1.
    for (const s of this.windShown) this.windResponses.push(nowMs - s);
    if (this.windResponses.length > 2000) this.windResponses.splice(0, 1000);
    this.windShown = this.wind.pending;
    this.wind.pending = [];
    for (let i = this.gusts.length - 1; i >= 0; i--) {
      const g = this.gusts[i]!;
      const k = (nowMs - g.start) / g.durMs;
      if (k >= 1) this.gusts.splice(i, 1);
      else if (k >= 0) this.wind.move(g.x0 + (g.x1 - g.x0) * k, g.y0 + (g.y1 - g.y0) * k, nowMs);
    }
    const nowS = nowMs / 1000;
    this.wind.upload(nowS);
    if (this.grid && INK_WIND_DRIFT !== 0) {
      const b = breezeAt(800, 450, nowS);
      (this.grid.drift.value as { set(x: number, y: number): void }).set(b[0] * INK_WIND_DRIFT * 0.001, b[1] * INK_WIND_DRIFT * 0.001);
    }
    // (1) particules
    if (this.particles.active.motes > 0) this.mark('c', 'particules');
    if (this.particles.active.carriers > 0) this.mark('c', 'porteurs', this.particles.active.motes > 0 ? 2 : 1);
    this.particles.update(Math.min(dtS, 0.05), nowS);
    // (2) injection (traits nés dans ]lastInject, simTime], porteurs posés) et taches
    if (this.grid) {
      inkUniforms.injA.value = this.lastInject;
      inkUniforms.injB.value = simTime;
      // Plantes finies : leurs copies d'injection ne sont plus dessinées (160 plantes ne coûtent rien au repos).
      for (const m of this.grid.injectScene.children) {
        const until = (m.userData as { until?: number }).until;
        if (until !== undefined) m.visible = this.lastInject <= until;
      }
      this.lastInject = simTime;
      this.mark('r', 'injection');
      this.grid.inject();
    }
    // Taches : pâlissement éventuel puis poses (deux rendus au plus ; le second indice est réécrit par « rendu »
    // s'il n'y a pas eu de pâlissement).
    this.mark('r', 'taches', 1);
    this.mark('r', 'taches', 2);
    this.stains.update(nowS);
    // (3) diffusion selon la cadence du palier
    if (this.grid) {
      const sub = this.tier.substeps;
      let n = 0;
      if (sub > 0) n = sub;
      else {
        this.cadence = (this.cadence + 1) % -sub;
        n = this.cadence === 0 ? 1 : 0;
      }
      for (let k = 0; k < n; k++) {
        this.mark('c', 'diffusion');
        this.grid.step();
      }
    }
    // (4) le rendu principal suit dans la boucle du papier
    this.mark('r', 'rendu');
    if (this.passLog.size > 4000) {
      const keys = [...this.passLog.keys()].slice(0, 2000);
      for (const k of keys) this.passLog.delete(k);
    }
    return this.fx || this.grid !== null || this.gusts.length > 0;
  }

  /** Résout les horodatages GPU (WebGPU + `timestamp-query`) et agrège par passe. Appel non bloquant. */
  pollGpu(): void {
    const r = this.paper.renderer;
    const backend = r.backend as unknown as { trackTimestamp?: boolean; timestampQueryPool?: Record<string, { timestamps: Map<string, number> } | null> };
    if (!backend.trackTimestamp || this.resolving) return;
    this.resolving = true;
    Promise.all([r.resolveTimestampsAsync('render'), r.resolveTimestampsAsync('compute')])
      .then(() => {
        const perFrame = new Map<string, Record<string, number>>();
        for (const type of ['render', 'compute'] as const) {
          const pool = backend.timestampQueryPool?.[type];
          if (!pool) continue;
          for (const [uid, ms] of pool.timestamps) {
            const m = /^([rc]):(\d+):.*:f(\d+)$/.exec(uid);
            if (!m) continue;
            const name = this.passLog.get(`${m[1]}:${m[2]}:f${m[3]}`) ?? 'autre';
            const f = perFrame.get(m[3]!) ?? {};
            f[name] = (f[name] ?? 0) + ms;
            perFrame.set(m[3]!, f);
          }
        }
        if (perFrame.size === 0) return;
        const sum: Record<string, number> = {};
        let total = 0;
        for (const f of perFrame.values()) for (const [k, v] of Object.entries(f)) {
          sum[k] = (sum[k] ?? 0) + v;
          total += v;
        }
        const n = perFrame.size;
        for (const k of Object.keys(sum)) sum[k] = (sum[k] as number) / n;
        this.last = { perPass: sum, frameMs: total / n, frames: n };
      })
      .catch(() => undefined)
      .finally(() => (this.resolving = false));
  }

  /** Entrées du journal des passes (mesure : reste à 0 quand les horodatages GPU ne sont pas lus, audit J6 point 12). */
  get passLogSize(): number {
    return this.passLog.size;
  }

  get gpu(): PassStats | null {
    const backend = this.paper.renderer.backend as unknown as { trackTimestamp?: boolean };
    return backend.trackTimestamp ? this.last : null;
  }

  dispose(): void {
    this.motion.removeEventListener('change', this.onMotion);
    try {
      this.grid?.dispose();
      this.particles.dispose();
      this.stains.dispose();
      this.overlay.geometry.dispose();
    } catch {
      /* device perdu */
    }
  }
}
