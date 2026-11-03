// Démarrage : détection du niveau (F-12), papier (F-1), jardin (F-2, F-3 : J2), effets du J3 (encre, vent,
// particules, qualité), perte du device (ARCHITECTURE §7), crochets de test.
// J4 : saisons (F-7), lien et PNG (F-8), nouvelle feuille (F-10), barre d'icônes, FR · EN.
// J5 : son (F-9), mode contemplatif (F-11), clavier complet (SPEC §7.2), accessibilité.
import { detectLevel, hasWebGL2 } from './boot/level';
import { showRefus } from './boot/refus';
import { createPaper, type Paper } from './render/paper';
import { hideVeil, showReducedNotice, showToast, showVeil } from './ui/messages';
import { autoplantOn, fxOn, installHooks, markFirstStroke, markPaperVisible, testModeOn, welcomeOn, windRingOn } from './app/test-hooks'; // crochets de test : tout usage ci-dessous est gardé par `__TEST_HOOKS__` (faux en production, audit J6 point 2)
import { Garden } from './app/garden';
import { Effects } from './app/effects';
import { QualityRuntime, readQualityPref, urlQuality } from './app/quality-runtime';
import { attachPointer, type PointerInput } from './input/pointer';
import { decodeFragment, type DecodeResult } from './core/url-codec';
import { newGarden, type GardenState } from './core/state';
import { stepSeason as nextSeason, type SeasonIndex } from './core/seasons';
import { CONFIRM_MIN_PLANTS, DEVICE_LOSS, GUST, NEW_SHEET_FADE_MS, QC_START_TIER, SPECIES_COUNT, TOAST_MS, VOLUME_DEFAULT, WIND_BED, WIND_SOUND_REF, type Level, type SpeciesCode, type TierId } from './constants';
import { copyText, shareUrl, UrlWriter } from './app/link';
import { downloadBlob, exportSheetPng, type ExportResult } from './render/export';
import { createBar, type Bar } from './ui/bar';
import { confirmNewSheet, showLinkField } from './ui/dialogs';
import { attachShortcuts } from './input/shortcuts';
import { getLang, initLang, onLang, readPref, t, writePref } from './ui/i18n';
import { SoundEngine } from './audio/engine';
import { sanitizeVolume, stepVolume, windStrength } from './core/audio-plan';
import { impulseWeight, windUniforms } from './sim/wind';
import { Contemplative } from './app/contemplative-runtime';
import { createBrush, type Brush } from './ui/brush';
import { markWelcomeSeen, shouldShowWelcome, welcomeSeen } from './core/welcome';
import { showWelcome, type Welcome } from './ui/welcome';
import { createWindRing, type WindRing } from './ui/wind-ring';
import { speciesName } from './ui/gauge';

const root = document.documentElement;

function settle(level: Level, backend: string): void {
  root.dataset.niveau = level;
  root.dataset.backend = backend;
  root.classList.add('ready'); // coupe le message de secours CSS (RESCUE_DELAY_S)
}

/** Un canvas neuf par tentative : un canvas qui a pris un contexte WebGPU ne peut plus prendre WebGL2. */
function freshCanvas(): HTMLCanvasElement {
  const stage = document.getElementById('stage') as HTMLElement;
  stage.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true'); // le libellé vit sur la scène (focalisable), mis à jour avec le jardin
  stage.appendChild(canvas);
  return canvas;
}

async function tryPaper(forceWebGL: boolean): Promise<Paper> {
  const paper = await createPaper({ canvas: freshCanvas(), forceWebGL });
  await paper.renderNow();
  return paper;
}

/** Ouvre le papier au niveau demandé ; `complet` qui échoue → un essai en `reduit` ; sinon null (`refus`). */
async function openPaper(level: Level): Promise<{ paper: Paper; level: Level } | null> {
  let lv = level;
  if (lv === 'complet') {
    try {
      const paper = await tryPaper(false);
      // Three peut retomber seul sur WebGL2 : le niveau suit le backend réellement obtenu.
      return { paper, level: paper.backend === 'webgpu' ? 'complet' : 'reduit' };
    } catch (e) {
      console.warn('Initialisation WebGPU échouée, essai en version réduite', e);
      lv = 'reduit'; // SPEC §11 : un essai en reduit, puis refus
    }
  }
  if (lv === 'reduit') {
    try {
      return hasWebGL2() ? { paper: await tryPaper(true), level: 'reduit' } : null;
    } catch (e) {
      console.warn('Initialisation WebGL2 échouée, refus', e);
    }
  }
  return null;
}

