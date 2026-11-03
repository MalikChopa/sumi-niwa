# Architecture : Jardin d'encre

Date : 2026-11-01 · Version 2, corrigée après l'audit 1 (`docs/ARCHITECTURE_SPEC_AUDIT_1.md`) · Statut : à ré-auditer
Entrées : `CLAUDE.md`, `docs/FICHE.md`, recherches 01 et 02, cahier des charges, maquette A. Les valeurs sont dans `docs/SPEC.md` ; ici, l'organisation et les raisons.
Légende : **délégué** = choix de la conception (modifiable sans toi) ; **objectif à mesurer** = cible, jamais un fait ; **non vérifié** = ni source ni mesure.

## Résumé en mots simples
- Le **CPU** (TypeScript) dessine le « plan » de chaque plante à partir d'une graine : traits et petites marques (feuilles, fleurs). Il n'utilise que des opérations au résultat identique partout : même graine, même plante sur tout moteur JavaScript conforme (par construction ; vérifié seulement sur V8, 12.2).
- La **carte graphique** (GPU) ne fait qu'afficher : elle révèle les traits au fil du temps, fait bouger les tiges au vent, diffuse l'encre humide dans le papier et anime les 200 000 particules (surtout une brume fine d'encre, plus quelques milliers de pétales, feuilles ou flocons visibles).
- Sans WebGPU, le **même code** tourne sur WebGL2 (que Three.js sait utiliser seul) : mêmes plantes et liens, sans diffusion, avec peu de particules. Sans aucun des deux, la page reste couleur papier et explique quoi faire.

## 1. Décision
**Génération déterministe des plantes sur CPU + rendu Three.js (WebGPU) en couches : traits en rubans révélés par le temps, encre humide diffusée sur une grille 2D « sensible au papier » par compute shader, particules en compute TSL ; le repli réutilise le même code avec le backend WebGL2 de Three, fonctions GPU avancées coupées.**

Trois raisons :
1. **Le lien rouvre le même jardin par construction.** La géométrie ne dépend que d'entiers (graine, position, espèce, rang) et d'opérations IEEE 754 exactes (`+ − × ÷`, `Math.sqrt`) ; le GPU, dont les flottants varient (recherche 02, point 7), ne touche jamais à la forme des plantes.
2. **Un seul chemin de code pour les trois niveaux.** Seules trois briques (diffusion, grand nombre de particules, mesure GPU) diffèrent entre `complet` et `reduit`.
3. **Coût borné et réglable sans perte d'état.** 5 à 6 passes GPU par image (§4), dimensionnées par un palier ; le premier levier (particules actives) ne détruit rien.

Prix à payer :
- Mathématiques maison (`dmath`) : tout `Math` hors liste blanche est interdit dans `src/core`, garanti par un test de garde (12.1).
- Les tiges ondulent : toutes les plantes sont redessinées à chaque image, donc 160 plantes au plus.
- Repli WebGL2 : compute émulé (transform feedback) minimal, comportement avec nos particules **non vérifié** (sonde en tête du J3, plan B CPU).
- API Three mouvante : `three` et `@types/three` épinglés en 0.187.x exacte.
- Taches des pétales non reproductibles (accepté par toi).

## 2. Options écartées
### 2.1 Croissance des plantes
|Critère|**A. CPU, TS, maths exactes (retenu)**|B. GPU, L-système en compute|C. CPU en Web Worker|
|---|---|---|---|
|Géométrie identique partout|oui (test de hash)|non garanti (réassociation, `sin` à 2⁻¹¹ près)|oui|
|Délai avant le 1er trait (F-2)|synchrone, objectif ≤ 16 ms par plante|1 dispatch + relecture ou double code|+ messages (≈ 1 image, non mesuré)|
|Code partagé avec le repli, testable sous Node|oui|non|oui|

B écarté (déterminisme). C en réserve si la mesure J2 dépasse 16 ms par plante.

### 2.2 Diffusion de l'encre
|Critère|**A. Grille 2D papier, ping-pong compute (retenu)**|B. Lattice-Boltzmann|C. Faux effet : flou + seuil|
|---|---|---|---|
|Passes par image|1 (2 au palier élevé)|6 par pas|1|
|Mémoire (grille 960 × 540)|2 × 4,1 Mo + entrée 4,1 Mo = 12,4 Mo|≈ 4 × plus|≈ 4 Mo|
|Bords sombres, fibres, séchage|oui|oui, plus fidèle|non|
|Tourne dans le repli WebGL2|non|non|oui|

A donne l'effet sumi-e pour une fraction du coût de B. C sert d'**habillage du repli** : en `reduit`, le bord humide est figé dans le shader du trait. Si `StorageTexture` `rgba16float` pose problème dans Three 0.187 (non vérifié) : même équation en passe de fragment (plan B).

### 2.3 Version réduite
|Critère|**A. Repli automatique de Three (WebGL2) (retenu)**|B. Moteur léger séparé|C. Message seul|
|---|---|---|---|
|Code de rendu dupliqué|aucun (TSL compilé en GLSL)|traits, marques, papier réécrits|aucun|
|Poids ajouté|0 (backend WebGL déjà dans `three/webgpu` ; effet sur le build à mesurer au J1)|+ moteur 2|0|
|Le lien partagé fonctionne|oui|oui si le rendu suit|non|

Ce que tu vois :
- **complet** (WebGPU matériel) : tout, 200 000 particules au palier élevé.
- **reduit** (WebGL2, ou WebGPU logiciel : `adapter.info.isFallbackAdapter`) : mêmes plantes, croissance, vent, saisons, PNG et lien ; bord humide figé ; particules réduites (départ 5 000, à mesurer) ; message discret de 8 s : « Version réduite : ton navigateur n'active pas WebGPU ».
- **refus** (ni WebGPU ni WebGL2, ou deux échecs d'initialisation) : papier uni (CSS), message FR et EN, liste datée des navigateurs où WebGPU est livré, bouton « Réessayer ». Sans JavaScript, le même message vient de `<noscript>`.

**Note `isFallbackAdapter`.** La propriété se lit sur `adapter.info`. Vérifié le 2026-11-01 (Diapason, navigateur intégré de Claude ; audit, Edge et Chrome 156 headless) : `adapter.isFallbackAdapter` vaut `undefined`, `adapter.info.isFallbackAdapter` vaut `false`. L'ancienne forme ne verrait jamais un adaptateur logiciel. La recherche 01 cite l'ancienne forme (non modifiée). Vérifié sur des Chromium de classe 156 seulement.

## 3. Modules (délégué)
- Racine : `index.html` (fond washi CSS, `<noscript>`, secours à 6 s), `bench.html` (J3), `determinism.html` (J2), `THIRD_PARTY.md` (J1).
- `src/core/` : TypeScript pur sans DOM ni GPU, testé sous Node (`prng`, `dmath`, `hash`, état, `url-codec`, `plant-gen` + espèces, `seasons`, `quality`, `sim-clock`).
- `src/boot/`, `render/` (dont `renderSheet()`), `input/`, `ui/`, `audio/`, `app/` ; `tests/` (`unit`, `e2e`, `golden`) ; `scripts/` (`probe-webgpu.mjs`, `size-report.mjs`, `bench.mjs`).

`src/core` n'importe rien de `render`, `ui`, `audio` ; le test de garde (12.1) contrôle ses fonctions `Math`.

## 4. Flux de données par image
1. **Entrées** : commandes (`planter`, `saison`, `pause`, `impulsionVent`…) dans une file.
2. **Horloge** : `simClock.avancer(dtRéel)`, pas borné à 50 ms ; en pause, le temps simulé s'arrête, le temps réel continue (interface, saisons).
3. **État** : le réducteur applique les commandes. Une plantation lance `plant-gen` (CPU), ajoute sommets et marques dans des tampons GPU pré-alloués, met l'URL à jour (`replaceState`, 2 fois/s au plus).
4. **Qualité** : le contrôleur lit les temps d'image (et GPU) et choisit le palier.
5. **GPU** (5 étapes, 5 à 6 passes) : (1) particules, vent analytique lu dans des uniformes ; (2) injection des traits nés et des porteurs posés dans `wetInput`, taches dans `stainLayer` ; (3) diffusion + séchage, 1 ou 2 sous-pas (absent en `reduit`) ; (4) rendu principal : papier + encre + taches, traits (balancement dans le vertex shader), marques, particules ; (5) finition : grain, vignette, respiration.
6. **Audio** : vent et gouttes estimés côté CPU (aucune relecture GPU). **Interface** : apparition des icônes (3 s), messages.

Coordonnées en **unités feuille** (uf) : feuille fixe de 1600 × 900 uf (maquette), montrée en « cover » (rogne si le format diffère : délégué) ; le PNG montre toute la feuille. Grille, papier et taches vivent en espace feuille : redimensionner ne les détruit pas.

## 5. Modèle d'état et URL
- `GardenState = { version: 1, graine: u32, saison: 0..3, plantes: [{ x, y, espece }] }` (entiers en uf). Le reste est dérivé ou libre.
- Graine de plante = `splitmix32` de (graine du jardin, rang, x, y, espèce) → 4 mots pour `sfc32`. Le rang compte : l'ordre de plantation fait partie du jardin.
- URL : fragment `#g=1.<graine hex>.<saison>.<plantes base64url>`, 3 octets par plante, jamais envoyé au serveur (format : SPEC).
- À l'ouverture d'un lien, les plantes repoussent dans l'ordre, en accéléré (d'un coup avec « réduire les animations »).
- « Nouvelle feuille » fait `history.pushState` : Précédent rend l'ancien jardin (F-10).

## 6. Paliers de qualité et contrôleur
Quatre paliers en `complet` (Élevé, Moyen, Bas, Minimal), un profil fixe en `reduit` (table : SPEC). Leviers dans l'ordre (recherche 02) : particules actives (sans perte), sous-pas de diffusion, taille de grille (rééchantillonnée), échelle de rendu.
Contrôleur (fonction pure de `quality.ts`, testée sur séries synthétiques) : fenêtres de 250 ms, décision sur 10 fenêtres ; baisse si 8 sont lentes. **Hausse** : le palier supérieur coûte bien plus du double (particules × 2, texels de grille × 4, sous-pas × 2) ; on monte seulement si `temps GPU mesuré × rapport de coût (palier → suivant)` ≤ ~11 ms (rapports mesurés au J3 par `bench`), ou, sans mesure GPU, par essai annulable. Test : « un Moyen à 8,3 ms ne monte pas ». 3 allers-retours au plus, puis palier figé ; 3 s de délai après tout changement, redimensionnement ou retour d'onglet. Départ au Moyen, sonde de 2 s après le papier. Réglage manuel : touche Q seulement (préférence `qualite`), qui coupe le contrôleur ; `?quality=T3` (documenté) force un palier pour les démonstrations, sinon une capture montrerait 100 000 particules.
Limite honnête : sous synchronisation verticale à 60 Hz, le temps d'image montre une dégradation mais pas la marge, connue seulement par `timestamp-query` (Chrome confirmé ; Safari, Firefox non vérifiés).

## 7. Perte du device GPU
`renderer.onDeviceLost` est remplacé (Three r187 journalise sans rien recréer ; effet de `_isDeviceLost` sur le rendu non vérifié). Si la raison n'est pas `destroyed` : voile « Le jardin se repose… », destruction du renderer, attente 1 s, recréation depuis `GardenState` (grille réinjectée, taches perdues). 3 tentatives en 60 s au plus ; puis `reduit` (`forceWebGL`) ; si cela échoue, `refus` avec « Recharger ». Test : `simulateDeviceLoss()` détruit vraiment le device en le marquant récupérable (une vraie perte de pilote n'est pas testable).

