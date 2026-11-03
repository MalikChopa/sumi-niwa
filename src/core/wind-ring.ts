// Indicateur du vent sous le curseur (maquette A écran 2, « curseur-vent ») : logique d'apparition et d'estompage, pure.
// Visible pendant que la souris bouge sur la feuille ; après WIND_RING.holdMs d'immobilité il s'estompe en
// WIND_RING.fadeMs (fondu lent). Mouvement réduit : affiché ou masqué net, sans fondu.
export const WIND_RING = {
  /** immobilité avant le début du fondu (ms, VD) */
  holdMs: 250,
  /** durée du fondu (ms, ~600 d'après la demande) */
  fadeMs: 600,
  /** dessin en unités feuille (maquette) : cercle r 11 (trait .55, épaisseur 1,5), point r 2,4 (.7), anneau pointillé r 36 (.12, épaisseur 1, tirets « 3 6 ») */
  inner: { r: 11, opacity: 0.55, width: 1.5 },
  dot: { r: 2.4, opacity: 0.7 },
  outer: { r: 36, opacity: 0.12, width: 1, dash: '3 6' },
} as const;

/** Opacité (0–1) de l'indicateur `nowMs` après le dernier mouvement `lastMoveMs` (nul ou négatif : jamais bougé). */
export function ringOpacity(nowMs: number, lastMoveMs: number, reducedMotion: boolean): number {
  if (!(lastMoveMs > 0)) return 0;
  const idle = nowMs > lastMoveMs ? nowMs - lastMoveMs : 0;
  if (idle <= WIND_RING.holdMs) return 1;
  if (reducedMotion) return 0; // net : affiché puis masqué, sans fondu
  const k = (idle - WIND_RING.holdMs) / WIND_RING.fadeMs;
  return k >= 1 ? 0 : 1 - k;
}

/** L'indicateur a-t-il le droit d'apparaître ? Souris seulement (pas de curseur au toucher), pas pendant un appui (la jauge prend la main), ni en mode contemplatif, ni derrière une boîte de dialogue. */
export function ringAllowed(o: { pointerType: string; pressed: boolean; contemplative: boolean; dialogOpen: boolean }): boolean {
  return (o.pointerType === 'mouse' || o.pointerType === 'pen') && !o.pressed && !o.contemplative && !o.dialogOpen;
}
