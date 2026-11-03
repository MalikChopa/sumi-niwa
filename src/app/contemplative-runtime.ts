// Mode contemplatif en marche (F-11, SPEC §10) : touche C, ou entrée automatique après CONTEMPLATIVE_IDLE_S (90 s) sans
// interaction en plein écran (horloge de l'inactivité injectable : `clock`). Dedans : le plein écran est demandé, la barre
// et le curseur disparaissent après 3 s, et le pilote (src/core/contemplative.ts) fait pousser le jardin tout seul.
// Toute touche ou clic sort du mode SANS planter (l'événement est avalé en phase de capture) ; le compte à rebours de 90 s
// repart. Jamais de flash : aucune transition de luminosité n'est ajoutée, seuls la barre et le curseur s'estompent.
import { CONTEMPLATIVE_HIDE_S, CONTEMPLATIVE_IDLE_S, GUST } from '../constants';
import { createPilot, idleDue, type Pilot, type PilotAction } from '../core/contemplative';
import { clock } from './clock';
import type { Garden } from './garden';
import type { Effects } from './effects';
import type { Bar } from '../ui/bar';
import { dialogOpen } from '../ui/dialogs';
import { showToast } from '../ui/messages';
import { t } from '../ui/i18n';

export interface ContemplativeHost {
  session(): { garden: Garden; effects: Effects } | null;
  bar(): Bar | null;
  setSeason(i: number): void;
}

export interface ContemplativeStats {
  active: boolean;
  entries: number;
  lastReason: string;
  /** temps réel écoulé depuis la dernière entrée (ms) */
  realMs: number;
  /** temps du pilote (s) : égal au temps réel × la vitesse du pilote */
  pilotS: number;
  speed: number;
  planted: number;
  gusts: number;
  seasons: number;
  /** pire image et nombre d'images > 100 ms / > 50 ms une fois PILOT 2 min passées (temps du pilote) */
  after2min: { frames: number; max: number; over100: number; over50: number };
  /** idem une fois 2 min de temps RÉEL passées */
  afterReal2min: { frames: number; max: number; over100: number; over50: number };
  /** instants (temps du pilote, s) des plantations : la 40e se lit ici */
  plantTimes: number[];
}

const CSS = `
html.contemplative.nocursor,html.contemplative.nocursor *{cursor:none!important}
`;

export class Contemplative {
  active = false;
  /** Compression du temps du pilote (mode test seulement : 1 en usage normal). */
  speed = 1;
  /** Mode test : plein écran simulé (null = lire `document.fullscreenElement`). */
  fullscreenOverride: boolean | null = null;
  private pilot: Pilot | null = null;
  private lastActivity = clock.now();
  private entryStart = 0;
  private entries = 0;
  private lastReason = '';
  private cursorTimer = 0;
  private readonly style: HTMLStyleElement;
  private readonly interval: number;
  private readonly plantTimes: number[] = [];
  private nPlanted = 0;
  private nGusts = 0;
  private nSeasons = 0;
  private a2 = { frames: 0, max: 0, over100: 0, over50: 0 };
  private r2 = { frames: 0, max: 0, over100: 0, over50: 0 };

