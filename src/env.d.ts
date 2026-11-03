/**
 * Interrupteur unique des crochets de test (audit J6, point 2). Défini par `vite.config.ts` selon le mode :
 * `true` en `development` (npm run dev) et `test` (npm run build:test, vitest), `false` en `production` (npm run build).
 * À `false`, le compilateur supprime tout ce qui est gardé par `__TEST_HOOKS__` : `?test=1`, `window.__jardin`, cartouche de
 * marques, paramètres `&fx=`, `&welcome=`, `&windring=`, `&autoplant=`, graine fixe des particules.
 */
declare const __TEST_HOOKS__: boolean;
