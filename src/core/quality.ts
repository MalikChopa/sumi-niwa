// Contrôleur adaptatif de qualité (SPEC §3, ARCHITECTURE §6) : fonction pure, testée sur séries synthétiques.
// Entrée : une fenêtre de QC_WINDOW_MS (temps d'image moyen, temps GPU moyen ou null) ; sortie : nouvel état et
// éventuel changement de palier. Aucun DOM, aucun GPU, aucun `Math` hors liste blanche.
import {
  QC_COOLDOWN_S,
  QC_DOWN_MIN_SLOW,
  QC_LOW_NOTICE,
  QC_MAX_FLIPFLOPS,
  QC_PROBE_S,
  QC_SLOW_FRAME_MS,
  QC_START_TIER,
  QC_TIER_RATIO,
  QC_TRIAL_AFTER_S,
  QC_TRIAL_FRAME_MS,
  QC_TRIAL_OBSERVE_S,
  QC_UP_GPU_MS,
  QC_UP_MIN_OK,
  QC_UP_WINDOWS,
  QC_WINDOW_MS,
  QC_WINDOWS,
  TIER_ORDER,
  type TierId,
} from '../constants';

export type CompletTier = 'T3' | 'T2' | 'T1' | 'T0';
export type TierRatios = Readonly<Record<'T0' | 'T1' | 'T2', number>>;

export interface QcWindow {
  /** fin de la fenêtre (ms, horloge quelconque croissante) */
  t: number;
  /** temps d'image moyen de la fenêtre (ms) */
  frameMs: number;
  /** temps GPU moyen par image (ms), null sans `timestamp-query` */
  gpuMs: number | null;
}

export interface QcState {
  tier: CompletTier;
  /** `auto` : le contrôleur décide ; sinon palier forcé (touche Q, `?quality=`) : contrôleur coupé. */
  forced: boolean;
  frozen: boolean;
  windows: QcWindow[];
  startedAt: number;
  probeDone: boolean;
  cooldownUntil: number;
  flipflops: number;
  lastDir: -1 | 0 | 1;
  changes: number;
  trial: { from: CompletTier; startedAt: number } | null;
  noticeShown: boolean;
}

export interface QcChange {
  from: CompletTier;
  to: CompletTier;
  reason: 'sonde' | 'baisse' | 'hausse-gpu' | 'essai' | 'essai-annule';
}

export interface QcResult {
  state: QcState;
  change: QcChange | null;
  notice: boolean;
}

export function qcInit(t: number, tier: CompletTier = QC_START_TIER as CompletTier, forced = false): QcState {
  return {
    tier,
    forced,
    frozen: false,
    windows: [],
    startedAt: t,
    probeDone: forced,
    cooldownUntil: t,
    flipflops: 0,
    lastDir: 0,
    changes: 0,
    trial: null,
    noticeShown: false,
  };
}

const idx = (tier: CompletTier) => TIER_ORDER.indexOf(tier as TierId);
const tierAt = (i: number) => TIER_ORDER[i] as CompletTier;

/** Redimensionnement, retour d'onglet, perte de device : fenêtres oubliées, QC_COOLDOWN_S sans décision. */
export function qcReset(s: QcState, t: number): QcState {
  return { ...s, windows: [], cooldownUntil: t + QC_COOLDOWN_S * 1000, trial: null };
}

/** Force un palier (touche Q, `?quality=`) ou rend la main au contrôleur (`auto`). */
export function qcForce(s: QcState, t: number, tier: CompletTier | 'auto'): QcState {
  if (tier === 'auto') return { ...qcReset(s, t), forced: false, probeDone: true };
  return { ...qcReset(s, t), forced: true, tier };
}

function applyChange(s: QcState, w: QcWindow, to: CompletTier, reason: QcChange['reason']): QcResult {
  const from = s.tier;
  const dir = (idx(to) > idx(from) ? 1 : -1) as 1 | -1;
  let flipflops = s.flipflops;
  if (s.lastDir !== 0 && dir !== s.lastDir) flipflops++;
  const next: QcState = {
    ...s,
    tier: to,
    windows: [],
    cooldownUntil: w.t + QC_COOLDOWN_S * 1000,
    flipflops,
    lastDir: dir,
    changes: s.changes + 1,
    frozen: flipflops >= QC_MAX_FLIPFLOPS,
    trial: reason === 'essai' ? { from, startedAt: w.t } : null,
  };
  return { state: next, change: { from, to, reason }, notice: false };
}

const mean = (a: number[]) => {
  let s = 0;
  for (const v of a) s += v;
  return a.length ? s / a.length : 0;
};

