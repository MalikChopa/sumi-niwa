// Constantes nommées comme dans docs/SPEC.md (J1 : papier et niveaux seulement).
// Statuts entre parenthèses : D = décidé, VD = valeur de départ, OM = objectif à mesurer.

/** Feuille de 1600 x 900 unités feuille (uf). SPEC §1, D-c. */
export const SHEET_W = 1600;
export const SHEET_H = 900;

/** Couleurs : washi et sumi, SPEC §1, D-u (sRVB 0-1 calculé depuis l'hexadécimal). */
export const COL_WASHI = '#F3ECDD';
export const COL_SUMI = '#1E2430';

/** Vignette de la maquette : couleur, début à 62 % du rayon, opacité max 0,22. SPEC §1, D-c. */
export const VIGNETTE = { color: '#6B5A3A', start: 0.62, maxOpacity: 0.22 } as const;

/** Papier. SPEC §6, VD. */
export const PAPER_FIBERS = 6000; // fibres courtes (cuites dans le shader par cellules)
export const PAPER_FBM_OCTAVES = 4;
export const PAPER_GRAIN = 0.04; // amplitude du bruit par pixel d'écran, statique
export const PAPER_BREATH = 0.015; // variation de luminance crête à crête (plafond 2 %)
export const PAPER_BREATH_PERIOD_S = 9; // période de la respiration

/** Délais. SPEC §1. */
export const PAPER_VISIBLE_MS = 3000; // OM : de navigationStart à la marque `paper-visible`
export const REDUCED_NOTICE_MS = 8000; // VD : message de la version réduite
export const RESCUE_DELAY_S = 6; // D-d : secours HTML ; valeur répétée dans index.html (animation CSS)

/** Niveaux de rendu (SPEC §11, F-12). */
export type Level = 'complet' | 'reduit' | 'refus';

// ---------------------------------------------------------------------------------------------
// J2 : plantes, entrées, mesures. Fichier pur (aucun DOM, aucun `Math` hors liste blanche) :
// importé aussi par src/core.

/** Couleurs d'accent et variantes. SPEC §1. */
export const COL_SAKURA = '#E8A5B5';
export const COL_ETE = '#8FB87A';
export const COL_ERABLE = '#B8402F';
export const COL_HIVER = '#AEB8C4';
export const COL_ERABLE_VAR = ['#9C3426', '#CC5A3A'] as const;
export const COL_HERBE_SOMBRE = { ete: '#4D5A45', automne: '#5A4636' } as const;

/** Nombre maximal de plantes. SPEC §1, D-d. */
export const MAX_PLANTS = 160;
/** OM : du relâchement au premier trait dessiné. SPEC §1. */
export const PLANT_RESPONSE_MS = 200;
/** OM : de navigationStart au premier pixel de trait (marque `first-stroke`). SPEC §1. */
export const FIRST_PLANT_MS = 3000;
/** Pas simulé maximal. SPEC §1, D-d. */
export const SIM_DT_MAX_MS = 50;
/** Bande du sol. SPEC §1, D-c. */
export const GROUND_Y_MIN = 790;
export const GROUND_Y_MAX = 875;

/**
 * Bornes par plante (SPEC §2.2). `MARKS_MAX_PER_PLANT` relevée au J2 (règle de SPEC §2.2 : au-delà de
 * 90 % d'une borne sur 10 000 graines x 5 espèces, elle est relevée) : la SPEC comptait une marque par
 * position décorée, or chaque position porte une marque par saison (fleur, feuille, érable, neige).
 * Valeur et pire cas mesurés : docs/JOURNAL.md, J2.
 */
export const STROKES_MAX_PER_PLANT = 64;
export const STROKE_VERTS_MAX_PER_PLANT = 2048;
export const MARKS_MAX_PER_PLANT = 512;

/** Sommet de trait : 12 float32 (48 octets). Marque : 16 float32 (64 octets). SPEC §2.2. */
export const STROKE_VERTEX_FLOATS = 12;
export const MARK_FLOATS = 16;

/** Pointe en croissance effilée sur 0,25 s (VD). SPEC §4.1. */
export const TIP_LEN_S = 0.25;

