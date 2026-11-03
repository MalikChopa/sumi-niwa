// Jardin (J2) : état (graine + plantations), horloge simulée, génération des plantes (CPU, src/core) et leurs
// maillages d'encre. Une plantation : réducteur → `generatePlant` → deux maillages ajoutés à la scène.
import { Mesh } from 'three/webgpu';
import { MAX_PLANTS, REPLAY_SPEED, REPLAY_STAGGER_MS, SIM_DT_MAX_MS, SWAY_MAX, type SpeciesCode } from '../constants';
import type { Effects } from './effects';
import { hex8 } from '../core/hash';
import { gardenHashOf, generatePlant, hashPlant, type PlantGeometry } from '../core/plant-gen';
import { onehot, startTransition, weightsAt, isDone, type SeasonAnim, type SeasonIndex, type Weights } from '../core/seasons';
import { newGarden, plant as reducePlant, setSeason as reduceSeason, type GardenState, type PlantEvent } from '../core/state';
import type { Paper } from '../render/paper';
import { createInkMaterials, inkUniforms, markMesh, seedMesh, setInkView, setSeasonWeights, strokeMesh, type InkMaterials } from '../render/ink';

/** Durée d'éclosion des dernières marques après la fin des traits (s), pour savoir quand la croissance finit. */
const GROW_TAIL_S = 0.6;
/** Disparition de la graine d'encre après le relâchement (s, temps réel). */
const SEED_FADE_S = 0.6;

interface LivePlant {
  geo: PlantGeometry;
  t0: number;
  meshes: Mesh[];
  /** copies d'injection dans la grille (partagent la géométrie des maillages d'affichage) */
  inject: Mesh[];
  hash: number;
  /** Instrumentation : `event.timeStamp` du relâchement, et image où le premier trait a été dessiné. */
  releaseStamp: number | null;
  drawnFrame: number | null;
}

export interface FrameRecord {
  /** `performance.now()` du début de l'image */
  t: number;
  /** durée depuis l'image précédente (ms) */
  dt: number;
  /** une plante poussait pendant cette image */
  growing: boolean;
}

export interface GardenMetrics {
  plants: number;
  simTime: number;
  growing: boolean;
  ready: boolean;
  /** Du relâchement (event.timeStamp) à l'image qui suit le premier dessin du trait (ms), par plantation. */
  plantResponses: number[];
  /** Images entre l'appui et la première image où la graine est dessinée. */
  seedFrameDelays: number[];
  /** De l'appui (event.timeStamp) au rendu de l'image qui montre la graine (ms). */
  seedResponses: number[];
  firstStroke: number | null;
  frames: FrameRecord[];
}

export interface PlantOutcome {
  ok: boolean;
  rank: number;
  hash: string;
  reason?: string;
}

export interface GardenOptions {
  paper: Paper;
  state: GardenState;
  /** Marque `first-stroke` (mode test seulement). */
  onFirstStroke?: () => void;
  /** Effets du J3 (vent, particules, diffusion) ; absents dans les tests du J2 qui n'en ont pas besoin. */
  effects?: Effects;
  /** Recréation après une perte du device : les plantes de l'état reviennent déjà poussées. */
  grown?: boolean;
  /** Appelée quand l'état (plantes, saison) a changé et que tout est posé : écriture du lien (J4). */
  onChange?: (kind: 'plant' | 'season' | 'load') => void;
  /** Appelée à chaque plantation réellement posée, hors recréation après une perte du device (note du son, J5). */
  onPlanted?: (x: number, y: number, espece: SpeciesCode) => void;
}

/** Plantation en attente : ouverture d'un lien (étalée, accélérée) ou clic arrivé pendant cette ouverture. */
interface ReplayEntry {
  x: number;
  y: number;
  espece: SpeciesCode;
  /** instant (performance.now) à partir duquel planter */
  due: number;
  speed: number;
  stamp: number | null;
}

/** Une transition de saison, pour les mesures (SPEC F-7, §12) : durée réelle et pire image. */
export interface SeasonTransitionLog {
  to: SeasonIndex;
  startMs: number;
  endMs: number | null;
  /** pire durée d'image (ms) vue pendant la transition */
  maxFrameMs: number;
  frames: number;
}

