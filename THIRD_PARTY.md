# Licences des dépendances : Jardin d'encre

Relevé du 2026-11-01 (J1), mis à jour le 2026-11-03 (correction de l'audit J6 : points 3 et 13), lu dans les paquets installés (`node_modules/<paquet>/package.json` et fichier de licence) et dans `package-lock.json`, pas de mémoire. Versions épinglées exactes dans `package.json`.

## Livré dans la page (inclus dans `dist/`)
|Paquet|Version|Licence|Copyright (fichier `LICENSE`)|Rôle|
|---|---|---|---|---|
|`three` (build `three/webgpu` et `three/tsl`)|0.187.0|MIT|© 2010-2026 three.js authors|rendu WebGPU / WebGL2, TSL|

`three` n'a aucune dépendance d'exécution (champ `dependencies` absent de son `package.json`). Le bundle ne contient pas d'autre paquet tiers que le petit préchargeur de modules que Vite injecte (`modulepreload-polyfill`, MIT, © VoidZero Inc. et contributeurs de Vite) : sur la construction de production il est fondu dans `assets/index-<empreinte>.js` ; sur la construction de test il est un fichier séparé `assets/modulepreload-polyfill-*.js` (0,7 Ko). (La première version de ce relevé disait qu'il n'en restait aucune trace : c'était faux, corrigé le 2026-11-03.)

## Avis de licence livrés avec la page (correction de l'audit J6, point 3)
`npm run build` écrit `dist/LICENSES.txt` à côté de `index.html` et ajoute `<link rel="license" href="LICENSES.txt">` à l'en-tête (plugin `jardin-licenses` de `vite.config.ts`). Le fichier est composé à chaque build à partir des textes réels des paquets installés, jamais recopiés à la main : `node_modules/three/LICENSE` (MIT, © 2010-2026 three.js authors) et le cœur de la licence MIT de `node_modules/vite/LICENSE.md` (© 2019-present VoidZero Inc. and Vite contributors ; la suite de ce fichier liste des outils de développement non livrés et n'est pas reprise). Le contrôle de `scripts/scan-dist.mjs` (fin de `npm run build`) et le test `tests/unit/prod-bundle.test.ts` font échouer la construction si ce fichier ou le lien manque. Aucun changement visible dans la page. Aucun autre code tiers n'est livré (les paquets du lot autres que `three` sont `dev` dans `package-lock.json`, vérifié par script le 2026-11-03).

## Outils de développement (non livrés)
|Paquet|Version|Licence|Usage|
|---|---|---|---|
|`vite`|8.3.5|MIT (© 2019-present VoidZero Inc. and Vite contributors)|serveur et build ; embarque `rolldown` 1.2.16 (MIT), `postcss` 8.5.32 (MIT), `picocolors` (ISC), `source-map-js` (BSD-3-Clause), `lightningcss` 1.33.0 (**MPL-2.0**)|
|`typescript`|7.0.2|Apache-2.0|vérification de types (`tsc`)|
|`@playwright/test`|1.64.1|Apache-2.0|tests dans Edge installé (aucun navigateur téléchargé)|
|`vitest`|5.0.5|MIT (vérifié dans `node_modules/vitest/package.json`)|tests unitaires du cœur (`src/core`) ; approuvé par l utilisateur le 2026-11-01|
|`@types/three`|0.187.0|MIT (© Microsoft Corporation, fichier `LICENSE`)|types ; dépend de `@dimforge/rapier3d-compat` (Apache-2.0), `@tweenjs/tween.js` (MIT), `fflate` (MIT), `meshoptimizer` (MIT), `@types/stats.js`, `@types/webxr` (MIT)|

Total du `package-lock.json` (92 paquets, depuis `vitest`) par licence : MIT 51, Apache-2.0 27, MPL-2.0 12, ISC 1, BSD-3-Clause 1 (recomptés par script le 2026-11-03 sur le champ `license` de chaque entrée de `packages` ; seul `three@0.187.0` n'est pas `dev`). Le relevé du 2026-11-01 donnait 72 paquets (MIT 32, Apache-2.0 26) avant l'ajout de `vitest`.
MPL-2.0 : uniquement `lightningcss` (et ses binaires par plateforme), outil de build de Vite, non livré dans la page ; aucune modification de ses fichiers. L'accord explicite que `ARCHITECTURE` §13 demande pour une dépendance MPL-2.0 vise `@axe-core/playwright` (J5, facultatif) ; ici, `lightningcss` arrive de façon transitive avec Vite : à signaler à l'utilisateur.

## Pas d'actifs tiers
Aucune police, image, son ni texture tiers : le papier est calculé par le code (`src/render/paper.ts`) ; la police de l'interface est la pile système (Georgia, Times New Roman).
