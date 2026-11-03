// Contrôleur adaptatif (SPEC §3) sur séries synthétiques : baisse sous charge, hausse par mesure GPU, essai sans
// mesure GPU, délai de 3 s, au plus QC_MAX_FLIPFLOPS allers-retours, « un Moyen à 8,3 ms ne monte pas ».
import { describe, expect, it } from 'vitest';
import { nextManualQuality, qcForce, qcInit, qcWindow, type QcChange, type QcState } from '../../src/core/quality';
import { QC_COOLDOWN_S, QC_MAX_FLIPFLOPS, QC_TIER_RATIO_SPEC, QC_WINDOW_MS } from '../../src/constants';

/** Rejoue une série : `f(t)` donne (temps d'image, temps GPU) de la fenêtre qui finit à t (ms). */
function run(s0: QcState, durationS: number, f: (t: number, tier: string) => { frame: number; gpu: number | null }) {
  let s = s0;
  const changes: (QcChange & { t: number })[] = [];
  let notices = 0;
  for (let t = s0.startedAt + QC_WINDOW_MS; t <= s0.startedAt + durationS * 1000; t += QC_WINDOW_MS) {
    const m = f(t, s.tier);
    const r = qcWindow(s, { t, frameMs: m.frame, gpuMs: m.gpu });
    s = r.state;
    if (r.change) changes.push({ ...r.change, t });
    if (r.notice) notices++;
  }
  return { s, changes, notices };
}

describe('contrôleur de qualité', () => {
  it('« un Moyen à 8,3 ms GPU ne monte pas » (8,3 × 2,0 = 16,6 > 11 ; aussi avec les rapports mesurés)', () => {
    const r = run(qcInit(0), 120, () => ({ frame: 16.7, gpu: 8.3 }));
    expect(r.changes).toEqual([]);
    expect(r.s.tier).toBe('T2');
    let s = qcInit(0);
    const spec = { T0: QC_TIER_RATIO_SPEC, T1: QC_TIER_RATIO_SPEC, T2: QC_TIER_RATIO_SPEC };
    for (let t = QC_WINDOW_MS; t <= 120_000; t += QC_WINDOW_MS) {
      const x = qcWindow(s, { t, frameMs: 16.7, gpuMs: 8.3 }, spec);
      expect(x.change).toBeNull();
      s = x.state;
    }
  });

  it('descend sous charge simulée : sonde (T2 → T1) puis T0, 3 s au moins entre deux changements', () => {
    const r = run(qcInit(0), 30, () => ({ frame: 40, gpu: 30 }));
    expect(r.changes.map((c) => c.to)).toEqual(['T1', 'T0']);
    expect(r.changes[0]!.reason).toBe('sonde');
    expect(r.changes[1]!.t - r.changes[0]!.t).toBeGreaterThanOrEqual(QC_COOLDOWN_S * 1000);
    expect(r.s.tier).toBe('T0');
  });

  it('message unique « Ta machine peine » en T0 au-delà de 33,3 ms pendant 10 s', () => {
    const r = run(qcInit(0), 60, () => ({ frame: 50, gpu: 40 }));
    expect(r.notices).toBe(1);
  });

  it('monte avec la mesure GPU : T2 à 4 ms → T3 dès la sonde ; T1 à 3 ms → T2 après 40 fenêtres', () => {
    const a = run(qcInit(0), 5, () => ({ frame: 10, gpu: 4 }));
    expect(a.changes.map((c) => `${c.reason}:${c.to}`)).toEqual(['sonde:T3']);
    const b = run(qcForce(qcInit(0), 0, 'T1'), 1, () => ({ frame: 10, gpu: 3 }));
    expect(b.changes).toEqual([]); // forcé : contrôleur coupé
    const c = run({ ...qcInit(0, 'T1'), probeDone: true }, 14, () => ({ frame: 10, gpu: 3 }));
    expect(c.changes.map((x) => x.to)).toEqual(['T2']);
    expect(c.changes[0]!.t).toBeGreaterThanOrEqual(40 * QC_WINDOW_MS);
  });

  it('sans mesure GPU : 20 s rapides → essai du palier supérieur, annulé s’il ralentit', () => {
    const s0 = { ...qcInit(0, 'T1'), probeDone: true };
    const r = run(s0, 40, (_t, tier) => ({ frame: tier === 'T2' ? 22 : 12, gpu: null }));
    expect(r.changes[0]).toMatchObject({ from: 'T1', to: 'T2', reason: 'essai' });
    expect(r.changes[1]).toMatchObject({ from: 'T2', to: 'T1' });
    expect(['essai-annule']).toContain(r.changes[1]!.reason);
  });

  it(`charge alternée pendant 10 min : au plus ${QC_MAX_FLIPFLOPS} allers-retours, puis palier figé`, () => {
    // Charge qui suit le palier : T3 trop lent, T2 très rapide (le GPU prévoit qu'on peut monter) → oscillation.
    const r = run(qcInit(0), 600, (_t, tier) => (tier === 'T3' ? { frame: 30, gpu: 12 } : { frame: 9, gpu: 2 }));
    let reversals = 0;
    for (let i = 1; i < r.changes.length; i++) {
      const d0 = r.changes[i - 1]!.to > r.changes[i - 1]!.from ? 1 : -1;
      const d1 = r.changes[i]!.to > r.changes[i]!.from ? 1 : -1;
      if (d0 !== d1) reversals++;
    }
    expect(reversals).toBeLessThanOrEqual(QC_MAX_FLIPFLOPS);
    expect(r.s.frozen).toBe(true);
    const last = r.changes[r.changes.length - 1]!.t;
    expect(last).toBeLessThan(120_000); // figé tôt : plus aucun changement ensuite
    for (let i = 1; i < r.changes.length; i++) expect(r.changes[i]!.t - r.changes[i - 1]!.t).toBeGreaterThanOrEqual(QC_COOLDOWN_S * 1000);
  });

  it('touche Q : auto → T3 → T2 → T1 → T0 → auto', () => {
    const seq: string[] = [];
    let q: ReturnType<typeof nextManualQuality> = 'auto';
    for (let i = 0; i < 5; i++) {
      q = nextManualQuality(q);
      seq.push(q);
    }
    expect(seq).toEqual(['T3', 'T2', 'T1', 'T0', 'auto']);
  });
});