function toRefus(): void {
  bar?.dispose();
  bar = null;
  contemplative?.dispose();
  contemplative = null;
  brush?.dispose();
  brush = null;
  welcome?.dispose();
  welcome = null;
  windRing?.dispose();
  windRing = null;
  document.getElementById('stage')?.removeAttribute('tabindex');
  document.getElementById('stage')?.removeAttribute('role');
  document.getElementById('stage')?.removeAttribute('aria-label');
  document.getElementById('stage')?.replaceChildren();
  settle('refus', 'aucun');
  showRefus();
}

interface Session {
  paper: Paper;
  garden: Garden;
  effects: Effects;
  pointer: PointerInput;
  quality: QualityRuntime | null;
  level: Level;
  simulatedLoss: boolean;
}

let session: Session | null = null;
const lossLog: number[] = [];
let recovering = false;
let search = '';
let test = false;
let bar: Bar | null = null;
let detachShortcuts: (() => void) | null = null;
let sound: SoundEngine | null = null;
let contemplative: Contemplative | null = null;
let brush: Brush | null = null;
let welcome: Welcome | null = null;
let welcomeDecided = false;
let windRing: WindRing | null = null;
let writer: UrlWriter | null = null;
/** Incrémenté à chaque navigation Précédent / Suivant : une « Nouvelle feuille » en cours s'abandonne. */
let navToken = 0;
let newSheetBusy = false;
let exporting = false;
let lastExport: ExportResult | null = null;
const exportsKept: Blob[] = [];
/** Problème de lien relevé au chargement (message affiché une fois la barre prête). */
let linkProblem: Exclude<DecodeResult, { ok: true }>['reason'] | null = null;

async function boot(): Promise<void> {
  initLang();
  search = window.location.search;
  test = __TEST_HOOKS__ && testModeOn(search);
  // Son (F-9) : aucun AudioContext tant que personne n'a touché au contrôle ; le volume est une préférence, l'état « activé » jamais mémorisé.
  sound = new SoundEngine(sanitizeVolume(readPref('volume'), VOLUME_DEFAULT), __TEST_HOOKS__ && test);
  const detection = await detectLevel(search);
  if (__TEST_HOOKS__ && test) console.info(`[niveau] ${detection.level} : ${detection.reason}`);
  const opened = detection.level === 'refus' ? null : await openPaper(detection.level);
  if (!opened) {
    toRefus();
    return;
  }
  const { paper, level } = opened;
  settle(level, paper.backend);
  if (level === 'reduit') showReducedNotice();
  paper.start();
  // `paper-visible` : à l'image qui suit le premier dessin (erreur ≈ 1 image, non mesurée).
  // Le jardin démarre ensuite : la compilation des nuanceurs d'encre ne retarde pas le papier.
  requestAnimationFrame(() => {
    if (__TEST_HOOKS__ && test) markPaperVisible();
    startSession(paper, level, initialState(), false);
  });
}

/** Feuille vide, graine tirée au hasard, printemps (SPEC §5). */
function freshState(): GardenState {
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  return newGarden(r[0] as number, 0);
}

/** Graine du jardin : celle du lien `#g=…` s'il est valide (SPEC §8), sinon une feuille vide (lien abîmé : message). */
function initialState(): GardenState {
  const d = decodeFragment(window.location.hash);
  if (d.ok) return d.state;
  if (d.reason !== 'absent') linkProblem = d.reason;
  return freshState();
}

function linkProblemMessage(reason: NonNullable<typeof linkProblem>): string {
  return reason === 'version-future' ? t('link_future') : t('link_bad');
}

