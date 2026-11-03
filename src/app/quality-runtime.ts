// Contrôleur de qualité en marche (SPEC §3, ARCHITECTURE §6) : fenêtres de QC_WINDOW_MS (temps d'image et temps
// GPU des horodatages), décisions de `core/quality`, application du palier ; touche Q (préférence `qualite`),
// `?quality=T3|T2|T1|T0` (forcé, sans écrire le stockage) ; délai après redimensionnement et retour d'onglet.
import { QC_WINDOW_MS, type TierId } from '../constants';
import { nextManualQuality, qcForce, qcInit, qcReset, qcWindow, type CompletTier, type QcState } from '../core/quality';
import type { Effects } from './effects';
import { isFrench, showToast } from '../ui/messages';
import { focusOnSheetOrBar } from '../input/shortcuts';

const PREFS_KEY = 'jardin-encre.v1.prefs';
const NAMES_FR: Record<string, string> = { auto: 'auto', T3: 'Élevé', T2: 'Moyen', T1: 'Bas', T0: 'Minimal' };
const NAMES_EN: Record<string, string> = { auto: 'auto', T3: 'High', T2: 'Medium', T1: 'Low', T0: 'Minimal' };
const isTier = (v: unknown): v is CompletTier => v === 'T3' || v === 'T2' || v === 'T1' || v === 'T0';

/** Préférences (SPEC §8) : stockage bloqué → mémoire seulement, sans erreur visible. */
export function readQualityPref(): 'auto' | CompletTier {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const q = raw ? (JSON.parse(raw) as { qualite?: unknown }).qualite : undefined;
    return isTier(q) ? q : 'auto';
  } catch {
    return 'auto';
  }
}

function writeQualityPref(q: 'auto' | CompletTier): void {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prev, qualite: q }));
  } catch {
    /* stockage bloqué : préférence en mémoire */
  }
}

export function urlQuality(search: string): CompletTier | null {
  const q = new URLSearchParams(search).get('quality');
  return isTier(q) ? q : null;
}

export interface TierChange {
  t: number;
  from: TierId;
  to: TierId;
  reason: string;
}

export class QualityRuntime {
  state: QcState;
  manual: 'auto' | CompletTier;
  readonly history: TierChange[] = [];
  readonly windows: { t: number; frameMs: number; gpuMs: number | null }[] = [];
  private winStart = -1;
  private winSum = 0;
  private winN = 0;
  private readonly urlForced: boolean;

  constructor(private readonly effects: Effects, opts: { search: string; now: number }) {
    const forced = urlQuality(opts.search);
    this.urlForced = forced !== null;
    this.manual = forced ?? readQualityPref();
    const tier: CompletTier = this.manual === 'auto' ? (effects.tier.id as CompletTier) : this.manual;
    this.state = qcInit(opts.now, tier, this.manual !== 'auto');
    if (effects.tier.id !== tier) effects.applyTier(tier);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('keydown', this.onKey);
  }

  private readonly onResize = () => {
    this.state = qcReset(this.state, performance.now());
  };

  private readonly onVisible = () => {
    if (!document.hidden) {
      this.state = qcReset(this.state, performance.now());
      this.winStart = -1;
    }
  };

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    // Même garde de focus que les autres raccourcis (WCAG 2.1.4) : jamais dans un champ de saisie ni dans une boîte de dialogue
    // (audit J6 point 10).
    if (!focusOnSheetOrBar(e.target)) return;
    if (e.key === 'q' || e.key === 'Q') this.cycle();
  };

  /** Touche Q : auto → Élevé → Moyen → Bas → Minimal → auto ; forcé = contrôleur coupé (SPEC §3, §7.2). */
  cycle(): 'auto' | CompletTier {
    const now = performance.now();
    this.manual = nextManualQuality(this.manual);
    if (!this.urlForced) writeQualityPref(this.manual);
    this.state = qcForce(this.state, now, this.manual);
    if (this.manual !== 'auto') this.setTier(this.manual, now, 'touche Q');
    const names = isFrench() ? NAMES_FR : NAMES_EN;
    showToast(`${isFrench() ? 'Qualité' : 'Quality'} : ${names[this.manual]}${this.manual === 'auto' ? '' : ` (${this.effects.tier.motes + this.effects.tier.carriers} ${isFrench() ? 'particules' : 'particles'})`}`);
    return this.manual;
  }

  private setTier(to: CompletTier, t: number, reason: string): void {
    const from = this.effects.tier.id;
    if (from === to) return;
    this.effects.applyTier(to);
    this.history.push({ t, from, to, reason });
  }

  /** À chaque image : temps d'image dans la fenêtre ; à la fin de la fenêtre, une décision. */
  onFrame(now: number, dt: number): void {
    if (this.winStart < 0) {
      this.winStart = now;
      this.winSum = 0;
      this.winN = 0;
      return;
    }
    if (dt > 0 && dt < 1000) {
      this.winSum += dt;
      this.winN++;
    }
    if (now - this.winStart < QC_WINDOW_MS || this.winN === 0) return;
    const gpu = this.effects.gpu;
    const w = { t: now, frameMs: this.winSum / this.winN, gpuMs: gpu && gpu.frames > 0 ? gpu.frameMs : null };
    this.windows.push(w);
    if (this.windows.length > 2400) this.windows.splice(0, 1200);
    this.winStart = now;
    this.winSum = 0;
    this.winN = 0;
    this.effects.pollGpu();
    const r = qcWindow(this.state, w);
    this.state = r.state;
    if (r.change) this.setTier(r.change.to, now, r.change.reason);
    if (r.notice) showToast(isFrench() ? 'Ta machine peine' : 'Your machine is struggling', 4000);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('keydown', this.onKey);
  }
}