/** Une fenêtre de mesure de plus. `ratios` : rapports de coût mesurés par le bench (QC_TIER_RATIO par défaut). */
export function qcWindow(prev: QcState, w: QcWindow, ratios: TierRatios = QC_TIER_RATIO): QcResult {
  const windows = prev.windows.length >= 4 * QC_UP_WINDOWS ? prev.windows.slice(1) : prev.windows.slice();
  windows.push(w);
  let s: QcState = { ...prev, windows };

  // Message unique « Ta machine peine » : en T0, temps moyen > 33,3 ms pendant 10 s.
  let notice = false;
  const lowN = (QC_LOW_NOTICE.seconds * 1000) / QC_WINDOW_MS;
  if (!s.noticeShown && s.tier === 'T0' && windows.length >= lowN && mean(windows.slice(-lowN).map((x) => x.frameMs)) > QC_LOW_NOTICE.frameMs) {
    s = { ...s, noticeShown: true };
    notice = true;
  }

  if (s.forced || s.frozen || w.t < s.cooldownUntil) return { state: s, change: null, notice };

  // Sonde de départ : QC_PROBE_S après le papier.
  if (!s.probeDone) {
    if (w.t - s.startedAt < QC_PROBE_S * 1000) return { state: s, change: null, notice };
    s = { ...s, probeDone: true };
    const frame = mean(windows.map((x) => x.frameMs));
    const gpu = windows.filter((x) => x.gpuMs !== null).map((x) => x.gpuMs as number);
    if (frame > QC_SLOW_FRAME_MS && idx(s.tier) > 0) return withNotice(applyChange(s, w, tierAt(idx(s.tier) - 1), 'sonde'), notice);
    if (s.tier !== 'T3' && gpu.length > 0 && mean(gpu) * ratios[s.tier as 'T0' | 'T1' | 'T2'] <= QC_UP_GPU_MS) {
      return withNotice(applyChange(s, w, tierAt(idx(s.tier) + 1), 'sonde'), notice);
    }
    return { state: { ...s, windows: [] }, change: null, notice };
  }

  // Baisse : QC_DOWN_MIN_SLOW fenêtres lentes sur les QC_WINDOWS dernières.
  if (windows.length >= QC_WINDOWS) {
    const slow = windows.slice(-QC_WINDOWS).filter((x) => x.frameMs > QC_SLOW_FRAME_MS).length;
    if (slow >= QC_DOWN_MIN_SLOW && idx(s.tier) > 0) {
      const reason = s.trial ? 'essai-annule' : 'baisse';
      return withNotice(applyChange(s, w, tierAt(idx(s.tier) - 1), reason), notice);
    }
  }

  // Essai sans mesure GPU en cours : observé QC_TRIAL_OBSERVE_S, annulé s'il ralentit.
  if (s.trial) {
    if (w.t - s.trial.startedAt >= QC_TRIAL_OBSERVE_S * 1000) {
      const since = windows.filter((x) => x.t > (s.trial as { startedAt: number }).startedAt);
      if (mean(since.map((x) => x.frameMs)) > QC_TRIAL_FRAME_MS) return withNotice(applyChange(s, w, s.trial.from, 'essai-annule'), notice);
      s = { ...s, trial: null };
    }
    return { state: s, change: null, notice };
  }

  if (s.tier === 'T3') return { state: s, change: null, notice };
  const ratio = ratios[s.tier as 'T0' | 'T1' | 'T2'];

  // Hausse avec mesure GPU : sur QC_UP_WINDOWS fenêtres consécutives, au moins QC_UP_MIN_OK prévoient ≤ QC_UP_GPU_MS.
  const last = windows.slice(-QC_UP_WINDOWS);
  if (last.length >= QC_UP_WINDOWS && last.every((x) => x.gpuMs !== null)) {
    const ok = last.filter((x) => (x.gpuMs as number) * ratio <= QC_UP_GPU_MS).length;
    if (ok >= QC_UP_MIN_OK) return withNotice(applyChange(s, w, tierAt(idx(s.tier) + 1), 'hausse-gpu'), notice);
    return { state: s, change: null, notice };
  }

  // Hausse sans mesure GPU : QC_TRIAL_AFTER_S de fenêtres ≤ QC_TRIAL_FRAME_MS → essai du palier supérieur.
  const trialN = (QC_TRIAL_AFTER_S * 1000) / QC_WINDOW_MS;
  const lastT = windows.slice(-trialN);
  if (lastT.length >= trialN && lastT.every((x) => x.gpuMs === null && x.frameMs <= QC_TRIAL_FRAME_MS)) {
    return withNotice(applyChange(s, w, tierAt(idx(s.tier) + 1), 'essai'), notice);
  }
  return { state: s, change: null, notice };
}

function withNotice(r: QcResult, notice: boolean): QcResult {
  return notice ? { ...r, notice: true, state: { ...r.state, noticeShown: true } } : r;
}

/** Cycle de la touche Q (SPEC §7.2) : auto → Élevé → Moyen → Bas → Minimal → auto. */
export function nextManualQuality(cur: 'auto' | CompletTier): 'auto' | CompletTier {
  const cycle: ('auto' | CompletTier)[] = ['auto', 'T3', 'T2', 'T1', 'T0'];
  const i = cycle.indexOf(cur);
  return cycle[(i + 1) % cycle.length] as 'auto' | CompletTier;
}