export class Garden {
  state: GardenState;
  private readonly paper: Paper;
  private readonly mats: InkMaterials;
  private readonly plants: LivePlant[] = [];
  private simTime = 0;
  private last = -1;
  private frame = 0;
  private growUntil = -1;
  private ready = false;
  private queued: { x: number; y: number; espece: SpeciesCode; stamp: number | null } | null = null;
  private seedState: { downFrame: number; downStamp: number; shown: boolean } | null = null;
  private seedFadeFrom = -1;
  private firstStrokePending = false;
  private firstStrokeDone = false;
  private readonly onFirstStroke: (() => void) | undefined;
  private readonly seed: Mesh;
  private initial: GardenState['plantes'];
  readonly effects: Effects | null;
  private grown: boolean;
  private readonly onChange: GardenOptions['onChange'];
  private readonly onPlanted: GardenOptions['onPlanted'];
  /** Pause du temps simulé (J5, touche Espace) : le temps réel continue (interface, saisons, vent). */
  private pausedSim = false;
  private replay: ReplayEntry[] = [];
  private weights: Weights;
  private seasonAnim: SeasonAnim | null = null;
  readonly seasonLog: SeasonTransitionLog[] = [];
  private fade: { start: number; dur: number; done: () => void } | null = null;
  private readonly motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  /** Écouteurs appelés à chaque image (contrôleur de qualité) : `now` (ms) et durée depuis l'image précédente. */
  readonly frameListeners: ((now: number, dt: number) => void)[] = [];
  readonly metrics: GardenMetrics = {
    plants: 0,
    simTime: 0,
    growing: false,
    ready: false,
    plantResponses: [],
    seedFrameDelays: [],
    seedResponses: [],
    firstStroke: null,
    frames: [],
  };

  constructor(opts: GardenOptions) {
    this.paper = opts.paper;
    this.state = newGarden(opts.state.graine, opts.state.saison);
    this.onFirstStroke = opts.onFirstStroke;
    this.effects = opts.effects ?? null;
    this.grown = opts.grown === true;
    this.mats = createInkMaterials(this.effects?.grid != null);
    this.seed = seedMesh(this.mats.seed);
    this.seed.renderOrder = 1_000_000;
    this.initial = opts.state.plantes.slice();
    this.onChange = opts.onChange;
    this.onPlanted = opts.onPlanted;
    this.weights = onehot(opts.state.saison);
    this.applyWeights();
    inkUniforms.fade.value = 1;
    this.paper.setResizeHook((w, h) => setInkView(w, h));
    this.paper.setFrameHook((now) => this.onFrame(now));
  }

  /**
   * Compile les nuanceurs d'encre avant le premier clic (une plante factice jamais née), pour que la première
   * plantation ne paie pas la compilation. Les clics arrivés avant sont mis en attente (SPEC §11).
   */
  async warmUp(): Promise<void> {
    const g = generatePlant(1, 0, 800, 792, 1);
    const tmp = [strokeMesh(g, 1e9, this.mats.stroke), markMesh(g, 1e9, this.mats.mark)].filter((m): m is Mesh => m !== null);
    for (const m of tmp) this.paper.scene.add(m);
    if (!this.seed.parent) this.paper.scene.add(this.seed);
    // Copies d'injection de la plante factice : compile aussi les nuanceurs de la grille.
    const inj: Mesh[] = [];
    if (this.effects?.grid && this.mats.strokeInject && this.mats.markInject && tmp[0] && tmp[1]) {
      inj.push(new Mesh(tmp[0].geometry, this.mats.strokeInject), new Mesh(tmp[1].geometry, this.mats.markInject));
      for (const m of inj) {
        m.frustumCulled = false;
        this.effects.grid.injectScene.add(m);
      }
    }
    try {
      this.effects?.init();
      await this.paper.renderer.compileAsync(this.paper.scene, this.paper.camera);
      if (this.effects?.grid) await this.paper.renderer.compileAsync(this.effects.grid.injectScene, this.effects.grid.camera);
      this.paper.renderOnce();
    } finally {
      for (const m of inj) {
        this.effects?.grid?.injectScene.remove(m);
        m.dispose(); // libère aussi l'objet de rendu suivi par Three (voir clearPlants)
      }
      for (const m of tmp) {
        this.paper.scene.remove(m);
        m.geometry.dispose();
        m.dispose();
      }
    }
    this.ready = true;
    this.metrics.ready = true;
    // Plantes déjà présentes dans le lien : plantées dans l'ordre, étalées et accélérées (J4), ou d'un coup
    // (mouvement réduit, recréation après une perte du device).
    this.startReplay(this.initial);
    if (this.queued) {
      const q = this.queued;
      this.queued = null;
      this.plantAt(q.x, q.y, q.espece, q.stamp);
    }
  }

