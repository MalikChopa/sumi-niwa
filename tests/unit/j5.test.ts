// J5 : plan sonore (SPEC §9, F-9), pilote du mode contemplatif et détection d'inactivité (SPEC F-11), contrastes de
// l'interface (calcul WCAG sur les couleurs réelles). Sous Node : aucun AudioContext, aucune horloge réelle.
import { describe, expect, it } from 'vitest';
import { CONTEMPLATIVE_IDLE_S, DROP_SOUND, MASTER_HEADROOM, PILOT, PLANT_NOTES_HZ, SHEET_H, SHEET_W, VOLUME_DEFAULT, WIND_SOUND } from '../../src/constants';
import { dropChance, noteIndex, plantFrequency, sanitizeVolume, stepVolume, windCenterHz, windGain, windStrength } from '../../src/core/audio-plan';
import { createPilot, idleDue, pickSpecies, pickSpot, type PilotAction } from '../../src/core/contemplative';
import { makeRng } from '../../src/core/prng';
import { EN, FR } from '../../src/ui/dict';

describe('plan sonore (SPEC §9)', () => {
  it('valeurs de la SPEC', () => {
    expect(VOLUME_DEFAULT).toBe(0.4);
    expect(MASTER_HEADROOM).toBe(0.5);
    expect(PLANT_NOTES_HZ).toEqual([293.66, 329.63, 369.99, 440.0, 493.88, 587.33]);
    expect(WIND_SOUND.hzMin).toBe(300);
    expect(WIND_SOUND.hzMax).toBe(1200);
    expect(WIND_SOUND.gainMax).toBe(0.15);
    expect(DROP_SOUND.maxPerS).toBe(3);
  });

  it('note d’une plantation : floor(x / 1600 × 6), roche une octave plus bas', () => {
    expect(noteIndex(0)).toBe(0);
    expect(noteIndex(266)).toBe(0);
    expect(noteIndex(267)).toBe(1);
    expect(noteIndex(800)).toBe(3);
    expect(noteIndex(1599)).toBe(5);
    expect(noteIndex(-30)).toBe(0);
    expect(noteIndex(2500)).toBe(5);
    expect(plantFrequency(800, 0)).toBe(440);
    expect(plantFrequency(800, 4)).toBe(220);
    expect(plantFrequency(1599, 2)).toBe(587.33);
    // gamme pentatonique majeure de ré (ré mi fa# la si ré) : intervalles de 2, 2, 3, 2, 3 demi-tons
    const semis = PLANT_NOTES_HZ.slice(1).map((f, i) => Math.round(12 * Math.log2(f / PLANT_NOTES_HZ[i]!)));
    expect(semis).toEqual([2, 2, 3, 2, 3]);
  });

  it('vent : centre 300 → 1 200 Hz et gain 0 → 0,15 selon la force', () => {
    expect(windCenterHz(0)).toBe(300);
    expect(windCenterHz(1)).toBe(1200);
    expect(windCenterHz(0.5)).toBe(750);
    expect(windGain(0)).toBe(0);
    expect(windGain(1)).toBe(0.15);
    expect(windGain(5)).toBe(0.15);
    expect(windCenterHz(-1)).toBe(300);
  });

  it('force du vent estimée côté CPU : lit les impulsions, jamais plus que 1, un lit de brise sans geste', () => {
    const w = (age: number) => (age < 0 || age > 8 ? 0 : Math.exp(-age / 1.2));
    expect(windStrength([], 10, 220, w, 0.3)).toBeCloseTo(0.3, 9);
    const imp = [{ vx: 200, vy: 0, t: 10 }];
    expect(windStrength(imp, 10, 220, w, 0.3)).toBeGreaterThan(0.3);
    expect(windStrength([{ vx: 5000, vy: 0, t: 10 }], 10, 220, w, 0.3)).toBe(1);
    expect(windStrength(imp, 30, 220, w, 0.3)).toBeCloseTo(0.3, 9); // impulsion trop vieille
    expect(windStrength(imp, 10, 220, w, 0.3, 0.3)).toBeLessThan(windStrength(imp, 10, 220, w, 0.3, 1)); // mouvement réduit
  });

  it('gouttes : aucune en hiver, jamais plus de 3 par seconde', () => {
    expect(dropChance(0.016, 1, 0)).toBe(0);
    expect(dropChance(0.016, 0.5, 0)).toBe(0);
    expect(dropChance(0.016, 0, 3)).toBe(0);
    expect(dropChance(0.016, 0, 2)).toBeGreaterThan(0);
    expect(dropChance(0.016, 0.25, 0)).toBeLessThan(dropChance(0.016, 0, 0)); // fondu vers l’hiver
    // 60 s à 60 images/s, plafond de 3 par seconde glissante : jamais plus de 3 gouttes dans une seconde
    const rng = makeRng(1, 2, 3, 4);
    const t: number[] = [];
    let total = 0;
    for (let i = 0; i < 3600; i++) {
      const now = i / 60;
      while (t.length > 0 && now - t[0]! > 1) t.shift();
      if (rng.next() < dropChance(1 / 60, 0, t.length)) {
        t.push(now);
        total++;
      }
      expect(t.length).toBeLessThanOrEqual(DROP_SOUND.maxPerS);
    }
    expect(total).toBeGreaterThan(20); // des gouttes il y en a
  });

  it('volume : pas de 10 points, borné, lecture sûre des préférences', () => {
    expect(stepVolume(0.4, 1)).toBe(0.5);
    expect(stepVolume(0.4, -1)).toBe(0.3);
    expect(stepVolume(1, 1)).toBe(1);
    expect(stepVolume(0, -1)).toBe(0);
    expect(stepVolume(0.7, 1)).toBe(0.8);
    expect(sanitizeVolume(0.4, 0.4)).toBe(0.4);
    expect(sanitizeVolume(0.43, 0.4)).toBe(0.4);
    expect(sanitizeVolume('x', 0.4)).toBe(0.4);
    expect(sanitizeVolume(Number.NaN, 0.4)).toBe(0.4);
    expect(sanitizeVolume(7, 0.4)).toBe(1);
    expect(sanitizeVolume(-2, 0.4)).toBe(0);
  });
});

