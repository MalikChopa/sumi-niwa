// Horloge de l'inactivité (SPEC F-11 : « horloge simulée en test »). En usage normal c'est `performance.now()` ; le mode
// test peut l'avancer d'un décalage (crochet `advanceClock`) pour ne pas attendre 90 s. Seule l'inactivité la lit : les
// images, le vent et les saisons restent sur le temps réel.
let offset = 0;

export const clock = {
  now(): number {
    return performance.now() + offset;
  },
  /** Avance l'horloge de l'inactivité de `ms` (mode test). */
  advance(ms: number): void {
    offset += Math.max(0, ms);
  },
  get offset(): number {
    return offset;
  },
};
