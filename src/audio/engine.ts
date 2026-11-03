// Ambiance sonore (F-9, SPEC §9) : tout est synthétisé avec Web Audio, aucun fichier, aucun réseau.
// - L'AudioContext n'est créé qu'au premier appui sur « Son » (clic ou touche M) : jamais au chargement.
// - Graphe : bruit blanc (tampon de 2 s) → passe-bande → gain du vent ; gouttes (sinus) et notes (triangle) → bus →
//   (direct + réverbération calculée, mélange 0,25) → volume (rampe de 50 ms) → marge × 0,5 → limiteur → AnalyserNode →
//   sortie. L'analyseur est placé avant la sortie (mesure de F-9).
// - Le vent et les gouttes sont estimés côté CPU (aucune relecture du GPU) ; l'onglet caché suspend le contexte.
import { DROP_SOUND, LIMITER, MASTER_HEADROOM, PLANT_NOTE, REVERB, VOLUME_DEFAULT, VOLUME_RAMP_S, WIND_BED, WIND_MAKEUP, WIND_SOUND } from '../constants';
import { dropChance, plantFrequency, rampTarget, windCenterHz, windGain } from '../core/audio-plan';
import { sfc32u } from '../core/prng';

export interface SoundStats {
  drops: number;
  notes: number;
  lastNoteHz: number;
  /** nombre d'AudioContext créés par le moteur (0 avant la première action) */
  contexts: number;
}

type Ctor = typeof AudioContext;
const ctor = (): Ctor | null => (typeof window === 'undefined' ? null : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext ?? null));

/** Bruit blanc normalisé à 1 de RMS (tirage sfc32 seedé, pas de `Math.random`). */
function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const n = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const u = sfc32u(0x9e3779b9, 0x7f4a7c15, 0x1b873593, 0x2c1b3c6d);
  for (let i = 0; i < 12; i++) u();
  // uniforme [−√3, √3] : RMS 1 à 48 kHz ; × √(fréquence / 48 kHz) pour que la puissance passant dans le passe-bande ne dépende pas de la carte son
  const k = 1.7320508 * Math.sqrt(ctx.sampleRate / 48000);
  for (let i = 0; i < n; i++) d[i] = ((u() / 4294967296) * 2 - 1) * k;
  return buf;
}