  /** Dépose les plantes d'un lien : toutes d'un coup (déjà poussées) ou étalées de REPLAY_STAGGER_MS, croissance × REPLAY_SPEED. */
  private startReplay(entries: readonly PlantEvent[]): void {
    if (entries.length === 0) {
      this.onChange?.('load');
      return;
    }
    if (this.grown || this.motion.matches) {
      for (const p of entries) this.doPlant(p.x, p.y, p.espece, null, true);
      this.effects?.reinjectAll();
      this.onChange?.('load');
      return;
    }
    const t = performance.now();
    entries.forEach((p, i) => this.replay.push({ x: p.x, y: p.y, espece: p.espece, due: t + i * REPLAY_STAGGER_MS, speed: REPLAY_SPEED, stamp: null }));
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Plantes posées (celles d'un lien en cours d'ouverture ne sont pas comptées : voir `plantTotal`). */
  get plantCount(): number {
    return this.state.plantes.length;
  }

  /** Plantes posées + plantes en attente de repousse + clic en attente : ce que contiendra le jardin. */
  get plantTotal(): number {
    return this.state.plantes.length + this.replay.length + (this.queued ? 1 : 0);
  }

  /** Vrai tant qu'un lien est en train de repousser. */
  get replaying(): boolean {
    return this.replay.length > 0;
  }

  /** État complet (plantes posées + en attente) : c'est lui qui va dans le lien partagé. */
  fullState(): GardenState {
    const wait: PlantEvent[] = this.replay.map((e) => ({ x: e.x, y: e.y, espece: e.espece }));
    if (this.queued) wait.push({ x: Math.round(this.queued.x), y: Math.round(this.queued.y), espece: this.queued.espece });
    return { ...this.state, plantes: [...this.state.plantes, ...wait] };
  }

  /** Plante (x, y en uf). `releaseStamp` : `event.timeStamp` du relâchement, pour la mesure de réponse. */
  plantAt(x: number, y: number, espece: SpeciesCode, releaseStamp: number | null): PlantOutcome {
    if (this.fade) return { ok: false, rank: -1, hash: '', reason: 'fondu' }; // feuille en train de s'effacer
    if (!this.ready) {
      // Rendu des traits pas encore prêt : un clic mis en attente, exécuté dès que prêt (SPEC §11).
      if (this.queued) return { ok: false, rank: -1, hash: '', reason: 'en-attente' };
      this.queued = { x, y, espece, stamp: releaseStamp };
      return { ok: true, rank: -1, hash: 'en-attente' };
    }
    if (this.replay.length > 0) {
      // Un lien repousse encore : le clic prend sa place à la fin de la file (l'ordre de plantation fait partie du jardin).
      if (this.plantTotal >= MAX_PLANTS) return { ok: false, rank: -1, hash: '', reason: 'plein' };
      this.replay.push({ x, y, espece, due: this.replay[this.replay.length - 1]!.due, speed: 1, stamp: releaseStamp });
      return { ok: true, rank: -1, hash: 'en-attente' };
    }
    const r = this.doPlant(x, y, espece, releaseStamp);
    if (r.ok) this.onChange?.('plant');
    return r;
  }

  private doPlant(x: number, y: number, espece: SpeciesCode, releaseStamp: number | null, grown = false, speed = 1): PlantOutcome {
    const r = reducePlant(this.state, x, y, espece);
    if (!r.ok) return { ok: false, rank: -1, hash: '', reason: r.reason };
    this.state = r.state;
    const ev = this.state.plantes[r.rank]!;
    const geo = generatePlant(this.state.graine, r.rank, ev.x, ev.y, ev.espece);
    // Recréation (perte du device) : plante déjà poussée, née dans le passé.
    const t0 = grown ? this.simTime - geo.duration - GROW_TAIL_S - 1 : this.simTime;
    const meshes: Mesh[] = [];
    const sm = strokeMesh(geo, t0, this.mats.stroke, speed);
    const mm = markMesh(geo, t0, this.mats.mark, speed);
    if (sm) {
      sm.renderOrder = 10 + 2 * r.rank;
      meshes.push(sm);
    }
    if (mm) {
      mm.renderOrder = 11 + 2 * r.rank;
      meshes.push(mm);
    }
    for (const m of meshes) this.paper.scene.add(m);
    const inject: Mesh[] = [];
    if (this.effects) {
      const injS = this.effects.grid && sm && this.mats.strokeInject ? new Mesh(sm.geometry, this.mats.strokeInject) : null;
      const injM = this.effects.grid && mm && this.mats.markInject ? new Mesh(mm.geometry, this.mats.markInject) : null;
      for (const m of [injS, injM]) if (m) m.frustumCulled = false;
      this.effects.addPlant({ stroke: sm, mark: mm }, SWAY_MAX[ev.espece], { stroke: injS, mark: injM }, t0 + geo.duration / speed + GROW_TAIL_S + 0.5);
      if (injS) inject.push(injS);
      if (injM) inject.push(injM);
    }
    const hash = hashPlant(geo);
    if (!grown) this.onPlanted?.(ev.x, ev.y, ev.espece);
    this.plants.push({ geo, t0, meshes, inject, hash, releaseStamp, drawnFrame: null });
    this.growUntil = Math.max(this.growUntil, t0 + geo.duration / speed + GROW_TAIL_S);
    this.metrics.plants = this.plants.length;
    return { ok: true, rank: r.rank, hash: hex8(hash) };
  }

  /** Temps simulé en pause (J5). */
  get paused(): boolean {
    return this.pausedSim;
  }

  setPaused(on: boolean): void {
    this.pausedSim = on;
  }

  /** Pieds des plantes posées (uf), pour le pilote du mode contemplatif. */
  feet(): { x: number; y: number }[] {
    return this.state.plantes.map((p) => ({ x: p.x, y: p.y }));
  }

  get full(): boolean {
    return this.plantTotal >= MAX_PLANTS;
  }

  /**
   * Vue d'export (F-8) : pour le rendu hors écran seulement, la graine d'encre est masquée, les plantes sont montrées
   * toutes poussées (temps d'encre avancé) et la saison est celle du nom du fichier (poids = saison cible).
   * Retourne la fonction qui remet l'état.
   */
  beginExportView(): () => void {
    const seedA = inkUniforms.seedAlpha.value as number;
    const time = inkUniforms.time.value as number;
    const season = inkUniforms.season.value as { x: number; y: number; z: number; w: number; set(a: number, b: number, c: number, d: number): void };
    const prev: [number, number, number, number] = [season.x, season.y, season.z, season.w];
    const t = onehot(this.state.saison);
    inkUniforms.seedAlpha.value = 0;
    inkUniforms.time.value = this.simTime + 120;
    season.set(t[0], t[1], t[2], t[3]);
    return () => {
      inkUniforms.seedAlpha.value = seedA;
      inkUniforms.time.value = time;
      season.set(prev[0], prev[1], prev[2], prev[3]);
    };
  }

  /** Saison cible (celle du lien partagé). */
  get season(): SeasonIndex {
    return this.state.saison;
  }

  /** Poids de saison affichés à cet instant (somme 1). */
  seasonWeights(): Weights {
    return this.weights;
  }

  get seasonMoving(): boolean {
    return this.seasonAnim !== null;
  }

  private applyWeights(): void {
    const w = this.weights;
    (inkUniforms.season.value as { set(a: number, b: number, c: number, d: number): void }).set(w[0], w[1], w[2], w[3]);
    setSeasonWeights(w);
    this.effects?.applySeasonBlend(w);
  }

  private applySeason(s: SeasonIndex, instant: boolean): void {
    this.state = reduceSeason(this.state, s);
    this.effects?.setSeasonType(s);
    if (instant) {
      this.seasonAnim = null;
      this.weights = onehot(s);
      this.applyWeights();
      return;
    }
    const now = performance.now();
    this.seasonAnim = startTransition(this.weights, s, now); // repart de l'état visuel courant (SPEC §5)
    this.seasonLog.push({ to: s, startMs: now, endMs: null, maxFrameMs: 0, frames: 0 });
    if (this.seasonLog.length > 50) this.seasonLog.splice(0, 25);
  }

  /** Change de saison : transition de SEASON_TRANSITION_MS sur le temps réel, ou d'un coup (`instant`). Écrit le lien. */
  setSeason(s: SeasonIndex, instant = false): void {
    if (!instant && s === this.state.saison) return; // déjà la cible (en route ou arrivée)
    this.applySeason(s, instant);
    this.onChange?.('season');
  }

  /**
   * Nouvelle feuille (J4) : l'encre s'efface en `ms` (temps réel). Résolue quand tout est effacé (opacité 0) ;
   * l'appelant enchaîne avec `reset`.
   */
  fadeOut(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.fade = { start: performance.now(), dur: Math.max(1, ms), done: resolve };
    });
  }

  get fading(): boolean {
    return this.fade !== null;
  }

  /**
   * Retire toutes les plantes de la scène et de la grille (la mémoire GPU des maillages est libérée).
   * Cause de la fuite de l'audit J6 (point 14), mesurée : `geometry.dispose()` libère la géométrie mais Three garde, pour chaque
   * (maillage, matériau, scène) rendu, un objet de rendu dans un `Set` fort du moteur (`_objects._renderObjects`) avec ses
   * liaisons d'uniformes ; il ne le retire que sur l'événement `dispose` du MAILLAGE (`Object3D.dispose()`), jamais appelé. Chaque
   * plante effacée laissait donc 8 objets de rendu, leurs uniformes et les tableaux de la géométrie (≈ 32 Ko de tas JS).
   * Correctif : `mesh.dispose()` sur les maillages d'affichage ET sur leurs copies d'injection (autre scène, autre objet de rendu).
   */
  private clearPlants(): void {
    for (const p of this.plants) {
      for (const m of p.inject) {
        m.removeFromParent();
        m.dispose();
      }
      for (const m of p.meshes) {
        this.paper.scene.remove(m);
        m.geometry.dispose();
        m.dispose();
      }
    }
    this.plants.length = 0;
    this.replay = [];
    this.queued = null;
    this.growUntil = -1;
    this.firstStrokePending = false;
    this.effects?.clearInk();
    this.metrics.plants = 0;
    this.releaseSeed(true);
  }

  /**
   * Charge un état : jardin vidé puis plantes du lien déposées (repousse étalée, ou d'un coup en mouvement réduit ou
   * si `grown`). Sert à « Nouvelle feuille » et à Précédent / Suivant (`popstate`). La saison passe d'un coup si
   * `seasonInstant`, sinon en transition.
   */
  reset(state: GardenState, opts: { seasonInstant: boolean; grown?: boolean }): void {
    const pendingFade = this.fade;
    this.fade = null;
    inkUniforms.fade.value = 1;
    pendingFade?.done(); // un fondu interrompu (Précédent) libère celui qui l'attendait
    this.clearPlants();
    this.state = newGarden(state.graine, this.state.saison);
    this.applySeason(state.saison, opts.seasonInstant);
    this.initial = state.plantes.slice();
    this.grown = opts.grown === true;
    if (this.ready) this.startReplay(this.initial);
    this.grown = false;
  }

  /** Graine d'encre sous le pointeur, dessinée à l'image suivant l'appui (SPEC §7.1). */
  showSeed(x: number, y: number, downStamp: number): void {
    if (!this.seed.parent) this.paper.scene.add(this.seed); // appui avant la préparation : compilé à la volée
    (inkUniforms.seedPos.value as { set(a: number, b: number): void }).set(x, y);
    inkUniforms.seedAlpha.value = 1;
    this.seedFadeFrom = -1;
    this.seedState = { downFrame: this.frame, downStamp, shown: false };
  }

  /** La graine s'efface (relâchement : la plante prend le relais ; annulation : elle disparaît). */
  releaseSeed(immediate: boolean): void {
    if (immediate) inkUniforms.seedAlpha.value = 0;
    else this.seedFadeFrom = performance.now();
  }

  /**
   * Compteurs d'objets vivants (garde de non-fuite, audit J6 point 14) : fiches de plantes, enfants de la scène et de la scène
   * d'injection. Après « Nouvelle feuille » ils reviennent à leur valeur d'une feuille vide.
   */
  liveCounts(): { plants: number; sceneChildren: number; injectChildren: number } {
    return { plants: this.plants.length, sceneChildren: this.paper.scene.children.length, injectChildren: this.effects?.grid?.injectScene.children.length ?? 0 };
  }

  gardenHash(): string {
    return hex8(gardenHashOf(this.plants.map((p) => p.geo)));
  }

  /** Géométrie générée et instant de plantation (s, temps simulé) d'une plante (crochets de test du J3). */
  plantInfo(rank: number): { geo: PlantGeometry; t0: number; espece: number } | null {
    const p = this.plants[rank];
    const e = this.state.plantes[rank];
    return p && e ? { geo: p.geo, t0: p.t0, espece: e.espece } : null;
  }

  get time(): number {
    return this.simTime;
  }

  plantHashes(): string[] {
    return this.plants.map((p) => hex8(p.hash));
  }

  /** Avance le temps simulé de n images de 1/60 s et dessine (crochet de test `step`). */
  step(n: number): void {
    this.simTime += Math.max(0, n) / 60;
    inkUniforms.time.value = this.simTime;
    this.paper.renderOnce();
  }

  private onFrame(now: number): boolean {
    const dt = this.last < 0 ? 0 : now - this.last;
    this.last = now;
    this.frame++;
    // Horloge simulée : pas borné à SIM_DT_MAX_MS (onglet caché, à-coups).
    const simDt = this.pausedSim ? 0 : Math.min(dt, SIM_DT_MAX_MS);
    this.simTime += simDt / 1000;
    inkUniforms.time.value = this.simTime;
    const growing = this.simTime <= this.growUntil;
    this.metrics.simTime = this.simTime;
    this.metrics.growing = growing;
    if (this.metrics.frames.length >= 6000) this.metrics.frames.splice(0, 1000);
    this.metrics.frames.push({ t: now, dt, growing });
    const fx = this.effects ? this.effects.frame(now, this.simTime, simDt / 1000) : false;
    for (const l of this.frameListeners) l(now, dt);

    // Saison : poids interpolés sur le temps réel (SPEC §5), mesure de la durée et de la pire image (F-7).
    let moving = false;
    if (this.seasonAnim) {
      const a = this.seasonAnim;
      const rec = this.seasonLog[this.seasonLog.length - 1];
      if (rec && rec.endMs === null) {
        if (dt > rec.maxFrameMs) rec.maxFrameMs = dt;
        rec.frames++;
      }
      if (isDone(a, now)) {
        this.weights = onehot(a.target);
        this.seasonAnim = null;
        if (rec && rec.endMs === null) rec.endMs = now;
      } else {
        this.weights = weightsAt(a, now);
        moving = true;
      }
      this.applyWeights();
    }
    // Fondu de la nouvelle feuille (J4).
    let fading = false;
    if (this.fade) {
      const k = (now - this.fade.start) / this.fade.dur;
      if (k >= 1) {
        inkUniforms.fade.value = 0;
        const done = this.fade.done;
        this.fade = null;
        done();
      } else {
        inkUniforms.fade.value = 1 - k;
        fading = true;
      }
    }
    // Ouverture d'un lien : les plantes sont déposées l'une après l'autre.
    let replaying = false;
    if (this.replay.length > 0) {
      while (this.replay.length > 0 && this.replay[0]!.due <= now) {
        const e = this.replay.shift()!;
        this.doPlant(e.x, e.y, e.espece, e.stamp, false, e.speed);
      }
      replaying = this.replay.length > 0;
      if (!replaying) this.onChange?.('load');
    }

    // Mesures : la graine, puis le premier trait de chaque plantation, relevés à l'image qui suit leur dessin.
    if (this.seedState) {
      if (this.seedState.shown) {
        this.metrics.seedResponses.push(now - this.seedState.downStamp);
        this.seedState = null;
      } else {
        this.metrics.seedFrameDelays.push(this.frame - this.seedState.downFrame);
        this.seedState.shown = true;
      }
    }
    for (const p of this.plants) {
      if (p.drawnFrame === null) {
        if (this.simTime > p.t0 && p.geo.vertCount > 0) p.drawnFrame = this.frame;
      } else if (p.releaseStamp !== null && p.drawnFrame === this.frame - 1) {
        this.metrics.plantResponses.push(now - p.releaseStamp);
        p.releaseStamp = null;
      }
    }
    if (!this.firstStrokeDone) {
      if (this.firstStrokePending) {
        this.firstStrokeDone = true;
        this.metrics.firstStroke = performance.now();
        this.onFirstStroke?.();
      } else if (this.plants.some((p) => p.drawnFrame !== null)) {
        this.firstStrokePending = true; // marque posée à l'image suivante
      }
    }

    let seedAnim = false;
    if (this.seedFadeFrom >= 0) {
      const k = (now - this.seedFadeFrom) / (SEED_FADE_S * 1000);
      inkUniforms.seedAlpha.value = Math.max(0, 1 - k);
      if (k >= 1) this.seedFadeFrom = -1;
      seedAnim = true;
    }
    return growing || seedAnim || this.seedState !== null || this.firstStrokePending || fx || moving || fading || replaying;
  }
}