const world = (n: number, feet: { x: number; y: number }[], season = 0) => ({ plantCount: n, feet, season });

/** Fait tourner un pilote sur `seconds` secondes simulées par pas de 1/60 s ; garde les plantes dans le monde. */
function run(seed: number, seconds: number) {
  const pilot = createPilot(seed);
  const feet: { x: number; y: number }[] = [];
  const all: { t: number; a: PilotAction }[] = [];
  let season = 0;
  for (let i = 0; i < seconds * 60; i++) {
    const acts = pilot.step(1 / 60, world(feet.length, feet, season));
    for (const a of acts) {
      all.push({ t: pilot.elapsed, a });
      if (a.kind === 'plant') feet.push({ x: a.x, y: a.y });
      if (a.kind === 'season') season = a.to;
    }
  }
  return { pilot, all, feet };
}

describe('pilote du mode contemplatif (SPEC F-11)', () => {
  it('même graine, mêmes actions ; autre graine, autres actions', () => {
    const a = run(123, 300).all;
    const b = run(123, 300).all;
    const c = run(124, 300).all;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('plante toutes les 8 à 14 s dans la bande y 480–860, à ≥ 90 uf des autres pieds, sans sortir de la feuille', () => {
    for (const seed of [1, 2, 3, 99, 4242]) {
      const r = run(seed, 700);
      const plants = r.all.filter((x) => x.a.kind === 'plant');
      expect(plants.length).toBe(PILOT.maxPlants);
      let prev = 0;
      plants.forEach((p) => {
        const gap = p.t - prev;
        expect(gap).toBeGreaterThanOrEqual(PILOT.plantEveryS[0] - 0.02);
        expect(gap).toBeLessThanOrEqual(PILOT.plantEveryS[1] + 0.02);
        prev = p.t;
        const a = p.a as Extract<PilotAction, { kind: 'plant' }>;
        expect(a.y).toBeGreaterThanOrEqual(PILOT.yMin);
        expect(a.y).toBeLessThanOrEqual(PILOT.yMax);
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x).toBeLessThan(SHEET_W);
        expect(a.y).toBeLessThan(SHEET_H);
        expect([0, 1, 2, 3, 4]).toContain(a.espece);
      });
      for (let i = 0; i < r.feet.length; i++)
        for (let j = i + 1; j < r.feet.length; j++) expect(Math.hypot(r.feet[i]!.x - r.feet[j]!.x, r.feet[i]!.y - r.feet[j]!.y)).toBeGreaterThanOrEqual(PILOT.minFeetUf);
      // 40e plante entre 5 min 20 et 9 min 20 (SPEC F-11 : 40 × 8 s à 40 × 14 s)
      const t40 = plants[39]!.t;
      expect(t40).toBeGreaterThanOrEqual(320 - 0.1);
      expect(t40).toBeLessThanOrEqual(560 + 0.1);
    }
  });

  it('ne plante plus après 40 plantes dans le jardin ; rafales et saisons continuent', () => {
    const r = run(7, 720);
    const plants = r.all.filter((x) => x.a.kind === 'plant');
    expect(plants.length).toBe(40);
    const t40 = plants[39]!.t;
    expect(r.all.filter((x) => x.t > t40 + 20 && x.a.kind === 'plant').length).toBe(0);
    expect(r.all.filter((x) => x.t > t40 && x.a.kind === 'gust').length).toBeGreaterThan(0);
    expect(r.all.filter((x) => x.a.kind === 'season').length).toBeGreaterThanOrEqual(9); // 720 / 75 = 9,6
    // un jardin déjà plein (plantes de l’utilisateur) : le pilote ne plante rien
    const p = createPilot(5);
    let planted = 0;
    for (let i = 0; i < 60 * 300; i++) planted += p.step(1 / 60, world(55, [])).filter((a) => a.kind === 'plant').length;
    expect(planted).toBe(0);
  });

  it('rafale toutes les 10 à 25 s, saison toutes les 75 s (toujours la suivante)', () => {
    const r = run(11, 700);
    const times = (k: string) => r.all.filter((x) => x.a.kind === k).map((x) => x.t);
    const g = times('gust');
    expect(g.length).toBeGreaterThan(20);
    g.forEach((t, i) => {
      const gap = t - (i === 0 ? 0 : g[i - 1]!);
      expect(gap).toBeGreaterThanOrEqual(10 - 0.02);
      expect(gap).toBeLessThanOrEqual(25 + 0.02);
    });
    times('season').forEach((t, i) => expect(Math.abs(t - 75 * (i + 1))).toBeLessThan(0.05));
    const seasons = r.all.filter((x) => x.a.kind === 'season').map((x) => (x.a as { to: number }).to);
    expect(seasons.slice(0, 5)).toEqual([1, 2, 3, 0, 1]);
  });

  it('poids des espèces : herbes 0,30, bambou 0,20, pivoine 0,20, cerisier 0,15, roche 0,15', () => {
    const rng = makeRng(9, 8, 7, 6);
    const n = 40_000;
    const c = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) c[pickSpecies(rng.next())]!++;
    const want = [0.2, 0.15, 0.3, 0.2, 0.15];
    c.forEach((v, i) => expect(Math.abs(v / n - want[i]!)).toBeLessThan(0.01));
    expect(PILOT.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('pas plafonné : un onglet resté caché ne déclenche pas de rafale d’actions', () => {
    const p = createPilot(3);
    const acts = p.step(10_000, world(0, []));
    expect(acts.length).toBeLessThanOrEqual(1);
    expect(p.elapsed).toBe(PILOT.dtMaxS);
  });

  it('feuille encombrée : aucune position libre → pas de plante, nouvel essai plus tard', () => {
    const rng = makeRng(1, 1, 1, 1);
    const feet: { x: number; y: number }[] = [];
    for (let x = 0; x <= 1600; x += 60) for (let y = 460; y <= 880; y += 60) feet.push({ x, y });
    expect(pickSpot(rng, feet)).toBeNull();
    expect(pickSpot(rng, [])).not.toBeNull();
  });
});

describe('inactivité (SPEC F-11)', () => {
  it('90 s sans interaction, en plein écran, hors du mode : entrée ; sinon non', () => {
    expect(CONTEMPLATIVE_IDLE_S).toBe(90);
    const t0 = 1000;
    expect(idleDue(t0, t0 + 89_999, true, false)).toBe(false);
    expect(idleDue(t0, t0 + 90_000, true, false)).toBe(true);
    expect(idleDue(t0, t0 + 90_000, false, false)).toBe(false); // pas en plein écran : pas d’entrée automatique
    expect(idleDue(t0, t0 + 500_000, true, true)).toBe(false); // déjà dedans
    expect(idleDue(t0 + 50_000, t0 + 90_000, true, false)).toBe(false); // une interaction à 50 s repousse l’échéance
  });
});

// Contraste WCAG 2.x sur des couleurs réelles de l'interface (valeurs de bar.ts : fond washi à 0,85, icônes et texte
// sumi à 0,78, bord des points à 0,7).
function lin(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
const over = (fg: number[], a: number, bg: number[]) => fg.map((v, i) => v * a + bg[i]! * (1 - a));
const ratio = (x: number[], y: number[]) => {
  const [a, b] = [lum(x), lum(y)].sort((p, q) => q! - p!);
  return (a! + 0.05) / (b! + 0.05);
};
const WASHI = [243, 236, 221];
const SUMI = [30, 36, 48];

describe('contrastes (calcul WCAG sur les couleurs de l’interface)', () => {
  it.each([
    ['sur washi uni', WASHI],
    ['sur de l’encre pleine', SUMI],
  ])('barre %s : icônes et texte ≥ 4,5:1, bord des points ≥ 3:1', (_n, backdrop) => {
    const bar = over(WASHI, 0.85, backdrop!);
    expect(ratio(over(SUMI, 0.78, bar), bar)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(over(SUMI, 0.7, bar), bar)).toBeGreaterThanOrEqual(3);
  });
  it('focus : contour sumi sur washi (SPEC §7.2 : 13,2:1)', () => {
    expect(ratio(SUMI, WASHI)).toBeGreaterThan(13);
  });
  it('dictionnaires FR / EN : mêmes clés, aucune valeur vide', () => {
    expect(Object.keys(FR).sort()).toEqual(Object.keys(EN).sort());
    for (const k of Object.keys(FR)) {
      expect(FR[k]!.length).toBeGreaterThan(0);
      expect(EN[k]!.length).toBeGreaterThan(0);
    }
  });
});