/** Réponse impulsionnelle calculée : bruit à déclin exponentiel (REVERB.seconds), deux canaux décorrélés. */
function reverbBuffer(ctx: AudioContext): AudioBuffer {
  const n = Math.round(ctx.sampleRate * REVERB.seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const u = sfc32u(0x1234567 + c * 977, 0x2545f491, 0x9e3779b9 ^ c, 0x6a09e667);
    for (let i = 0; i < 12; i++) u();
    for (let i = 0; i < n; i++) {
      const k = i / n;
      d[i] = ((u() / 4294967296) * 2 - 1) * Math.exp(-6.9 * k) * (1 - k * 0.2); // −60 dB à la fin
    }
  }
  return buf;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private vol: GainNode | null = null;
  private volProbe: GainNode | null = null;
  private probe: AnalyserNode | null = null;
  private analyser: AnalyserNode | null = null;
  private windBp: BiquadFilterNode | null = null;
  private windG: GainNode | null = null;
  private bus: GainNode | null = null;
  private hidden = false;
  private readonly recentDrops: number[] = [];
  private readonly listeners: (() => void)[] = [];
  private seed = 0x6d2b79f5;
  /** Activé ? (jamais mémorisé : SPEC §8) */
  on = false;
  volume: number;
  readonly stats: SoundStats = { drops: 0, notes: 0, lastNoteHz: 0, contexts: 0 };

  constructor(volume = VOLUME_DEFAULT, private readonly withProbe = false) {
    this.volume = volume;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
  }

  /** Vrai si un AudioContext existe (faux tant que personne n'a touché au contrôle du son). */
  get created(): boolean {
    return this.ctx !== null;
  }

  get supported(): boolean {
    return ctor() !== null;
  }

  get state(): string {
    return this.ctx ? this.ctx.state : 'none';
  }

  onChange(f: () => void): void {
    this.listeners.push(f);
  }

  private emit(): void {
    for (const f of this.listeners) f();
  }

  private rnd(): number {
    // petit générateur local (mulberry32) : gouttes et hauteurs, hors de tout besoin de déterminisme inter-moteurs
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private build(): void {
    const C = ctor();
    if (!C) throw new Error('Web Audio indisponible');
    const ctx = new C({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.stats.contexts++;
    // Sortie : volume → marge → limiteur → analyseur → destination
    const vol = ctx.createGain();
    vol.gain.value = 0;
    const head = ctx.createGain();
    head.gain.value = MASTER_HEADROOM;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = LIMITER.threshold;
    lim.ratio.value = LIMITER.ratio;
    lim.knee.value = 6;
    lim.attack.value = 0.003;
    lim.release.value = 0.25;
    const an = ctx.createAnalyser();
    an.fftSize = 32768;
    an.smoothingTimeConstant = 0;
    vol.connect(head).connect(lim).connect(an).connect(ctx.destination);
    // Bus des sons ponctuels : direct + réverbération calculée
    const bus = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = reverbBuffer(ctx);
    const wet = ctx.createGain();
    wet.gain.value = REVERB.mix;
    bus.connect(vol);
    bus.connect(conv).connect(wet).connect(vol);
    // Vent : bruit en boucle → passe-bande → gain
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, WIND_SOUND.noiseS);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = WIND_SOUND.q;
    bp.frequency.value = windCenterHz(WIND_BED);
    const wg = ctx.createGain();
    wg.gain.value = windGain(WIND_BED) * WIND_MAKEUP;
    src.connect(bp).connect(wg).connect(vol);
    src.start();
    this.vol = vol;
    this.analyser = an;
    this.windBp = bp;
    this.windG = wg;
    this.bus = bus;
    if (this.withProbe) {
      // Mesure de la rampe de volume (mode test) : un second gain reçoit les mêmes automations et module une constante.
      const k = ctx.createConstantSource();
      k.offset.value = 1;
      const vp = ctx.createGain();
      vp.gain.value = 0;
      const pr = ctx.createAnalyser();
      pr.fftSize = 32;
      k.connect(vp).connect(pr);
      k.start();
      this.volProbe = vp;
      this.probe = pr;
    }
  }

  /** Rampe linéaire de 50 ms vers `target` (SPEC : atteint 90 % de la cible en ≤ 100 ms). */
  private ramp(target: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const g of [this.vol, this.volProbe]) {
      if (!g) continue;
      const t = ctx.currentTime;
      const p = g.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(target, t + VOLUME_RAMP_S);
    }
  }

  /** Premier appui : crée le contexte (action utilisateur obligatoire). Retourne l'état « activé » obtenu. */
  async setOn(on: boolean): Promise<boolean> {
    if (on === this.on) return this.on;
    if (on) {
      if (!this.ctx) {
        try {
          this.build();
        } catch (e) {
          console.warn('Son indisponible', e);
          this.ctx = null;
          this.emit();
          return false;
        }
      }
      const ctx = this.ctx!;
      this.on = true;
      try {
        if (ctx.state !== 'running' && !this.hidden) await ctx.resume();
      } catch {
        /* le navigateur peut refuser : on reste « activé » côté état, silencieux */
      }
      // Pendant l'attente de `resume()` un second appui a pu couper le son : on relit l'état (audit J6 point 9).
      this.ramp(rampTarget(this.on, this.volume));
    } else {
      this.on = false;
      this.ramp(0);
      const ctx = this.ctx;
      window.setTimeout(() => {
        if (!this.on && ctx && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
      }, 120);
    }
    this.emit();
    return this.on;
  }

  toggle(): Promise<boolean> {
    return this.setOn(!this.on);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.on) this.ramp(v);
    this.emit();
  }

  /** Une plantation : note de la gamme (SPEC §9), si le son est activé. */
  plant(x: number, espece: number): void {
    const ctx = this.ctx;
    if (!this.on || !ctx || !this.bus || ctx.state !== 'running') return;
    const f = plantFrequency(x, espece);
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(PLANT_NOTE.gain, t + PLANT_NOTE.attackS);
    g.gain.exponentialRampToValueAtTime(0.0001, t + PLANT_NOTE.attackS + PLANT_NOTE.releaseS);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + PLANT_NOTE.attackS + PLANT_NOTE.releaseS + 0.05);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
    this.stats.notes++;
    this.stats.lastNoteHz = f;
  }

  private drop(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    const t = ctx.currentTime + 0.005;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = DROP_SOUND.hzMin + (DROP_SOUND.hzMax - DROP_SOUND.hzMin) * this.rnd();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(DROP_SOUND.gain, t + DROP_SOUND.attackS);
    g.gain.exponentialRampToValueAtTime(0.0001, t + DROP_SOUND.attackS + DROP_SOUND.decayS);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + DROP_SOUND.attackS + DROP_SOUND.decayS + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
    this.stats.drops++;
    this.recentDrops.push(ctx.currentTime);
  }

  /** À chaque image : force du vent (0–1), poids de l'hiver. Les gouttes et le filtre suivent ; sans effet si le son est coupé. */
  update(dtS: number, windStrength01: number, winterWeight: number): void {
    const ctx = this.ctx;
    if (!this.on || !ctx || ctx.state !== 'running' || !this.windG || !this.windBp) return;
    const t = ctx.currentTime;
    this.windG.gain.setTargetAtTime(windGain(windStrength01) * WIND_MAKEUP, t, 0.25);
    this.windBp.frequency.setTargetAtTime(windCenterHz(windStrength01), t, 0.25);
    while (this.recentDrops.length > 0 && t - (this.recentDrops[0] as number) > 1) this.recentDrops.shift();
    if (this.rnd() < dropChance(dtS, winterWeight, this.recentDrops.length)) this.drop();
  }

  private readonly onVisible = (): void => {
    this.hidden = document.hidden;
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.hidden) void ctx.suspend().catch(() => undefined);
    else if (this.on) void ctx.resume().catch(() => undefined);
  };

  // --- Mesures (mode test) -------------------------------------------------------------------

  /** RMS du signal juste avant la sortie (fenêtre de 32 768 échantillons). */
  analyserRms(): number {
    const a = this.analyser;
    if (!a) return 0;
    const d = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(d);
    let s = 0;
    for (let i = 0; i < d.length; i++) s += (d[i] as number) * (d[i] as number);
    return Math.sqrt(s / d.length);
  }

  /** Fréquence dominante (Hz) entre lo et hi, interpolation parabolique du spectre de l'analyseur. */
  analyserPeakHz(lo: number, hi: number): number {
    const a = this.analyser;
    const ctx = this.ctx;
    if (!a || !ctx) return 0;
    const spec = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(spec);
    const bin = ctx.sampleRate / a.fftSize;
    const i0 = Math.max(1, Math.floor(lo / bin));
    const i1 = Math.min(spec.length - 2, Math.ceil(hi / bin));
    let best = i0;
    for (let i = i0; i <= i1; i++) if ((spec[i] as number) > (spec[best] as number)) best = i;
    const l = spec[best - 1] as number;
    const c = spec[best] as number;
    const r = spec[best + 1] as number;
    const den = l - 2 * c + r;
    const off = den !== 0 ? (0.5 * (l - r)) / den : 0;
    return (best + off) * bin;
  }

  /** Valeur courante du gain de volume : lecture de l'AudioParam et du gain miroir mesuré dans le signal. */
  gainNow(): { param: number; probe: number | null; time: number } {
    let probe: number | null = null;
    if (this.probe) {
      const d = new Float32Array(this.probe.fftSize);
      this.probe.getFloatTimeDomainData(d);
      probe = d[d.length - 1] as number;
    }
    return { param: this.vol ? this.vol.gain.value : 0, probe, time: performance.now() };
  }

  get sampleRate(): number {
    return this.ctx ? this.ctx.sampleRate : 0;
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