/** Codes d'espèce (contrat d'URL). SPEC §4. */
export const SPECIES = ['bambou', 'cerisier', 'herbes', 'pivoine', 'roche'] as const;
export type SpeciesCode = 0 | 1 | 2 | 3 | 4;
export const SPECIES_COUNT = 5;

/** Balancement maximal par espèce (uf). SPEC §4.2, VD (stocké, appliqué au J3 avec le vent). */
export const SWAY_MAX = [6, 5, 9, 3, 0] as const;

/** Souris. SPEC §7.1, D-d. */
export const HOLD_START_MS = 300;
export const HOLD_STEP_MS = 500;
export const HOLD_CANCEL_PX = 12;
/** Graine d'encre : point de 8 uf à l'image suivant l'appui. SPEC §7.1, D-c. */
export const SEED_DOT_UF = 8;
/** Jauge DOM : rayon 30 px, 5 points à 44 px (maquette). SPEC §7.1, D-c. */
export const GAUGE_RADIUS_PX = 30;
export const GAUGE_DOTS_RADIUS_PX = 44;

// ---------------------------------------------------------------------------------------------
// J3 : encre, vent, particules, paliers. SPEC §2, §3, §6 (statuts entre parenthèses).

/** OM : de `event.timeStamp` à l'image qui applique l'impulsion de vent. SPEC §1. */
export const WIND_RESPONSE_MS = 100;
/** Vent du curseur. SPEC §6. */
export const WIND_SAMPLES = 16; // impulsions en anneau (D-d)
export const WIND_SAMPLE_MIN_MS = 33; // (D-d)
export const WIND_RADIUS = 140; // uf, gaussienne (VD)
export const WIND_DECAY_S = 1.2; // (VD)
export const WIND_GAIN = 0.6; // × vitesse du curseur (VD)
export const WIND_MAX = 600; // uf/s (VD)
/** Montée d'une impulsion (s) : le vent prend en ≈ 0,1 s au lieu d'un saut (réglage du J3, mouvement doux). */
export const WIND_RISE_S = 0.08;
/** Brise : bruit « curl » d'échelle 400 uf, 0,05 Hz, 12 uf/s × facteur de saison. SPEC §6 (VD). */
export const BREEZE = { scale: 400, hz: 0.05, speed: 12 } as const;
/** Vent qui donne le balancement maximal `SWAY_MAX` (uf/s) : réglage du J3 (VD). */
export const SWAY_WIND_REF = 160;

/** Particules. SPEC §6 (VD). */
export const MOTE_SIZE = [0.8, 1.6] as const;
export const MOTE_ALPHA = [0.04, 0.1] as const;
export const MOTE_STRETCH_S = 0.03;
export const MOTE_DRAG = 0.9; // /s
export const MOTE_MARGIN = 50; // uf
export const CARRIER_SPIN = [0.5, 2] as const; // rad/s
export const CARRIER_SWING_UF = 10;
export const CARRIER_SWING_HZ = [0.5, 1.2] as const;
export const CARRIER_REST_S = [2, 6] as const;
export const CARRIER_FADE_S = 1;
/** Vitesse de chute des porteurs (uf/s) : non chiffrée par la SPEC, réglage du J3 (VD). */
export const CARRIER_FALL = [16, 30] as const;
export const STAIN_PROB = 0.02;
export const STAIN_ALPHA = 0.15;
export const STAIN_RADIUS_K = 2.6; // × taille du porteur
export const STAIN_FADE = 0.995; // une fois par seconde
/** Codes des particules (SPEC §2.2) : type + 8 × état + 64 × variante. */
export const P_TYPE = { BRUME: 0, PETALE: 1, FEUILLE: 2, ERABLE: 3, FLOCON: 4 } as const;
/** État 4 ajouté au J3 : « posé à cette image, avec tache » (la SPEC n'a que 0 à 3). */
export const P_ETAT = { VOL: 0, POSE: 1, POSE_IMAGE: 2, SOMMEIL: 3, POSE_TACHE: 4 } as const;