## 8. Entrées
- **Souris** : clic court = planter l'espèce courante ; maintien = jauge, la durée choisit l'espèce, relâcher plante et mémorise ; déplacement sans bouton = vent ; molette = saison. Une graine d'encre apparaît dès l'appui.
- **Tactile** (bonus) : toucher = planter, appui long = jauge, glisser (> 12 px) = vent ; non testé automatiquement, essai manuel par toi.
- **Clavier** : raccourcis actifs seulement si le focus est sur la feuille ou la barre (WCAG 2.1.4). **Espace et Entrée** agissent sur la feuille seulement si elle a le focus ; sur un bouton de la barre, ils le déclenchent (natif). Liste : SPEC.
- **Mode contemplatif** (décision utilisateur) : touche C, et automatiquement après 90 s sans interaction en plein écran ; pas de bouton de plus.

## 9. Audio (F-9)
Web Audio, aucun fichier ; contexte créé au premier clic sur « Son » (coupé par défaut). Vent filtré, gouttes, notes pentatoniques à chaque plantation, réverbération calculée, limiteur, volume réglable ; suspendu quand l'onglet est caché.

## 10. Accessibilité
« Réduire les animations » (`prefers-reduced-motion`, écouté aussi en cours de session par son événement `change`) : vent, balancement et particules atténués, respiration coupée, repousse instantanée. Le grain du papier est statique. Clavier complet (barre atteignable au Tab) avec focus visible (contour 2 px sumi, SPEC §7.2). Contraste : icônes ≈ 6,9:1 sur washi uni ; texte d'accueil de la maquette (0,55, ≈ 3,4:1) porté à 0,72 (≈ 5,7:1), écart justifié par la fiche (délégué). Libellé de feuille mis à jour et zone `aria-live` discrète. Aucun clignotement : variations lentes (respiration ≤ 1,5 %, période 9 s).