function startTier(level: Level): TierId {
  if (level !== 'complet') return 'R';
  return urlQuality(search) ?? (readQualityPref() !== 'auto' ? (readQualityPref() as TierId) : QC_START_TIER);
}

function startSession(paper: Paper, level: Level, state: GardenState, grown: boolean, species?: SpeciesCode): void {
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  const effects = new Effects({
    paper,
    level: level === 'complet' ? 'complet' : 'reduit',
    season: state.saison,
    // Mode test : particules à graine fixe, brise et particules coupées sauf `&fx=1` (ARCHITECTURE 12.3).
    fx: !(__TEST_HOOKS__ && test) || (__TEST_HOOKS__ && fxOn(search)),
    seed: __TEST_HOOKS__ && test ? 0x5eed : (r[0] as number),
    tier: startTier(level),
  });
  writer ??= new UrlWriter(() => (session ? session.garden.fullState() : state));
  const garden = new Garden({
    paper,
    state,
    effects,
    grown,
    onChange: () => {
      writer?.request();
      bar?.setSeason(garden.season);
      bar?.setSpecies(speciesName(pointer.current));
      updateSheetLabel();
    },
    onPlanted: (x, _y, espece) => {
      sound?.plant(x, espece);
      // Première plantation : l'écran d'ouverture disparaît et ne reviendra plus (stockage bloqué : à chaque visite, sans erreur).
      if (welcome?.visible) {
        welcome.dismiss();
        markWelcomeSeen(() => window.localStorage);
      }
    },
    ...(__TEST_HOOKS__ && test && !grown ? { onFirstStroke: () => markFirstStroke() } : {}),
  });
  const stage = document.getElementById('stage') as HTMLElement;
  const pointer = attachPointer(stage, garden, { onFull: () => showToast(t('sheet_full'), 2500), ...(species !== undefined ? { initial: species } : {}) });
  const s: Session = { paper, garden, effects, pointer, quality: null, level, simulatedLoss: false };
  session = s;
  watchDevice(s);
  if (!bar) setupInterface();
  if (!welcomeDecided) {
    // Écran d'ouverture : une seule décision par chargement (pas de retour après une recréation du device).
    welcomeDecided = true;
    if (shouldShowWelcome({ seen: welcomeSeen(() => window.localStorage), plantCount: state.plantes.length, recreated: grown, testMode: __TEST_HOOKS__ && test, welcomeParam: __TEST_HOOKS__ && welcomeOn(search) })) welcome = showWelcome();
  }
  bar!.setSeason(state.saison);
  bar!.setSpecies(speciesName(pointer.current));
  updateSheetLabel();
  // Son (vent estimé côté CPU, gouttes) et mode contemplatif (pilote) : une écoute par image, sans relecture du GPU.
  garden.frameListeners.push((now, dt) => {
    contemplative?.onFrame(now, dt);
    if (sound && sound.on) {
      const strength = windStrength(effects.wind.impulses, windUniforms.time.value as number, WIND_SOUND_REF, impulseWeight, WIND_BED, windUniforms.scale.value as number);
      sound.update(Math.min(dt, 100) / 1000, strength, garden.seasonWeights()[3]);
    }
  });
  if (linkProblem && !grown) {
    showToast(linkProblemMessage(linkProblem), TOAST_MS);
    linkProblem = null;
  }
  if (__TEST_HOOKS__ && test) {
    installHooks(garden, {
      level,
      backend: paper.backend,
      quality: () => session?.quality ?? null,
      simulateDeviceLoss: () => simulateDeviceLoss(),
      session: () => session,
      lossLog: () => lossLog.slice(),
      setSeason: (i, instant) => setSeason(i, instant),
      shareUrl: () => (session ? shareUrl(session.garden.fullState()) : ''),
      keep: async () => {
        await keep();
        return lastExport;
      },
      lastExport: () => lastExport,
      exportBlob: (i) => exportsKept[i < 0 ? exportsKept.length + i : i] ?? null,
      newSheet: () => newSheet(),
      copyLink: () => copyLink(),
      sound: () => sound,
      contemplative: () => contemplative,
      brush: () => brush,
    });
    // `&autoplant=1` : un bambou en (800, 792) dès `paper-visible` (mis en attente si l'encre n'est pas prête).
    if (autoplantOn(search) && !grown) garden.plantAt(800, 792, 0, null);
  }
  garden
    .warmUp()
    .then(() => {
      if (session !== s) return;
      // Contrôleur après la préparation (la compilation des nuanceurs fausserait la sonde de départ).
      if (level === 'complet') {
        s.quality = new QualityRuntime(effects, { search, now: performance.now() });
        garden.frameListeners.push((now, dt) => s.quality?.onFrame(now, dt));
      }
      if (grown) hideVeil();
    })
    .catch((e) => console.error("Préparation de l'encre échouée", e));
}