/** Encre. SPEC §6 (VD). */
export const INK_INJECT = { net: { water: 1.0 }, lavis: { water: 1.5, pigment: 0.3 }, pose: { water: 0.6, pigment: 0.05 } } as const;
export const INK_DIFFUSE = 0.2;
// Réglés au J3 (VD) par simulation hors navigateur puis à l'œil : avec les valeurs de départ de la SPEC
// (0,015 ; × 3 ; 0,35 ; 0,04) le pigment ne dépassait pas 4 uf et tout séchait en 1,5 s (voir JOURNAL, J3).
export const INK_EVAP = 0.008; // SPEC : 0,015
export const INK_EDGE_EVAP = 2; // SPEC : 3
export const INK_PIGMENT_FLOW = 0.7; // SPEC : 0,35
export const INK_DEPOSIT = 0.02; // SPEC : 0,04
/** Front d'eau : une cellule sèche ne se mouille que si sa voisine dépasse 0,01 + 0,08 × hauteur du papier (J3, VD). */
export const INK_FRONT = { base: 0.01, height: 0.08, soft: 0.06, low: 0.06, evapSub: 0.0008 } as const;
export const INK_GRANULATION = 0.5;
export const INK_WIND_DRIFT = 0;
export const INK_ABSORB_K = 2.2;
/** Papier cuit pour la diffusion (SPEC §2.1 `TEX_PAPER`, chemin `complet`). */
export const TEX_PAPER_SIZE = [2048, 1152] as const;

/** Paliers. SPEC §3. */
export type TierId = 'T3' | 'T2' | 'T1' | 'T0' | 'R';
export interface TierSpec {
  id: TierId;
  motes: number;
  carriers: number;
  grid: readonly [number, number] | null;
  /** sous-pas par image (2) ou une image sur n (valeur négative : −n) */
  substeps: number;
  renderScale: number;
  maxPixelRatio: number;
}
export const TIERS: Record<TierId, TierSpec> = {
  T3: { id: 'T3', motes: 196_000, carriers: 4_000, grid: [1920, 1080], substeps: 2, renderScale: 1, maxPixelRatio: 2 },
  T2: { id: 'T2', motes: 98_000, carriers: 2_000, grid: [960, 540], substeps: 1, renderScale: 1, maxPixelRatio: 1.5 },
  T1: { id: 'T1', motes: 38_500, carriers: 1_500, grid: [640, 360], substeps: -2, renderScale: 0.85, maxPixelRatio: 1.5 },
  T0: { id: 'T0', motes: 14_000, carriers: 1_000, grid: [480, 270], substeps: -3, renderScale: 0.75, maxPixelRatio: 1.5 },
  R: { id: 'R', motes: 4_000, carriers: 1_000, grid: null, substeps: 0, renderScale: 1, maxPixelRatio: 1.5 },
};
/** Ordre des paliers `complet`, du plus bas au plus haut. */
export const TIER_ORDER: readonly TierId[] = ['T0', 'T1', 'T2', 'T3'];

/** Contrôleur adaptatif. SPEC §3. */
export const QC_START_TIER: TierId = 'T2';
export const QC_PROBE_S = 2;
export const QC_WINDOW_MS = 250;
export const QC_WINDOWS = 10;
export const QC_SLOW_FRAME_MS = 18.5;
export const QC_DOWN_MIN_SLOW = 8;
export const QC_UP_GPU_MS = 11;
export const QC_UP_WINDOWS = 40;
export const QC_UP_MIN_OK = 36;
/**
 * Rapport de coût GPU d'un palier au suivant (T0→T1, T1→T2, T2→T3). SPEC : 2,0 par défaut, remplacé au J3 par les
 * rapports mesurés par `npm run bench` : 1,20 / 1,40 / 1,43 (Edge 156 headless, AMD RDNA 3, 2026-11-02, INDICATIF),
 * arrondis au 0,05 supérieur. À remplacer par ceux de ta mesure fenêtrée.
 */
export const QC_TIER_RATIO: Readonly<Record<'T0' | 'T1' | 'T2', number>> = { T0: 1.25, T1: 1.4, T2: 1.45 };
/** Valeur de départ de la SPEC (test de synthèse « un Moyen à 8,3 ms ne monte pas »). */
export const QC_TIER_RATIO_SPEC = 2.0;
export const QC_TRIAL_AFTER_S = 20;
export const QC_TRIAL_FRAME_MS = 17.2;
export const QC_TRIAL_OBSERVE_S = 5;
export const QC_COOLDOWN_S = 3;
export const QC_MAX_FLIPFLOPS = 3;
export const QC_LOW_NOTICE = { frameMs: 33.3, seconds: 10 } as const;