## 11. Export PNG, et où brancher la vidéo (phase 2)
`renderSheet(largeur, hauteur)` rend la feuille entière dans une cible hors écran (1600 × 900 uf), relit les pixels (`readRenderTargetPixelsAsync`), écrit un canvas 2D, ajoute le sceau (SVG maison) et produit le PNG ; l'interface (DOM) n'y figure jamais. Défaut 3840 × 2160, réduit à `maxTextureDimension2D`. Plan B : `canvas.toBlob`.
**Vidéo (phase 2, rien à construire)** : elle se branchera sur `simClock` en « pas fixe » (1/30 s par image) et `renderSheet()` ; reste un `VideoExporter` (WebCodecs, dépendance à approuver, ou `captureStream`, non vérifié sur canvas WebGPU).

## 12. Stratégie de test
Un agent lance tout sauf la performance réelle et le ressenti, qui sont à toi. Serveurs de test sur un port libre ≥ 4180 (`--strictPort`), arrêtés à la fin. Hors de portée d'un agent : audio écouté, vraie perte de pilote, tactile ; plein écran et presse-papiers demandent des autorisations Playwright.

**12.1 Unitaires (Vitest, Node, sans GPU)**
- Déterminisme : `hashPlante()` égale `tests/golden/plants.json` sur une liste fixe (graine, rang, x, y, espèce) ; deux graines, deux hash (F-3).
- **Garde en liste blanche** : dans `src/core`, tout `Math` qui n'est pas de la forme `Math.<nom de la liste blanche SPEC §4.1>(` est une erreur, de même que `**`, `**=`, `Math[`, `= Math`, `} = Math`, `globalThis.Math`. Le test est testé sur des exemples fautifs (`Math.asin`, `x ** 2`, alias).
- Bornes de tampons : sur 10 000 graines × 5 espèces, maxima de marques, traits et sommets ≤ bornes SPEC §2.2 (troncature déterministe : SPEC) ; au-delà de 90 % d'une borne, elle est relevée au J2.
- `dmath` : écart avec `Math.sin` < 1e-9 sur 10 000 angles. URL : aller-retour sur 1 000 jardins, liens abîmés refusés. Contrôleur, jauge, saisons, i18n (mêmes clés FR et EN), stockage bloqué.