  constructor(private readonly host: ContemplativeHost) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    for (const e of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const) window.addEventListener(e, this.onActivity, { capture: true, passive: false });
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.interval = window.setInterval(this.checkIdle, 500);
  }

  get fullscreen(): boolean {
    return this.fullscreenOverride ?? document.fullscreenElement !== null;
  }

  private readonly checkIdle = (): void => {
    if (document.hidden || dialogOpen()) return;
    if (idleDue(this.lastActivity, clock.now(), this.fullscreen, this.active) && this.host.session()?.garden.isReady) this.enter('inactivité');
  };

  /** Phase de capture sur la fenêtre : tout passe ici avant les autres écouteurs. */
  private readonly onActivity = (e: Event): void => {
    this.lastActivity = clock.now();
    if (!this.active) return;
    if (e.type === 'pointermove') {
      this.showCursorBriefly(); // le curseur revient, la barre reste cachée ; le vent du pointeur continue
      return;
    }
    if (e.type === 'wheel' || e.type === 'touchstart') {
      e.stopPropagation(); // pas de changement de saison pendant que le pilote conduit
      e.preventDefault();
      return;
    }
    // touche ou appui : on sort sans que l'événement atteigne la feuille ni les raccourcis (rien n'est planté)
    e.stopPropagation();
    if (e.type === 'keydown' && (e as KeyboardEvent).repeat) return; // maintien de la touche C qui vient d'entrer
    this.exit('interaction');
  };

  private readonly onFullscreenChange = (): void => {
    if (this.active && document.fullscreenElement === null && this.fullscreenOverride === null) this.exit('plein écran quitté'); // Échap natif : quitte le plein écran et le mode
  };

  private showCursorBriefly(): void {
    const root = document.documentElement;
    root.classList.remove('nocursor');
    window.clearTimeout(this.cursorTimer);
    this.cursorTimer = window.setTimeout(() => {
      if (this.active) root.classList.add('nocursor');
    }, CONTEMPLATIVE_HIDE_S * 1000);
  }

  toggle(): void {
    if (this.active) this.exit('touche C');
    else this.enter('touche C');
  }

  enter(reason: string): void {
    const s = this.host.session();
    if (this.active || !s) return;
    this.active = true;
    this.entries++;
    this.lastReason = reason;
    this.entryStart = performance.now();
    s.garden.setPaused(false);
    this.pilot = createPilot((s.garden.state.graine + Math.imul(this.entries, 0x9e3779b9)) >>> 0);
    this.plantTimes.length = 0;
    this.nPlanted = this.nGusts = this.nSeasons = 0;
    this.a2 = { frames: 0, max: 0, over100: 0, over50: 0 };
    this.r2 = { frames: 0, max: 0, over100: 0, over50: 0 };
    const root = document.documentElement;
    root.classList.add('contemplative');
    root.dataset.contemplative = '1';
    // Le plein écran est demandé (SPEC F-11) ; refusé ou absent, le mode marche sans.
    if (!this.fullscreen && document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().catch(() => undefined); // refusé (iframe, politique) : le mode marche sans plein écran
    }
    this.host.bar()?.setSuppressed(true); // visible encore 3 s, puis retirée
    showToast(t('contemplative_on'), CONTEMPLATIVE_HIDE_S * 1000);
    this.showCursorBriefly();
  }

  exit(_reason: string): void {
    if (!this.active) return;
    this.active = false;
    this.pilot = null;
    this.lastActivity = clock.now(); // le compte à rebours de 90 s repart
    window.clearTimeout(this.cursorTimer);
    const root = document.documentElement;
    root.classList.remove('contemplative', 'nocursor');
    delete root.dataset.contemplative;
    this.host.bar()?.setSuppressed(false);
  }

  /** À chaque image (appelé par le jardin) : le pilote avance de dt × vitesse et ses actions sont exécutées. */
  onFrame(now: number, dt: number): void {
    if (!this.active || !this.pilot) return;
    const s = this.host.session();
    if (!s) return;
    const g = s.garden;
    if (!g.isReady) return;
    // Mesure des images (endurance) : pire image et nombre d'images lentes après 2 min (temps du pilote, puis temps réel).
    if (dt > 0 && dt < 5000) {
      if (this.pilot.elapsed >= 120) this.count(this.a2, dt);
      if (now - this.entryStart >= 120_000) this.count(this.r2, dt);
    }
    const acts = this.pilot.step((Math.min(dt, 1000) / 1000) * this.speed, { plantCount: g.plantTotal, feet: g.feet(), season: g.season });
    for (const a of acts) this.apply(a, s, now);
  }

  private count(o: { frames: number; max: number; over100: number; over50: number }, dt: number): void {
    o.frames++;
    if (dt > o.max) o.max = dt;
    if (dt > 100) o.over100++;
    if (dt > 50) o.over50++;
  }

  private apply(a: PilotAction, s: { garden: Garden; effects: Effects }, now: number): void {
    if (a.kind === 'plant') {
      const r = s.garden.plantAt(a.x, a.y, a.espece, null);
      if (r.ok) {
        this.nPlanted++;
        this.plantTimes.push(this.pilot?.elapsed ?? 0);
      }
    } else if (a.kind === 'gust') {
      s.effects.gust(a.x0, a.y0, a.x1, a.y1, a.durS, now);
      this.nGusts++;
    } else {
      this.host.setSeason(a.to);
      this.nSeasons++;
    }
  }

  stats(): ContemplativeStats {
    return {
      active: this.active,
      entries: this.entries,
      lastReason: this.lastReason,
      realMs: this.active ? performance.now() - this.entryStart : 0,
      pilotS: this.pilot?.elapsed ?? 0,
      speed: this.speed,
      planted: this.nPlanted,
      gusts: this.nGusts,
      seasons: this.nSeasons,
      after2min: { ...this.a2 },
      afterReal2min: { ...this.r2 },
      plantTimes: this.plantTimes.slice(),
    };
  }

  dispose(): void {
    for (const e of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const) window.removeEventListener(e, this.onActivity, { capture: true });
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    window.clearInterval(this.interval);
    window.clearTimeout(this.cursorTimer);
    this.style.remove();
  }
}

/** Valeurs de la SPEC, pour les tests et le journal. */
export const CONTEMPLATIVE_FACTS = { idleS: CONTEMPLATIVE_IDLE_S, hideS: CONTEMPLATIVE_HIDE_S, gustLengthUf: GUST.lengthUf } as const;