/** Mouvement réduit. SPEC §6 (D-d). */
export const REDUCED_MOTION = { wind: 0.3, sway: 0.3, mist: 0.25, fall: 0.6 } as const;

/** Perte du device. ARCHITECTURE §7, SPEC §11 (D-d). */
export const DEVICE_LOSS = { retryDelayMs: 1000, maxAttempts: 3, windowMs: 60_000 } as const;

// ---------------------------------------------------------------------------------------------
// J4 : saisons, lien, export PNG, nouvelle feuille, barre. SPEC §1, §5, §7.3, §8 (statuts entre parenthèses).

/** Transition de saison : 3 600 ms, courbe `smoothstep`, sur le temps réel (D-d ; critère du cahier < 4 000 ms). */
export const SEASON_TRANSITION_MS = 3600;
export const SEASON_TRANSITION_MAX_MS = 4000;
/** Aucune image ne dépasse 50 ms pendant une transition (OM, indicatif). */
export const SEASON_FRAME_MAX_MS = 50;
/** Molette : cumul de `deltaY`, seuil 100 → saison suivante (vers le bas) ou précédente (SPEC §7.1, D-d). */
export const WHEEL_STEP = 100;
/** Après un changement à la molette, les crans suivants du même geste sont ignorés pendant ce délai (ms, décision du J4). */
export const WHEEL_LOCK_MS = 450;
/** Barre : masquée après 3 000 ms d'immobilité de la souris (D-c). */
export const UI_HIDE_AFTER_MS = 3000;
/** Nouvelle feuille : fondu de l'encre (VD) et seuil de confirmation (D-d). */
export const NEW_SHEET_FADE_MS = 1200;
export const CONFIRM_MIN_PLANTS = 5;
/** Ouverture d'un lien : intervalle entre plantes (ms) et croissance × 3 (VD). */
export const REPLAY_STAGGER_MS = 150;
export const REPLAY_SPEED = 3;
/** Au plus une écriture `replaceState` par 500 ms (D-d). */
export const URL_WRITE_MIN_MS = 500;
/** Message bref (VD). */
export const TOAST_MS = 4000;

/** Saisons (SPEC §5) : ordre printemps, été, automne, hiver. */
export const SEASON_COUNT = 4;
export const SEASON_IDS = ['printemps', 'ete', 'automne', 'hiver'] as const;
/** Accent de chaque saison (pastille de la barre, taches). */
export const SEASON_ACCENT = [COL_SAKURA, COL_ETE, COL_ERABLE, COL_HIVER] as const;
/** Type des porteurs par saison : 1 pétale, 2 feuille d'été, 3 feuille d'érable, 4 flocon (SPEC §2.2, §5). */
export const SEASON_CARRIER_TYPE = [1, 2, 3, 4] as const;
/**
 * Réglages par saison (SPEC §5, VD). `part` = part active des porteurs ; `breeze` = facteur de BREEZE ;
 * `fall` = chute (uf/s) de la SPEC, appliquée en rapport à l'automne (= la chute réglée au J3, voir JOURNAL J4) ;
 * `mist` = opacité de la brume (valeur SPEC ÷ 0,06, rapport à la brume du J3).
 */
export const SEASON_PARAMS = {
  part: [0.6, 0.3, 1.0, 1.0],
  breeze: [1.0, 0.7, 1.3, 0.5],
  fall: [30, 18, 45, 22],
  mist: [0.06, 0.05, 0.06, 0.1],
} as const;
/** Chute de référence : l'automne de la SPEC (45 uf/s) correspond à la chute réglée au J3. */
export const SEASON_FALL_REF = 45;
/** Opacité de brume de référence (0,06 du J3). */
export const SEASON_MIST_REF = 0.06;

/** Export PNG (SPEC §8, D-d) : 3 840 x 2 160 ou la limite du GPU ; ≤ 3 s (OM) ; sceau de 44 uf en (1500, 820). */
export const EXPORT_W = 3840;
export const EXPORT_H = 2160;
export const EXPORT_MAX_MS = 3000;
export const SEAL = { x: 1500, y: 820, size: 44 } as const;
/** Les particules en vol figurent dans le PNG comme à l'écran (décision du J4 : « ce que tu vois est ce que tu gardes »). */
export const EXPORT_PARTICLES = true;