/** Écoute la perte du device : vraie (raison ≠ `destroyed`) ou simulée en mode test (marquée récupérable). */
function watchDevice(s: Session): void {
  s.paper.setDeviceLostHook((info) => {
    if (session === s && info.reason !== 'destroyed') void recover(s);
  });
  const device = (s.paper.renderer.backend as unknown as { device?: { lost: Promise<{ reason: string }> } }).device;
  device?.lost.then((info) => {
    if (session === s && (info.reason !== 'destroyed' || s.simulatedLoss)) void recover(s);
  });
}

/** Mode test : détruit vraiment le device, en marquant la perte comme récupérable (ARCHITECTURE §7). */
function simulateDeviceLoss(): boolean {
  const s = session;
  const device = s ? (s.paper.renderer.backend as unknown as { device?: { destroy(): void } }).device : undefined;
  if (!s || !device) return false;
  s.simulatedLoss = true;
  s.paper.stop();
  device.destroy();
  return true;
}

function teardown(s: Session): void {
  s.paper.stop();
  s.pointer.dispose();
  s.quality?.dispose();
  s.effects.dispose();
  s.paper.dispose();
}

/** Recréation depuis l'état (graine + plantations) : voile, 1 s, ≤ 3 tentatives en 60 s, puis `reduit`, puis `refus`. */
async function recover(s: Session): Promise<void> {
  if (recovering || session !== s) return;
  recovering = true;
  const t = performance.now();
  lossLog.push(t);
  showVeil();
  const state = s.garden.fullState();
  const species = s.pointer.current; // l'espèce courante survit à la récupération (SPEC §7.1), lue avant de défaire la session
  let level = s.level;
  session = null;
  teardown(s);
  const recent = lossLog.filter((x) => t - x <= DEVICE_LOSS.windowMs).length;
  if (recent > DEVICE_LOSS.maxAttempts) level = level === 'complet' ? 'reduit' : 'refus';
  await new Promise((r) => window.setTimeout(r, DEVICE_LOSS.retryDelayMs));
  const opened = level === 'refus' ? null : await openPaper(level);
  recovering = false;
  if (!opened) {
    hideVeil();
    toRefus();
    return;
  }
  settle(opened.level, opened.paper.backend);
  opened.paper.start();
  startSession(opened.paper, opened.level, state, true, species);
}

// ---------------------------------------------------------------------------------------------
// J4 : actions de la barre et du clavier.

function setSeason(i: number, instant = false): void {
  const g = session?.garden;
  if (!g || (i !== 0 && i !== 1 && i !== 2 && i !== 3)) return;
  g.setSeason(i as SeasonIndex, instant);
  bar?.setSeason(g.season);
}

/** Copie le lien du jardin (SPEC F-8) ; presse-papiers refusé → champ de texte avec l'URL sélectionnée (SPEC §11). */
async function copyLink(): Promise<boolean> {
  const g = session?.garden;
  if (!g) return false;
  const url = shareUrl(g.fullState());
  writer?.flush();
  const ok = await copyText(url);
  if (ok) showToast(t('link_copied'), TOAST_MS);
  else showLinkField(url);
  return ok;
}