**12.2 Déterminisme entre moteurs** : `determinism.html` calcule les hash dans le navigateur ; Playwright l'ouvre dans Edge et Chrome **installés** (`channel: 'msedge'`, `'chrome'`, aucun téléchargement ; non vérifié). Node, Chrome et Edge utilisent tous V8 : l'égalité ne dit rien de SpiderMonkey ni de JavaScriptCore. Firefox : test manuel par toi ; Safari : non vérifié.

**12.3 Captures en navigateur sans fenêtre (headless)**
- Playwright + Edge/Chrome installés, headless « new ».
- Première tâche du J1 : `scripts/probe-webgpu.mjs` imprime, pour Edge et Chrome, headless puis fenêtré, `requestAdapter()` (nul ou non), `adapter.info` dont `adapter.info.isFallbackAdapter`, et `adapter.isFallbackAdapter` (pour constater l'écart). Précédents : ton GPU relevé le 2026-11-01 dans le navigateur intégré de Claude (AMD RDNA 3, `timestamp-query` disponible ; pas une mesure de performance) ; l'audit a obtenu un adaptateur matériel en headless sur Edge et Chrome 156. À confirmer par la sonde (le guide Chrome sur le headless vise Linux, [source](https://developer.chrome.com/blog/supercharge-web-ai-testing)).
- Si l'adaptateur est nul en headless : captures WebGPU en mode fenêtré ; sinon par toi, et l'agent ne teste que `reduit` et `refus`.
- **Règle fluidité** : les temps d'image d'un agent en headless sont **indicatifs** (ni cadence réelle ni synchronisation verticale) ; seule ta mesure fenêtrée est **décisive**. Tout rapport A de fluidité dit le cas (adaptateur matériel, logiciel, nul) et le mode (headless, fenêtré).
- `?test=1` : affiche en haut à gauche `paper-visible` et `first-stroke` ; graine fixe, brise et particules coupées, vent du pointeur gardé, temps avancé par `__jardin.step(n)`, capture. Comparaison tolérante (pixels différant de plus de 8/255 < 2 %), références propres à la machine.
- « Aucun écran blanc » (`complet`, `reduit`, `refus`, JavaScript désactivé) : capture à 3 s, moins de 1 % de pixels blancs purs, couleur moyenne proche du washi.
- **Repli `reduit`** : forcé par `?force=reduit` (README du J1 et SPEC §8) ; chez toi, par l'option d'Edge « Utiliser l'accélération graphique » désactivée. Revérifié aux J2 à J5 (§13).

**12.4 Mesure de performance (par toi)** : `npm run bench` construit, lance l'aperçu sur le port 4180 et ouvre `bench.html` dans Edge. Scénario fixe (40 plantes, automne, vent scripté), chaque palier forcé (5 s de chauffe, 15 s de mesure) ; affiche images/s médianes, 1 % le plus lent, p95, temps GPU (si `timestamp-query`), adaptateur, résolution ; bouton « copier en JSON » (rien envoyé). Tu notes l'utilisation GPU du Gestionnaire des tâches. 1080p plein écran, onglets fermés, portable branché, deux passages.

**12.5 Endurance et accessibilité** : 12 min de mode contemplatif sous Playwright (40 plantes atteintes entre 5 min 20 et 9 min 20), tas JavaScript (DevTools, Chromium) et `renderer.info.memory` ; indicatif en headless ; liste de contrôle accessibilité au J5.

## 13. Jalons
Après chaque jalon : point d'étape « Continuer / Ajuster / Arrêter », un commit local par étape vérifiée. Tailles en lignes de TypeScript : estimations **non mesurées**. **A** = agent, **D** = Diapason, **U** = toi ; « indicatif » = headless (12.3).

**Critère 1 de la fiche** (« papier visible, première plante en moins de 3 s ») : défini une seule fois, dans la SPEC (`PAPER_VISIBLE_MS`, `FIRST_PLANT_MS`, scénario C-1) : de `navigationStart` au premier pixel de trait, plantation automatique, mesure locale, réseau au J6. Il se joue au J1 (papier) puis au J2 (plante).

|Jalon|F|Critères mesurables (comment, qui)|npm à approuver|Taille|
|---|---|---|---|---|
|**J1** Squelette minimal|F-1, F-12|Build sans erreur (A, D) ; `paper-visible` ≤ 3 000 ms via `?test=1` (U décisif, A indicatif) ; papier net en 1080p et 1440p (captures, U juge) ; `complet`, `reduit` (papier seul, `?force=reduit`), `refus`, sans JavaScript : aucun écran blanc (A, D) ; sonde WebGPU rapportée (A) ; poids du build, décompressé et gzip, objectif < 2 Mo décompressé (A, D) ; `THIRD_PARTY.md` (A)|`three` 0.187.x, `@types/three`, `typescript`, `vite`, `@playwright/test` (versions exactes épinglées)|S, ≈ 500–800 lignes|
|**J2** Boucle jouable|F-2, F-3, critère 1|Hash Node = Chrome = Edge (A, D) ; garde `Math` et bornes de tampons (A) ; graine ≤ 1 image après l'appui, 1er trait ≤ 200 ms après le relâchement, p95 sur 20 clics (A indicatif) et 10 clics chez toi (U décisif) ; `first-stroke` ≤ 3 000 ms (A indicatif, U décisif) ; 5 espèces reconnaissables (U) ; pendant la croissance 95 % des images ≤ 33 ms (A indicatif, U décisif) ; **`reduit` (A, D)** : sous `?force=reduit`, une plante de chaque espèce pousse (pixels de trait présents), hash identique à `complet` ; **porte (U)** : tu joues 5 min, plantes au moins 10 plantes couvrant les 5 espèces, et réponds « oui » à « le geste est agréable » et « les traits font pinceau » ; « non » à l'une : point d'étape Ajuster, 1 jalon d'itération au plus, puis Continuer/Arrêter|`vitest`|L, ≈ 2 000–2 800 lignes|
|**J3** Encre, vent, particules|F-4, F-5, F-6|**En tête** : sonde particules 50 000/100 000/200 000 en boucle simple (U), qui lève tôt le risque du critère 3 ; diffusion : densité moyenne dans un anneau autour du trait, relecture de grille en mode test (A), U juge ; vent ≤ 100 ms (instrumentation, A) ; `bench` : images/s et ms par passe par palier, rapports de coût entre paliers, cible 200 000 à 60 images/s (U ; palier tenu noté, pas maquillé) ; contrôleur : descend sous charge simulée, ≤ 3 allers-retours, « Moyen à 8,3 ms ne monte pas » (A) ; perte de device simulée récupérée (A) ; **`reduit` (A, D, regard de U)** : le vent déplace la pointe des herbes de plus de 2 uf, particules minimales (5 000, sinon plan B CPU de 1 000 porteurs)|aucune|L, ≈ 1 500–2 200 lignes|
|**J4** Saisons, partage, effacer|F-7, F-8, F-10|Saison ≤ 4 000 ms, sans image > 50 ms (journal, A indicatif) ; lien rouvert dans un contexte neuf : même `gardenHash()` (hash des tampons générés, A) ; PNG 3840 × 2160 sans pixel d'interface (A), présentable (U) ; confirmation dès 5 plantes, Précédent rend l'ancien jardin (A) ; **`reduit` (A, D)** : saison, lien rouvert (même `gardenHash()`) et PNG sous `?force=reduit`|aucune|M, ≈ 900–1 300 lignes|
|**J5** Son, contemplatif, finitions|F-9, F-11|Son coupé au chargement, aucun `AudioContext` avant action (A) ; volume réglable (A, U) ; 12 min de mode contemplatif, entrée par C et par 90 s d'inactivité en plein écran (horloge simulée, A) : tas JS final ≤ tas à 2 min + 10 Mo, compteurs GPU constants, aucune image > 100 ms après 2 min (A indicatif) ; liste d'accessibilité (A, D, U) ; poids final ; **contrôle final des 3 niveaux (A, D, puis U)** : `complet`, `reduit` (son, contemplatif, clavier, mouvement réduit refaits), `refus`, U avec le réglage d'Edge|`@axe-core/playwright` (facultatif, MPL-2.0 : accord explicite)|M, ≈ 900–1 300 lignes|
|**J6**|—|Audit indépendant ; mise en ligne **seulement sur ta demande** (HTTPS obligatoire) ; crochets de test (`?test=1`, `__jardin`, `bench.html`, `determinism.html`) retirés ou inertes en ligne ; `first-stroke` mesuré par le réseau (U)|—|—|

Le J2 se juge sans diffusion animée (bord humide figé) ; le J3 ajoute la diffusion.

## 14. Risques
|Risque|Effet|Réponse|
|---|---|---|
|Rendu « pinceau » peu convaincant|Le cœur déçoit|Porte du J2 ; traits plus graphiques (cahier)|
|200 000 particules hors de portée de ton GPU|Critère 3 non tenu|Paliers ; chiffres honnêtes ; sonde en tête du J3|
|API Three mouvante ; `StorageTexture` rgba16float non vérifié|Diffusion bloquée|Version épinglée ; plan B en passes de fragment|
|Particules du repli non vérifiées|Repli sans pétales|Plan B : 1 000 porteurs sur CPU|
|Compilation lente des shaders ; diffusion trop uniforme|Critère des 3 s ; look « flou »|Papier d'abord, `compileAsync` ; `INK_WIND_DRIFT` au J3|
|Safari non testable (pas de Mac)|Compatibilité non vérifiée|« non vérifié » tant que personne ne l'a ouvert|
|Repli `reduit` cassé par un ajout tardif|Critère 5 tenu sur un papier vide seulement|Non-régression aux J2 à J5 (§13)|

## 15. Points ouverts
Non vérifiés : `timestamp-query` hors Chrome ; taille réelle du build (J1) ; `captureStream` sur canvas WebGPU (phase 2) ; Firefox Windows avec Three 0.187 ; déterminisme sous SpiderMonkey et JavaScriptCore ; contraste de « FR · EN » sur la barre posée sur de l'encre ; Playwright `channel` sans téléchargement ; cadence réelle en headless.

## 16. Décisions de l'utilisateur
Prises le 2026-11-01 (reportées dans `CLAUDE.md`) :
1. **Mode contemplatif** : touche C, et automatiquement après 90 s sans interaction en plein écran ; pas de nouveau bouton.
2. **Qualité manuelle** : touche Q seulement, pas de nouvelle icône.
3. **Poids « < 2 Mo »** : compté décompressé.
4. **200 000 particules** : surtout une brume fine d'encre portée par le vent, plus quelques milliers de pétales, feuilles ou flocons visibles. La SPEC (§3, F-6) l'appliquait déjà : rien à changer.

## Journal des corrections
Compte `wc -w` : 3816, soit 316 de plus que la limite 3 500 : les ajouts exigés par l audit (repli à chaque jalon, règle de fluidité, garde, décisions) pèsent plus que les redites retirées.
|Point|Où|Changement|
|---|---|---|
|1|tout|Texte resserré, tableaux compacts ; compte réel ci-dessus|
|2|2.3, 12.3|`adapter.info.isFallbackAdapter`, note, la sonde imprime les deux formes|
|3, 22|13|Critère 1 défini dans la SPEC ; J1 (papier) puis J2 (plante) ; local, réseau au J6|
|4|12.3, 13, 14|`reduit` revérifié aux J2 à J5 ; J1 papier seul|
|5|6, 13|Hausse = GPU × rapport ≤ ~11 ms ; test « 8,3 ms ne monte pas »|
|6|12.3, 13|Headless « indicatif », fenêtré « décisif »|
|7|1, 12.1, 12.2|Garde en liste blanche ; V8 seulement|
|8|12.1|Maxima sur 10 000 graines × 5 espèces|
|9|8, 10|Focus visible ; Espace/Entrée|
|11|16|Section remplacée ; Q4 déjà appliquée|
|12|13, 14|Sonde particules en tête du J3 ; `vitest` au J2 ; `?test=1` remplace la page de mesure|
|13|1, 4|« 5 à 6 passes »|
|19–21, 23, 26–28|3, 13, 8, 10, 2.3, 12.5, 6|`THIRD_PARTY.md`, axe ; crochets retirés au J6 ; tactile manuel, grain statique, `change` ; « livré dans » ; 12 min ; `?quality=` ; mesure du J3|
|10, 14–18, 24, 25|SPEC|Journal de la SPEC (25 : porte du J2 ici aussi)|

## Note de mise à jour (2026-11-03, Diapason)
- Ligne J6, « crochets de test retirés ou inertes en ligne » : réalisé par l'interrupteur `__TEST_HOOKS__` (mode de Vite). `npm run build` = production sans crochets ni `bench.html` / `determinism.html` ; `npm run build:test` = construction de test dans `node_modules/.jardin-test` (e2e, bench, sonde) ; `scripts/scan-dist.mjs` fait échouer le build si un crochet réapparaît.
