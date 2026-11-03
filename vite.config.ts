/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// Ports : on ne fixe rien ici ; les scripts passent --port et --strictPort (port libre).
//
// INTERRUPTEUR UNIQUE DES CROCHETS DE TEST (audit J6, point 2) : le mode de Vite.
//   - `production` (npm run build, npm run preview)        -> __TEST_HOOKS__ = false, une seule page (index.html), sortie `dist/`.
//   - `test` (npm run build:test, npm run test, bench, ...) -> __TEST_HOOKS__ = true, + determinism.html et bench.html,
//                                                              sortie `node_modules/.jardin-test` (ignorée par git, jamais publiée).
//   - `development` (npm run dev)                          -> __TEST_HOOKS__ = true.
// Tout autre mode (par exemple `--mode golden` de vitest) : crochets coupés par prudence, sauf `test` et `development`.
const TEST_OUT_DIR = 'node_modules/.jardin-test';

/** Texte de la licence MIT de Vite seul (le fichier du paquet liste aussi 100 Ko de licences d'outils non livrés). */
function viteCoreLicense(): string {
  const full = readFileSync(new URL('./node_modules/vite/LICENSE.md', import.meta.url), 'utf8');
  const cut = full.indexOf('# Licenses of bundled dependencies');
  return (cut > 0 ? full.slice(0, cut) : full).trim();
}

/**
 * Livre les avis de licence avec la page (audit J6, point 3) : `LICENSES.txt` à côté de `index.html`, composé à chaque build
 * à partir des textes RÉELS des paquets installés (jamais recopiés à la main), et `<link rel="license">` dans l'en-tête.
 *  - three.js (MIT) : tout le rendu ; `node_modules/three/LICENSE`.
 *  - Vite (MIT) : le petit préchargeur de modules (`modulepreload-polyfill`) injecté dans la page ; cœur de `node_modules/vite/LICENSE.md`.
 * Les autres paquets du lot sont des outils de développement qui ne sont pas dans la page (voir THIRD_PARTY.md).
 */
function licensesPlugin(): Plugin {
  return {
    name: 'jardin-licenses',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'link', attrs: { rel: 'license', href: 'LICENSES.txt' }, injectTo: 'head' }];
    },
    generateBundle() {
      const three = readFileSync(new URL('./node_modules/three/LICENSE', import.meta.url), 'utf8').trim();
      const text = [
        "Jardin d'encre : avis de licence des composants tiers livrés avec cette page.",
        "Le code du jardin lui-même : tous droits réservés.",
        '',
        '================================================================================',
        'three.js (rendu WebGPU / WebGL2 et TSL), version 0.187.0, licence MIT',
        '================================================================================',
        three,
        '',
        '================================================================================',
        'Vite (petit utilitaire de préchargement de modules injecté dans la page), licence MIT',
        '================================================================================',
        viteCoreLicense(),
        '',
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: 'LICENSES.txt', source: text });
    },
  };
}

export default defineConfig(({ mode }) => {
  const hooks = mode === 'development' || mode === 'test';
  return {
    // Chemins relatifs : la page marche à la racine d'un domaine comme dans un sous-dossier (GitHub Pages sert un site de projet sous /<dépôt>/).
    base: './',
    plugins: [licensesPlugin()],
    define: { __TEST_HOOKS__: JSON.stringify(hooks) },
    build: {
      target: 'es2022', // top-level await possible, WebGPU
      outDir: mode === 'test' ? TEST_OUT_DIR : 'dist',
      emptyOutDir: true,
      sourcemap: false,
      chunkSizeWarningLimit: 2000,
      rolldownOptions: {
        // Pages de mesure : `determinism.html` (déterminisme, J2) et `bench.html` (paliers et sonde particules, J3) n'existent
        // que dans la construction de test. La construction de production n'a QUE `index.html`.
        input: (mode === 'test' ? { index: 'index.html', determinism: 'determinism.html', bench: 'bench.html' } : { index: 'index.html' }) as Record<string, string>,
      },
    },
    server: { host: 'localhost' },
    preview: { host: 'localhost' },
    test: {
      include: ['tests/unit/**/*.test.ts'],
      environment: 'node',
    },
  };
});