/** « Garder ce jardin » (SPEC F-8) : PNG de la feuille entière, sans interface, téléchargé sous `jardin-encre-<graine>-<saison>.png`. */
async function keep(): Promise<void> {
  const s = session;
  if (!s || exporting || !s.garden.isReady) return;
  exporting = true;
  bar?.setBusy(true);
  showToast(t('exporting'), 15_000);
  try {
    // Un lien qui repousse encore : on attend que toutes les plantes soient là (au plus 30 s).
    for (let i = 0; i < 300 && s.garden.replaying; i++) await new Promise((r) => window.setTimeout(r, 100));
    const g = s.garden;
    const r = await exportSheetPng({ paper: s.paper, graine: g.state.graine, saison: g.season, lang: getLang(), prepare: () => g.beginExportView() });
    downloadBlob(r.blob, r.name);
    lastExport = r;
    if (__TEST_HOOKS__ && test) {
      exportsKept.push(r.blob);
      if (exportsKept.length > 3) exportsKept.shift();
    }
    showToast(t('saved', { name: r.name }), TOAST_MS);
  } catch (e) {
    console.error('Export PNG échoué', e);
    showToast(t('export_failed'), TOAST_MS);
  } finally {
    exporting = false;
    bar?.setBusy(false);
  }
}

/**
 * « Nouvelle feuille » (SPEC F-10) : confirmation dès CONFIRM_MIN_PLANTS plantes (focus sur « Annuler », option
 * « Copier le lien d'abord »), l'encre s'efface en NEW_SHEET_FADE_MS, nouvelle graine, entrée d'historique empilée.
 */
async function newSheet(): Promise<void> {
  const s = session;
  if (!s || !s.garden.isReady || s.garden.fading || newSheetBusy) return;
  newSheetBusy = true;
  const token = ++navToken;
  try {
    const g = s.garden;
    if (g.plantTotal >= CONFIRM_MIN_PLANTS) {
      const ok = await confirmNewSheet({ plants: g.plantTotal, copyLink });
      if (!ok || token !== navToken || session !== s) return;
    }
    writer?.flush(); // l'entrée d'historique actuelle garde le jardin qu'on quitte
    if (g.plantTotal > 0) await g.fadeOut(NEW_SHEET_FADE_MS);
    if (token !== navToken || session !== s) return; // Précédent pendant le fondu : on s'arrête
    const st = freshState();
    writer?.push(st); // d'abord l'entrée empilée : sinon l'écriture suivante écraserait celle qu'on quitte
    g.reset(st, { seasonInstant: false });
    bar?.setSeason(0);
  } finally {
    newSheetBusy = false;
  }
}

/** Précédent / Suivant : l'état vient de l'adresse, le jardin repousse avec le même hash (SPEC F-10). */
function onPopState(): void {
  const s = session;
  if (!s) return;
  navToken++;
  writer?.cancel();
  const d = decodeFragment(window.location.hash);
  const st = d.ok ? d.state : freshState();
  s.garden.reset(st, { seasonInstant: true });
  bar?.setSeason(st.saison);
  if (!d.ok) {
    writer?.flush();
    if (d.reason !== 'absent') showToast(linkProblemMessage(d.reason), TOAST_MS);
  }
}

// ---------------------------------------------------------------------------------------------
// J5 : barre complète, clavier complet, son, plein écran, mode contemplatif.

/** Libellé de la feuille (focalisable) : nombre de plantes et saison, avec les touches utiles. */
function updateSheetLabel(): void {
  const g = session?.garden;
  const stage = document.getElementById('stage');
  if (!g || !stage) return;
  stage.setAttribute('aria-label', t('sheet_label', { n: g.plantTotal, season: t(`season.${g.season}`).toLowerCase() }));
}