/** Barre d'icônes (SPEC §7.3) : opacité du fond, 0,55 dans la maquette, portée à 0,85 comme la SPEC le prévoit (contraste calculé < 3:1 sur de l'encre pleine à 0,55 : JOURNAL J4). */
export const BAR_BG_ALPHA = 0.85;

// ---------------------------------------------------------------------------------------------
// J5 : son (F-9), mode contemplatif (F-11), finitions d'accessibilité. SPEC §1, §7.2, §9, F-9, F-11 (statuts entre parenthèses).

/** Mode contemplatif : entrée automatique après 90 s sans interaction en plein écran (D-u) ; interface et curseur masqués après 3 s. */
export const CONTEMPLATIVE_IDLE_S = 90;
export const CONTEMPLATIVE_HIDE_S = 3;
/**
 * Pilote du mode contemplatif (SPEC F-11, VD) : une plante toutes les 8 à 14 s jusqu'à 40 plantes dans le jardin, bande
 * y 480–860 uf, à 90 uf au moins des autres pieds, poids d'espèce (ordre des codes : bambou, cerisier, herbes, pivoine,
 * roche) ; une rafale toutes les 10 à 25 s, une saison toutes les 75 s (elles continuent après les 40 plantes).
 */
export const PILOT = {
  plantEveryS: [8, 14],
  maxPlants: 40,
  yMin: 480,
  yMax: 860,
  xMin: 60,
  xMax: 1540,
  minFeetUf: 90,
  weights: [0.2, 0.15, 0.3, 0.2, 0.15],
  gustEveryS: [10, 25],
  seasonEveryS: 75,
  /** essais de position avant de renoncer à une plantation (la feuille est encombrée) puis nouvel essai après ce délai (s) */
  tries: 40,
  retryS: 2,
  /** pas d'horloge du pilote plafonné (s) : un onglet resté caché ne déclenche pas une rafale d'actions */
  dtMaxS: 1,
} as const;
/** Rafale manuelle (touche V, bouton Vent) et du pilote : balayage de la feuille, `GUST.lengthUf` en `GUST.durS` (VD, J5). */
export const GUST = { lengthUf: 1100, durS: 2.6 } as const;

/** Son (SPEC §9, VD). Valeurs de niveau réglées au J5 (voir JOURNAL) : `WIND_NOISE_RMS` et `BED` ne sont pas dans la SPEC. */
export const VOLUME_DEFAULT = 0.4;
export const VOLUME_STEP = 0.1;
export const VOLUME_RAMP_S = 0.05;
export const MASTER_HEADROOM = 0.5;
export const LIMITER = { threshold: -18, ratio: 12 } as const;
export const WIND_SOUND = { noiseS: 2, q: 0.8, hzMin: 300, hzMax: 1200, gainMax: 0.15 } as const;
export const DROP_SOUND = { hzMin: 900, hzMax: 1600, attackS: 0.005, decayS: 0.08, gain: 0.08, maxPerS: 3 } as const;
/** Pentatonique majeure de ré ; indice = floor(x / 1600 × 6) ; roche une octave plus bas. */
export const PLANT_NOTES_HZ = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33] as const;
export const PLANT_NOTE = { attackS: 0.02, releaseS: 1.8, gain: 0.12 } as const;
export const REVERB = { seconds: 2.5, mix: 0.25 } as const;
/** Seuil de F-9 : RMS de l'analyseur (avant la sortie) quand le son est activé. */
export const AUDIO_RMS_MIN = 0.005;
/** Mouvement du pinceau clavier (uf), SPEC §7.2. */
export const BRUSH_STEP = 20;
export const BRUSH_STEP_BIG = 80;
/** Niveau du lit de brise toujours présent quand le son est activé (force du vent de 0 à 1) et rattrapage du passe-bande (bruit blanc normalisé à 1 de RMS à 48 kHz) : réglés au J5 par mesure de l'analyseur, hors SPEC (VD). */
export const WIND_BED = 0.3;
export const WIND_MAKEUP = 2.5;
/** Vitesse du vent (uf/s) qui donne la force sonore 1. */
export const WIND_SOUND_REF = 220;