function setupInterface(): void {
  const stage = document.getElementById('stage') as HTMLElement;
  stage.tabIndex = 0;
  stage.setAttribute('role', 'application');
  stage.setAttribute('aria-roledescription', 'feuille');
  brush = createBrush();
  // Indicateur du vent sous le curseur (maquette A écran 2) ; en mode test masqué sauf `&windring=1`.
  if (!(__TEST_HOOKS__ && test) || (__TEST_HOOKS__ && windRingOn(search))) windRing = createWindRing(stage);
  stage.addEventListener('blur', () => brush?.hide());
  stage.addEventListener('pointerdown', () => brush?.hide());
  onLang(() => {
    updateSheetLabel();
    bar?.setSpecies(speciesName(session?.pointer.current ?? 0));
  });
  const actions = {
    season: (i: 0 | 1 | 2 | 3) => setSeason(i),
    keep: () => void keep(),
    link: () => void copyLink(),
    newSheet: () => void newSheet(),
    species: () => setSpecies((((session?.pointer.current ?? 0) + 1) % SPECIES_COUNT) as SpeciesCode),
    gust: () => gust(),
    sound: () => void toggleSound(),
    volume: (v: number) => setVolume(v, false),
    fullscreen: () => toggleFullscreen(),
  };
  bar = createBar(actions);
  bar.setVolume(sound?.volume ?? VOLUME_DEFAULT);
  contemplative = new Contemplative({ session: () => session, bar: () => bar, setSeason: (i) => setSeason(i) });
  detachShortcuts = attachShortcuts({
    season: (d) => setSeason(nextSeason(session?.garden.season ?? 0, d)),
    keep: actions.keep,
    link: actions.link,
    newSheet: actions.newSheet,
    pause: () => togglePause(),
    fullscreen: actions.fullscreen,
    species: (i) => setSpecies(i),
    gust: actions.gust,
    sound: actions.sound,
    volume: (d) => setVolume(stepVolume(sound?.volume ?? VOLUME_DEFAULT, d), true),
    contemplative: () => contemplative?.toggle(),
    brush: (dx, dy) => brush?.move(dx, dy),
    plantAtBrush: () => plantAtBrush(),
  });
  document.addEventListener('fullscreenchange', () => bar?.setFullscreen(document.fullscreenElement !== null));
  window.addEventListener('popstate', onPopState);
  window.addEventListener('pagehide', () => writer?.flush());
}

function setSpecies(i: SpeciesCode): void {
  const s = session;
  if (!s) return;
  s.pointer.current = i;
  bar?.setSpecies(speciesName(i));
  showToast(t('species_now', { name: speciesName(i) }), 2000);
}

/** Rafale (touche V, bouton Vent) : un balayage de la feuille, dans le sens de la lecture, à une hauteur de la bande des plantes. */
function gust(): void {
  const fx = session?.effects;
  if (!fx) return;
  const y = 460 + 300 * Math.random();
  const x0 = 120 + 160 * Math.random();
  fx.gust(x0, y, x0 + GUST.lengthUf, y + 80 * (Math.random() - 0.5), GUST.durS);
}

function togglePause(): void {
  const g = session?.garden;
  if (!g) return;
  g.setPaused(!g.paused);
  showToast(t(g.paused ? 'paused' : 'resumed'), 2000);
}

/** Entrée au pinceau clavier : plante l'espèce courante là où est l'anneau (il apparaît au premier appui). */
function plantAtBrush(): void {
  const s = session;
  if (!s || !brush) return;
  brush.move(0, 0);
  const r = s.garden.plantAt(brush.x, brush.y, s.pointer.current, null);
  if (!r.ok && r.reason === 'plein') showToast(t('sheet_full'), 2500);
}

async function toggleSound(): Promise<void> {
  const e = sound;
  if (!e) return;
  if (!e.supported) {
    showToast(t('sound_unavailable'), TOAST_MS);
    return;
  }
  const on = await e.toggle(); // le contexte est créé ici, dans le geste de l'utilisateur, et nulle part ailleurs
  bar?.setSound(on);
  showToast(t(on ? 'sound_on' : 'sound_off'), 1500);
}

function setVolume(v: number, announce: boolean): void {
  sound?.setVolume(v);
  writePref('volume', v); // préférence ; stockage bloqué : en mémoire seulement
  bar?.setVolume(v);
  if (announce) showToast(t('volume_now', { v: Math.round(v * 100) }), 1500);
}

function toggleFullscreen(): void {
  const root = document.documentElement;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else if (root.requestFullscreen) void root.requestFullscreen().catch(() => undefined); // refusé (iframe, politique) : sans conséquence
}

void detachShortcuts;

boot().catch((e) => {
  console.error('Échec du démarrage', e);
  toRefus();
});
