# Spécification : Jardin d'encre

Date : 2026-11-01 · Version 2, corrigée après l'audit 1 (`docs/ARCHITECTURE_SPEC_AUDIT_1.md`) · Statut : à ré-auditer · Compagnon de `docs/ARCHITECTURE.md` (les raisons y sont ; ici, les valeurs).

**Statut de chaque nombre** (colonne « St. ») :
- **D** = décidé (contrat : ne change qu'avec une nouvelle version ; « D-u » = décidé par toi, « D-c » = repris du cahier ou de la maquette validée, « D-d » = délégué à la conception) ;
- **VD** = valeur de départ, à régler à l'œil ou à la mesure sans changer l'architecture ;
- **OM** = objectif à mesurer, jamais un fait tant qu'il n'est pas mesuré ;
- **NV** = non vérifié.
Unité de longueur : **uf** (unité feuille) ; feuille de 1600 × 900 uf. Temps « simulé » = horloge du jardin (s'arrête en pause). Qui vérifie : **A** agent, **D** Diapason, **U** toi ; « indicatif » = mesure en navigateur sans fenêtre, non décisive (ARCHITECTURE 12.3).

## 1. Constantes générales
|Identifiant|Valeur|St.|Note|
|---|---|---|---|
|`SHEET_W`, `SHEET_H`|1600, 900 uf|D-c|repère de la maquette|
|`VIEW_FIT`|`cover`|D-d|comme `preserveAspectRatio="slice"`|
|`COL_WASHI`, `COL_SUMI`|`#F3ECDD`, `#1E2430`|D-u||
|`COL_SAKURA`, `COL_ETE`, `COL_ERABLE`, `COL_HIVER`|`#E8A5B5`, `#8FB87A`, `#B8402F`, `#AEB8C4`|D-u||
|`COL_ERABLE_VAR`|`#9C3426`, `#CC5A3A`|D-c|variantes de la maquette (écran 3)|
|`COL_HERBE_SOMBRE`|`#4D5A45` (été), `#5A4636` (automne)|D-c|maquette|
|`VIGNETTE`|couleur `#6B5A3A`, début 62 % du rayon, opacité max 0,22|D-c|maquette|
|`MAX_PLANTS`|160|D-d|borne le coût de rendu (tout est redessiné à chaque image) ; rouvrir 160 plantes dure ≈ 24 s (160 × 150 ms)|
|`PLANT_RESPONSE_MS`|≤ 200 ms du relâchement au 1er trait dessiné|OM|cahier F-2|
|`WIND_RESPONSE_MS`|≤ 100 ms de l'événement à l'image qui l'applique|OM|cahier F-5|
|`SEASON_TRANSITION_MS`|3 600 ms|D-d|critère cahier : < 4 000 ms|
|`UI_HIDE_AFTER_MS`|3 000 ms d'immobilité|D-c|cahier, parcours 3|
|`CONTEMPLATIVE_IDLE_S`|90 s sans interaction (souris, clavier, toucher), en plein écran : entrée automatique en mode contemplatif|D-u||
|`NEW_SHEET_FADE_MS`|1 200 ms|VD||
|`CONFIRM_MIN_PLANTS`|5|D-d|« jardin riche » (F-10)|
|`REPLAY_STAGGER_MS`, `REPLAY_SPEED`|150 ms entre plantes, croissance × 3|VD|ouverture d'un lien|
|`URL_WRITE_MIN_MS`|500 ms entre deux `replaceState`|D-d||
|`SIM_DT_MAX_MS`|50 ms|D-d|pas simulé maximal|
|`TOAST_MS`, `REDUCED_NOTICE_MS`|4 000 ms, 8 000 ms|VD||
|`RESCUE_DELAY_S`|6 s|D-d|message de secours HTML si rien n'est affiché|
|`GROUND_Y_MIN`, `GROUND_Y_MAX`|790, 875 uf|D-c|bande où se posent pétales et feuilles|
|`PAPER_VISIBLE_MS`|≤ 3 000 ms de `navigationStart` à la marque `paper-visible`|OM|critère 1 de la fiche, première moitié|
|`FIRST_PLANT_MS`|≤ 3 000 ms de `navigationStart` (même instant que `PAPER_VISIBLE_MS`) au premier pixel de trait visible : marque `first-stroke`, posée à l'image suivant le premier dessin de trait non vide (erreur ≈ 1 image, non mesurée), plantation déclenchée dès `paper-visible` par `?test=1&autoplant=1`, donc sans temps humain ; mesure locale, réseau au J6|OM|critère 1 de la fiche, seconde moitié ; scénario C-1|
|`PAGE_WEIGHT`|< 2 Mo décompressé, hors textures optionnelles (gzip relevé à titre d'information)|OM, D-u|`size-report`|

## 2. Ressources GPU
### 2.1 Textures et cibles
|Identifiant|Taille|Format|Canaux|Chemin|St.|
|---|---|---|---|---|---|
|`TEX_PAPER`|2048 × 1152 (`complet`), 1024 × 576 (`reduit`)|`rgba8unorm`|R hauteur, G densité de fibres, B capacité d'absorption, A moutonnement|les deux|VD|
|`TEX_INK_A`, `TEX_INK_B`|selon palier (§3)|`rgba16float`, stockage écriture seule|R eau, G pigment mobile, B pigment déposé, A réservé (0)|`complet`|VD|
|`RT_WET_INPUT`|= grille|`rgba16float`|R eau, G pigment ; vidée à chaque image|`complet`|VD|
|`RT_STAIN`|1600 × 900|`rgba8unorm`, prémultipliée|taches des porteurs posés|les deux|VD|
|`RT_EXPORT`|3840 × 2160 (ou moins, §8)|`rgba8unorm`|temporaire|les deux|D-d|

Mémoire calculée : papier 9,4 Mo (2,4 Mo en réduit) ; grille 960 × 540 : 4,1 Mo par texture ; 1920 × 1080 : 16,6 Mo ; taches 5,8 Mo ; export 33,2 Mo (libéré après usage).
Plan B (NV, J3) : si `StorageTexture` `rgba16float` échoue dans Three 0.187, `TEX_INK_A/B` deviennent deux cibles de rendu et la diffusion une passe de fragment.

### 2.2 Structures
**Sommet de trait** (`STROKE_VERTEX`, 48 octets, 12 × float32, D-d) : `centre.xy` (uf), `offset.xy` (normale × demi-largeur), `base.xy` (pied de la plante), `u` (0 → 1 le long du trait), `naissance` (s, temps simulé absolu), `balancement` (0 → 1), `pression` (0 → 1, opacité), `bruit` (graine du trait), `dilution` (0 net, 1 lavis, 2 éclaboussure). Rubans en triangles indexés ; aplats (roche) en éventail dans le même tampon.

**Marque** (`MARK_INSTANCE`, 64 octets, 16 × float32, D-d) : `pos.xy`, `base.xy`, `angle`, `taille`, `forme`, `roleCouleur`, `naissance`, `balancement`, `echelleSaison` (vec4 : printemps, été, automne, hiver), `opacite`, `variante`.
- `forme` : 0 feuille, 1 fleur à 5 pétales, 2 bouton, 3 feuille d'érable (étoile à 5 pointes), 4 pétale de pivoine, 5 capuchon de neige, 6 point (mousse, éclaboussure), 7 cœur de fleur.
- `roleCouleur` : 0 sumi, 1 accent de la saison courante, 2 sakura, 3 vert été, 4 érable (variante), 5 hiver, 6 herbe sombre.
- Échelle affichée = `dot(echelleSaison, poidsSaison)` ; `poidsSaison` (vec4) est interpolé pendant la transition.

**Particule** (`PARTICLE`, 32 octets, D-d, recherche 02) : `A = vec4(x, y, vx, vy)` (uf, uf/s) ; `B = vec4(angle, taille, vie, code)` ; `code` = entier exact en flottant (< 2²⁴) : `type + 8 × etat + 64 × variante` ; `type` : 0 brume, 1 pétale, 2 feuille d'été, 3 feuille d'érable, 4 flocon ; `etat` : 0 en vol, 1 posé, 2 posé à cette image, 3 en sommeil. Deux tableaux : `P_MOTES` (brume) et `P_CARRIERS` (porteurs).

|Borne|Valeur|St.|
|---|---|---|
|`STROKES_MAX_PER_PLANT`|64|D-d|
|`STROKE_VERTS_MAX_PER_PLANT`|2 048|D-d|
|`MARKS_MAX_PER_PLANT`|512|D-d|
|Tampon des traits, pire cas|160 × 2 048 × 48 o = 15,7 Mo (calcul)|D-d|
|Tampon des marques, pire cas|160 × 96 × 64 o = 0,98 Mo (calcul)|D-d|
|Particules au palier Élevé|200 000 × 32 o = 6,4 Mo (calcul)|D-d|

**Débordement** (D-d). Un cerisier de profondeur 3 (40 branches, 3 candidats par branche de niveau ≥ 1, plus les pointes) peut, en queue de distribution, dépasser 96 marques. La génération est donc tronquée de façon déterministe : tout élément au-delà d'une borne, dans l'ordre de génération, est ignoré (un trait qui ferait dépasser les sommets l'est en entier) et le hash porte sur le résultat tronqué. Test : sur 10 000 graines × 5 espèces, maxima ≤ bornes ; au-delà de 90 % d'une borne, elle est relevée au J2 et les pires cas recalculés.

## 3. Paliers de qualité
|Palier|Id|Brume|Porteurs|Total|Grille d'encre|Diffusion|Échelle de rendu|St.|
|---|---|---|---|---|---|---|---|---|
|Élevé|`T3`|196 000|4 000|200 000|1920 × 1080|2 sous-pas / image|1,0 (ratio de pixels ≤ 2)|total D-u ; reste VD|
|Moyen|`T2`|98 000|2 000|100 000|960 × 540|1 / image|1,0 (ratio ≤ 1,5)|VD|
|Bas|`T1`|38 500|1 500|40 000|640 × 360|1 toutes les 2 images|0,85|VD|
|Minimal|`T0`|14 000|1 000|15 000|480 × 270|1 toutes les 3 images|0,75|VD|
|Réduit|`R`|4 000|1 000|5 000|aucune|aucune|1,0 (ratio ≤ 1,5)|VD, à mesurer|

Totaux T2 à T0 : propositions de la recherche 02. Répartition brume / porteurs : décision utilisateur (brume fine portée par le vent + quelques milliers de porteurs visibles). Le papier ne change pas en cours de session.

**Contrôleur adaptatif** (`quality.ts`)
|Identifiant|Valeur|St.|
|---|---|---|
|`QC_START_TIER`|`T2`|D-d|
|`QC_PROBE_S`|2 s après `paper-visible` ; temps moyen > 18,5 ms → `T1` ; sinon `T3` si `GPU(T2) × QC_TIER_RATIO ≤ QC_UP_GPU_MS` ; sinon `T2`|VD|
|`QC_WINDOW_MS`, `QC_WINDOWS`|250 ms, 10 fenêtres|D-c (modèle drei)|
|`QC_SLOW_FRAME_MS`|moyenne de fenêtre > 18,5 ms (≈ 54 images/s) = fenêtre lente|VD|
|`QC_DOWN_MIN_SLOW`|8 fenêtres lentes sur 10 → palier inférieur|D-d (≥ 75 %)|
|`QC_UP_GPU_MS`|monter de T à T+1 si, sur 40 fenêtres consécutives (10 s), au moins 36 vérifient `GPU(T) × QC_TIER_RATIO(T→T+1) ≤ 11 ms` (coût prévu du palier suivant)|VD|
|`QC_TIER_RATIO`|2,0 par défaut (minimum physique : particules × 2), remplacé au J3 par les rapports mesurés par `bench`|VD|
|`QC_TRIAL_AFTER_S`|sans mesure GPU : 20 s de fenêtres ≤ 17,2 ms → essai du palier supérieur, observé 5 s, annulé s'il ralentit|VD|
|`QC_COOLDOWN_S`|3 s sans décision après changement, redimensionnement, retour d'onglet, perte de device|D-d|
|`QC_MAX_FLIPFLOPS`|3, puis palier figé pour la session|D-c (modèle drei)|
|`QC_LOW_NOTICE`|en `T0`, temps moyen > 33,3 ms pendant 10 s → message unique « Ta machine peine »|D-d|

Test de synthèse : un `T2` mesuré à 8,3 ms GPU ne monte pas (8,3 × 2,0 = 16,6 > 11).
Préférence `qualite` = `auto` (défaut) ou un palier forcé ; forcé = contrôleur coupé. `?quality=T3|T2|T1|T0` (documenté) force un palier pour une démonstration, sans écrire le stockage.

## 4. Croissance des espèces
Codes d'espèce (contrat d'URL, D-u pour la liste, D-d pour les codes) : 0 bambou, 1 branche de cerisier, 2 herbes, 3 pivoine, 4 roche. Les valeurs de forme ci-dessous sont des **VD tirées de la maquette validée**, à régler au J2 avec toi.

### 4.1 Règles communes
- Le pied de la plante est le point planté (entiers en uf). Toute la géométrie vient de `sfc32` initialisé par `splitmix32(graine, rang, x, y, espèce)` et de `dmath` ; aucune fonction `Math` hors liste blanche (`+ − × ÷`, `sqrt`, `floor`, `ceil`, `round`, `trunc`, `abs`, `min`, `max`, `sign`, `fround`, `imul`, opérateurs de bits) ; `**` interdit ; le test de garde est en liste blanche (ARCHITECTURE 12.1).
- Puissance 1,5 = `t × sqrt(t)` ; angles par `dmath.sin/cos/atan2` (polynômes, réduction d'angle par `÷` et `round`).
- Naissance d'un point de trait : `t0 + longueurCumulée / vitesse` ; la pointe en croissance s'effile sur `TIP_LEN_S` = 0,25 s (VD).
- Largeur : `w(u) = w0 × (1 − effilement × u) × (0,88 + 0,12 × dmath.sin(πu))` ; bord irrégulier ± 12 % de w (bruit du trait) ; pinceau sec : fragment écarté si hauteur du papier > `1 − 0,35 × (1 − pression)` (VD).
- Dilutions (cahier) : net opacité 0,80–0,90 ; lavis 0,10–0,30 ; éclaboussure : points (forme 6) de 1,5–4 uf près du début d'un trait, probabilité 0,15.
- Lavis de sol : si `y ≥ 700`, un trait horizontal en lavis sous le pied, longueur 120–260 uf, largeur 3–10 uf, opacité 0,10.
- Hauteur bornée : une plante ne dépasse pas `y − 60` uf, minimum 120 uf pour le bambou.
- Balancement : `déplacement = vent(pied + hauteur) × balancement × gain`, plafonné à `SWAY_MAX` de l'espèce.

### 4.2 Par espèce
|Espèce|Géométrie (VD)|Marques par saison (VD)|Durée de croissance (VD)|`SWAY_MAX` (VD)|
|---|---|---|---|---|
|**Bambou** (0)|1 tige, + 1 seconde (p = 0,35, décalée de ± 30–60 uf, hauteur × 0,6–0,8) ; hauteur H 300–520 uf ; nœuds `n = max(4, round(H/92))` ; largeur 24 uf à la base, −45 % au sommet ; inclinaison −23 à +23 uf selon `((i+1)/n)^1,5` ; 1 trait de 9 points par segment + 1 trait de nœud (largeur 3,2) ; rameaux aux nœuds `0,45n ≤ i < n−1` (p = 0,85), longueur 70–130 uf|3–5 feuilles par rameau (longueur 95–140, largeur 10–15, éventail 0,42 rad), 5 au sommet ; 1 feuille sur 3 en accent (opacité 0,38), autres sumi (0,72) ; toutes saisons ; hiver : capuchons de neige sur les nœuds|0,55 s par segment, puis rameaux 0,6 s, feuilles 0,4 s|6 uf|
|**Cerisier** (1)|branche récursive : tronc 220–320 uf, largeur 30 uf, × 0,6 par niveau, 17 points ; courbure −0,4 à +0,4 rad ; profondeur max 3 ; enfants à 45 %, 70 % (côté ± 0,4–0,9 rad) et à la pointe (± 0,15 rad), longueur × 0,62–0,76 ; au niveau ≥ 2, enfant omis (p = 0,4) ; direction initiale vers (800, 300), bornée à [−160°, −20°], ± 0,3 rad|décor : 3 candidats par branche de niveau ≥ 1 (p = 0,55) + chaque pointe. Printemps : fleur (forme 1, sakura, 7–12 uf) + petite fleur (p = 0,25) ; été : feuille verte (10–14 uf) ; automne : feuille d'érable (forme 3, rouges, 12–21 uf) ; hiver : neige sur les pointes, branche nue|260 uf/s ; un enfant démarre quand le parent passe son point d'attache (≈ 4–7 s)|5 uf × (0,2 + 0,25 × niveau)|
|**Herbes** (2)|5–8 brins ; pied ± 23 uf ; hauteur h 70–110 uf, chaque brin h × 0,55–1,15 ; courbe quadratique (13 points) penchée de −1 à +1 ; largeur 6 → 0 uf ; opacité 0,62–0,82 ; p = 0,25 couleur herbe sombre|été : têtes de graines (forme 2) sur 2 brins (p = 0,5) ; hiver : neige sur les pointes (p = 0,5)|brins décalés de 0,12 s, 1,2 s chacun (≤ 2,2 s)|9 uf|
|**Pivoine** (3)|tige 40–70 uf, largeur 7 → 5 ; 2–4 feuilles (forme 0, 60–75 uf) à −1,9 et −1,2 rad ± 0,2|fleur : 3 couronnes, k = 0..2, 7−k pétales (forme 4), rayon R × (1 − 0,3k), R = 36–52 uf ; pétales sakura au printemps et en été, absents en automne et en hiver ; cœur (forme 7) sumi ; hiver : neige|tige 0,8 s, feuilles 0,5 s, couronnes 0,5 s chacune (≈ 2,8 s)|3 uf|
|**Roche** (4)|contour de 14 points, rx 50–130 uf, ry = rx × 0,38–0,50, rayon × 0,86–1,14, haut × 1,1, bas × 0,7 ; aplat en lavis (0,10) ; contour largeur 3,2 avec manques (motif 60/8/24/6/90/5 uf) ; ombre inférieure largeur 4 + 16 × `dmath.sin(πt)`, opacité 0,30|4 points de mousse (forme 6, sumi 0,45 ; vert en été) ; hiver : 3–5 capuchons sur le haut|contour 1,5 s, ombre 0,5 s, aplat 0,6 s|0|

## 5. Saisons
Ordre : printemps (0) → été (1) → automne (2) → hiver (3) → printemps. Nouvelle feuille : printemps (D-d). Transition : `poidsSaison` passe de l'état visuel courant à la cible en `SEASON_TRANSITION_MS` (courbe `smoothstep`), sur le temps réel (une demande pendant une transition repart de l'état courant). Couleurs interpolées en espace linéaire. Les porteurs changent de type seulement à leur réapparition (pas de saut visible).

|Saison|Accent|Porteurs|Source des porteurs|Part active|Brise (× `BREEZE`)|Chute (uf/s)|Brume|Taches|St.|
|---|---|---|---|---|---|---|---|---|---|
|Printemps|sakura|pétales (type 1, 5–9 uf)|fleurs de cerisier, sinon haut de la feuille|0,6|1,0|30|sumi, alpha 0,06|rose|VD|
|Été|vert|petites feuilles, aigrettes (type 2, 4–7 uf)|herbes, bambous, sinon haut|0,3|0,7|18|sumi, 0,05|vert pâle|VD|
|Automne|érable (+ 2 variantes)|feuilles d'érable (type 3, 8–16 uf)|marques d'automne, sinon haut|1,0|1,3|45|sumi, 0,06|rouge|VD|
|Hiver|gris bleuté|flocons (type 4, 2–5 uf)|haut de la feuille|1,0|0,5|22|hiver, 0,10|gris, faible|VD|

Accent, liste et ordre des saisons : D-u. Le scénario de mesure (`bench.html`) utilise l'automne : toutes les particules du palier sont actives.

## 6. Vent, particules, encre, papier
|Identifiant|Valeur|St.|
|---|---|---|
|`WIND_SAMPLES`|16 impulsions du curseur en anneau (uniformes)|D-d|
|`WIND_SAMPLE_MIN_MS`|33 ms entre deux impulsions|D-d|
|`WIND_RADIUS`|140 uf (gaussienne)|VD|
|`WIND_DECAY_S`|1,2 s|VD|
|`WIND_GAIN`, `WIND_MAX`|0,6 × vitesse du curseur, plafond 600 uf/s|VD|
|`BREEZE`|bruit « curl » d'échelle 400 uf, 0,05 Hz, 12 uf/s × facteur de saison|VD|
|`GUST`|rafale (touche V, bouton Vent) : impulsion qui traverse la feuille de gauche à droite en 2 s à la hauteur du pinceau clavier|D-d|
|`MOTE_SIZE`, `MOTE_ALPHA`|0,8–1,6 uf ; 0,04–0,10 ; étirée selon la vitesse (longueur + norme de v × 0,03 s)|VD|
|`MOTE_DRAG`|0,9 /s ; réapparition au vent si sortie de la feuille (marge 50 uf)|VD|
|`CARRIER_FLUTTER`|rotation ± 0,5–2 rad/s ; oscillation latérale 10 uf à 0,5–1,2 Hz|VD|
|`CARRIER_LAND`|hauteur de pose tirée dans [`GROUND_Y_MIN`, `GROUND_Y_MAX`] par hachage (indice, graine)|D-d|
|`CARRIER_REST_S`|2–6 s au sol, puis fondu 1 s et réapparition|VD|
|`STAIN_PROB`|0,02 par pose|VD|
|`STAIN_ALPHA`, `STAIN_RADIUS`|0,15 ; 2,6 × taille du porteur (halo de la maquette)|VD|
|`STAIN_FADE`|× 0,995 une fois par seconde (demi-vie ≈ 138 s, calcul)|VD|
|`INK_INJECT`|net : eau 1,0, pigment = pression ; lavis : eau 1,5, pigment 0,3 ; pose d'un porteur : eau 0,6, pigment 0,05|VD|
|`INK_DIFFUSE`|0,20 par sous-pas (4 voisins, pondéré par la capacité du papier ; ≤ 0,25 pour rester stable)|VD|
|`INK_EVAP`, `INK_EDGE_EVAP`|0,015 par sous-pas ; × 3 au bord de la zone mouillée|VD|
|`INK_PIGMENT_FLOW`, `INK_DEPOSIT`|0,35 ; 0,04|VD|
|`INK_GRANULATION`|0,5 (influence de la hauteur du papier sur le dépôt)|VD|
|`INK_WIND_DRIFT`|0 (activable si la diffusion paraît trop uniforme)|VD|
|`INK_ABSORB_K`|2,2 : couleur = mélange(papier, sumi, 1 − exp(−K × densité))|VD|
|`PAPER_FIBERS`, `PAPER_FBM_OCTAVES`|6 000 fibres courtes cuites ; 4 octaves|VD|
|`PAPER_GRAIN`|bruit par pixel d'écran, amplitude 0,04, **statique** (non animé, pas de scintillement)|VD|
|`PAPER_BREATH`|variation de luminance **crête à crête** 1,5 % de la moyenne, période 9 s|VD (plafond 2 % : D-d)|
|`REDUCED_MOTION`|vent × 0,3, balancement × 0,3, brume × 0,25, chute × 0,6, respiration 0, repousse instantanée|D-d|

## 7. Entrées
### 7.1 Souris et tactile
|Identifiant|Valeur|St.|
|---|---|---|
|`HOLD_START_MS`|300 : en dessous, clic = planter l'espèce courante|D-d|
|`HOLD_STEP_MS`|500 : [300, 800[ bambou, [800, 1 300[ cerisier, [1 300, 1 800[ herbes, [1 800, 2 300[ pivoine, [2 300, 2 800[ roche, puis le cycle reprend|D-d (ordre D-c)|
|`HOLD_CANCEL_PX`|12 px de déplacement pendant l'appui : pas de plantation, le geste devient du vent|D-d|
|Espèce courante au départ|bambou|D-d|
|Jauge|DOM, rayon 30 px, 5 points à 44 px, nom de l'espèce dessous (maquette)|D-c|
|Molette|cumul de `deltaY` ; seuil 100 → saison suivante (vers le bas) ou précédente|D-d|
|Graine d'encre|point de 8 uf dessiné à l'image suivant l'appui|D-c|
|Multi-touch|seul le premier pointeur compte|D-d|

Le tactile (bonus) n'est pas testé automatiquement : essai manuel par toi.

### 7.2 Clavier
Raccourcis actifs seulement quand le focus est sur la feuille ou la barre (WCAG 2.1.4). Les quatre premiers viennent du cahier (D-c), les autres sont D-d, sauf C et Q (D-u).
**Focus** : contour de 2 px `COL_SUMI`, décalé de 2 px (contraste calculé 13,2:1 sur le washi uni, ≥ 3:1 exigé), à la place du fond à 7 % de la maquette (≈ 1,14:1 : écart justifié). **Espace et Entrée** : actions de la feuille (pause, planter) seulement quand la feuille a le focus ; sur un bouton de la barre, ils déclenchent le bouton (comportement natif).
|Touche|Action|
|---|---|
|Espace|pause / reprise du temps simulé (feuille)|
|S / Maj+S|saison suivante / précédente|
|F|plein écran (bascule)|
|Échap|quitter le plein écran (natif), fermer une boîte de dialogue, quitter le mode contemplatif|
|Flèches (Maj)|déplacer le pinceau clavier de 20 uf (80 uf)|
|Entrée|planter au pinceau clavier (feuille)|
|1 à 5|choisir l'espèce (ordre du §4)|
|V|rafale de vent|
|M|son activé / coupé|
|+ / −|volume ± 10 points|
|P|garder ce jardin (PNG)|
|L|copier le lien|
|N|nouvelle feuille|
|Q|qualité : auto → Élevé → Moyen → Bas → Minimal (seul réglage manuel, pas d'icône) ; l'infobulle de la barre le dit|
|C|mode contemplatif (aussi automatique après `CONTEMPLATIVE_IDLE_S`)|
Les infobulles des boutons indiquent la touche (« Saison suivante (S) »).

### 7.3 Barre d'icônes (maquette A)
Ordre : Planter (fait tourner l'espèce courante, affiche son nom), Vent (rafale), 4 points de saison (clic = choisir), Son (curseur de volume au survol ou au focus), Garder ce jardin, Copier le lien, Nouvelle feuille, Plein écran, FR · EN. Position : bas, centrée, 26 px du bord ; fond washi opacité 0,55 (maquette), porté à 0,85 si le contraste mesuré sur l'encre est < 3:1. Fenêtre < 480 px : deux lignes, icônes 32 px.

## 8. URL, stockage, export
**Fragment d'URL** (D-d, contrat de partage) : `#g=<version>.<graine>.<saison>.<plantes>`
- `version` : `1` ; `graine` : 8 chiffres hexadécimaux minuscules (u32) ; `saison` : `0`–`3`.
- `plantes` : base64url (RFC 4648 §5, sans remplissage) de N enregistrements de 3 octets, gros-boutiste : `v = (x << 13) | (y << 3) | espece`, x sur 11 bits (0–1599), y sur 10 bits (0–899), espèce sur 3 bits (0–4). 4 caractères par plante ; 160 plantes = 640 caractères.
- Exemple : graine `9f3a12c4`, automne, un bambou en (800, 792) : v = 6 559 936 = `0x6418C0` → `#g=1.9f3a12c4.2.ZBjA`.
- Lecture : tout champ invalide (version inconnue, graine ≠ 8 hex, saison hors 0–3, longueur non multiple de 4, x > 1599, y > 899, espèce > 4, plus de 160 plantes) → le lien entier est refusé, nouvelle feuille, message « Lien illisible : nouvelle feuille » (version future : « Ce lien vient d'une version plus récente »). Jamais de jardin partiel.
- Écriture : `replaceState` après chaque plantation (au plus 1 fois par `URL_WRITE_MIN_MS`) ; `pushState` à « Nouvelle feuille » ; `popstate` recharge l'état.
- Paramètres de requête (jamais dans les liens partagés) : `?force=complet|reduit|refus` (documenté dans le README du J1), `?quality=` (§3), `?test=1` (affiche `paper-visible` et `first-stroke` ; crochets `window.__jardin` : `step(n)`, `plant(x, y, espece)`, `gardenHash()`, `setSeason(s)`, `simulateDeviceLoss()`, `metrics()`), `&autoplant=1` (un bambou en (800, 792) dès `paper-visible`). Retirés ou inertes en ligne (J6).
- `gardenHash()` = FNV-1a des tampons de traits et de marques générés pour toutes les plantes, dans l'ordre de plantation (comme `hashPlante`), et non de l'état : il prouve la même géométrie dans un contexte neuf.

**Stockage local** (D-c, cahier section 8) : `jardin-encre.v1.accueil` = `"1"` ; `jardin-encre.v1.prefs` = `{ "lang": "fr"|"en", "volume": 0–1, "qualite": "auto"|"T3"|"T2"|"T1"|"T0" }`. L'état « son activé » n'est jamais mémorisé. Aucun cookie.
Langue : préférence, sinon `navigator.language` commençant par `fr` → français, sinon anglais (D-d) ; `<html lang>` suit.

**Export PNG** (D-d) : `RT_EXPORT` 3840 × 2160 ; si `maxTextureDimension2D` < 3840, largeur = cette limite, hauteur = largeur × 9/16 (4096 → 4096 × 2304) ; nom `jardin-encre-<graine>-<saison>.png` (saison en toutes lettres dans la langue de l'interface) ; sceau rouge érable 44 uf en bas à droite (1500, 820), tracé SVG maison ; plan B : `canvas.toBlob` à la taille de l'écran. Durée ≤ 3 s (OM).

## 9. Audio
|Identifiant|Valeur|St.|
|---|---|---|
|`AUDIO_DEFAULT`|coupé ; aucun `AudioContext` avant le premier clic sur Son|D-c|
|`VOLUME_DEFAULT`|0,4 (curseur 0–100 %, pas de 10) ; rampe de 50 ms|VD|
|`MASTER_HEADROOM`|× 0,5 puis limiteur (seuil −18 dB, rapport 12)|VD|
|`WIND_SOUND`|bruit généré (tampon de 2 s), passe-bande Q 0,8, centre 300 → 1 200 Hz et gain 0 → 0,15 selon la force du vent|VD|
|`DROP_SOUND`|sinus 900–1 600 Hz, attaque 5 ms, déclin 80 ms, gain 0,08, ≤ 3/s, aucun en hiver|VD|
|`PLANT_NOTES`|pentatonique majeure de ré : 293,66 / 329,63 / 369,99 / 440,00 / 493,88 / 587,33 Hz ; indice = `floor(x / 1600 × 6)` ; roche une octave plus bas ; triangle, attaque 20 ms, relâchement 1,8 s, gain 0,12|VD|
|`REVERB`|réponse impulsionnelle calculée (bruit à déclin exponentiel, 2,5 s), mélange 0,25|VD|

## 10. Scénarios (un par fonction)
Convention : « Étant donné / Quand / Alors », résultat mesurable, jalon et vérificateur.

**F-1 Papier vivant (J1)** — Étant donné Edge puis Chrome sous Windows, plein écran en 1920 × 1080 puis 2560 × 1440, quand la page se charge, alors `paper-visible` arrive en ≤ 3 000 ms (OM, U), l'écart-type de luminance d'une zone vide de 64 × 64 px est ≥ 1 % de l'échelle 0–255, soit 2,55 niveaux (grain, A) ; sur 20 s de captures, la luminance moyenne varie crête à crête entre 0,5 % et 2 % de sa moyenne (plafond de `PAPER_BREATH` ; la borne basse prouve le mouvement), période mesurée 9 s ± 0,5 s (A) ; tu juges le papier net aux deux résolutions (U).

**C-1 Premier jardin en 3 s (critère 1 de la fiche ; papier au J1, plante au J2)** — Étant donné `localhost`, Edge puis Chrome, cache froid, `?test=1&autoplant=1`, quand la page se charge (5 chargements), alors `paper-visible` (J1) et `first-stroke` (J2) arrivent chacun ≤ 3 000 ms, le pire des 5 étant noté ; une capture à +500 ms montre des pixels de trait autour de (800, 792) (OM ; A indicatif, U décisif). Mesure par le réseau : J6.

**F-2 Planter (J2)** — Étant donné une feuille vide prête, quand on clique 100 ms en (800, 792) uf, alors la graine d'encre apparaît à l'image suivant l'appui et le premier trait est dessiné ≤ 200 ms après le relâchement (p95 sur 20 clics, OM, A indicatif ; 10 clics chez toi, U décisif) ; le jardin compte 1 plante de l'espèce courante. Variante : appui de 1 500 ms → la jauge affiche « Herbes » ; au relâchement, des herbes poussent et deviennent l'espèce courante. Délai depuis le chargement : C-1.

**F-3 Croissance au pinceau (J2)** — Étant donné la graine `9f3a12c4` et deux bambous plantés en (500, 792) puis (1100, 792), quand ils poussent, alors les traits apparaissent segment par segment (0,55 s par segment, VD), 95 % des images durent ≤ 33 ms pendant la croissance (OM, A indicatif, U décisif), les deux hash de plante diffèrent, et chaque hash est identique sous Node, Chrome et Edge et égal à `tests/golden/plants.json` (A, D ; moteur V8 seulement : Firefox manuel, Safari non vérifié).

**F-4 Encre qui se diffuse (J3)** — Étant donné le niveau `complet` et un bambou qui vient de naître, quand 2 s de temps simulé passent, alors la densité d'encre moyenne dans un anneau de 4 à 20 uf autour du trait augmente entre 0,2 s et 2 s puis cesse d'augmenter après séchage (≤ 10 s, VD) (relecture de la grille en mode test seulement, A) ; la diffusion coûte ≤ 2,5 ms GPU au palier Moyen (OM, U).

**F-5 Vent (J3)** — Étant donné un jardin avec des herbes, quand la souris traverse les herbes à environ 300 uf/s sans bouton, alors l'impulsion est appliquée ≤ 100 ms après `event.timeStamp` (OM, instrumentation, A), la pointe des brins se déplace de plus de 2 uf et les particules de brume voisines changent de direction (capture, A ; ressenti, U).

**F-6 Pétales et feuilles (J3)** — Étant donné le palier `T3`, l'automne et le jardin de mesure (40 plantes), quand `bench.html` mesure 15 s, alors 200 000 particules sont actives (196 000 de brume + 4 000 porteurs visibles), les images/s médianes, le 1 % le plus lent et les ms par passe sont affichés ; cible : 60 images/s (OM, U). Les porteurs se posent dans la bande 790–875 uf ; sur au moins 2 000 poses, entre 1,5 % et 2,5 % laissent une tache (A).

**F-7 Saisons (J4)** — Étant donné un printemps avec un cerisier en fleurs, quand on appuie sur S, alors `poidsSaison` atteint l'été en 3 600 ms (critère < 4 000, A), aucune image ne dépasse 50 ms pendant la transition (OM, A indicatif), les fleurs rétrécissent pendant que les feuilles grandissent sans saut, et les nouveaux porteurs sont de type 2.

**F-8 Capture et partage (J4)** — Étant donné 12 plantes, la barre visible et la jauge ouverte, quand on clique « Garder ce jardin », alors un fichier `jardin-encre-9f3a12c4-automne.png` de 3840 × 2160 (ou la limite du GPU, §8) est produit en ≤ 3 s (OM), il montre la feuille entière et le sceau, sans élément d'interface (A ; présentable sans retouche : U). Quand on clique « Copier le lien », alors le presse-papiers contient l'URL `#g=1.…` ; ouverte dans un contexte neuf, elle donne le même `gardenHash()` (§8) et les plantes repoussent dans le même ordre (A) ; les taches peuvent différer (accepté, D-u).

**F-9 Ambiance sonore (J5)** — Étant donné un premier chargement, alors aucun `AudioContext` n'existe et rien ne sonne (A). Quand on clique Son, alors le RMS d'un `AnalyserNode` placé avant la sortie dépasse 0,005 (VD) ; quand on plante, une note de la gamme sonne (fréquence relevée par l'analyseur) ; quand on déplace le curseur de volume, le gain atteint 90 % de la cible en ≤ 100 ms (rampe de 50 ms). Graphe audio : A ; écoute réelle : U.

**F-10 Effacer / recommencer (J4)** — Étant donné 6 plantes, quand on clique « Nouvelle feuille », alors une boîte de confirmation s'ouvre avec le focus sur « Annuler » et propose « Copier le lien d'abord » ; si l'on confirme, l'encre s'efface en 1 200 ms, une nouvelle graine est tirée et l'URL est empilée ; avec Précédent, l'ancien fragment revient et le jardin repousse avec le même hash (A). Avec 3 plantes : pas de confirmation, Précédent fonctionne aussi.

**F-11 Mode contemplatif (J5)** — Étant donné le niveau `complet`, quand on entre en mode contemplatif (touche C, ou `CONTEMPLATIVE_IDLE_S` = 90 s sans interaction en plein écran, horloge simulée en test, A), alors le plein écran est demandé, l'interface et le curseur disparaissent après 3 s, le pilote plante toutes les 8–14 s (VD) jusqu'à 40 plantes (VD), dans la bande y 480–860 uf, à ≥ 90 uf des autres pieds, avec les poids d'espèce herbes 0,30, bambou 0,20, pivoine 0,20, cerisier 0,15, roche 0,15 (VD) ; une rafale toutes les 10–25 s et une saison toutes les 75 s (VD), qui continuent après les 40 plantes (le pilote ne plante plus). Sur 12 min (40 plantes atteintes entre 5 min 20 et 9 min 20) : aucune image > 100 ms après 2 min, tas JS final ≤ tas à 2 min + 10 Mo, compteurs `renderer.info.memory` constants (OM, A indicatif). Toute touche ou clic sort du mode sans planter ; le compte à rebours de 90 s repart.

**F-12 Repli sans WebGPU (J1 : papier et message)** — Étant donné `?force=reduit` (A) ou, chez toi, Edge avec « Utiliser l'accélération graphique » désactivée (U), quand la page se charge, alors le papier et le message de 8 s s'affichent (ou `refus` si WebGL2 manque aussi), sans écran blanc (< 1 % de pixels blancs purs à 3 s, A). Étant donné `?force=refus`, alors papier uni, message FR/EN, liste « WebGPU est livré dans : Chrome et Edge 113+, Safari 26, Firefox 141+ sous Windows » (wiki gpuweb, lu le 2026-11-01) et bouton « Réessayer ». Étant donné JavaScript désactivé, alors le message `<noscript>` s'affiche sur fond washi. Ce que le repli ajoute ensuite est contrôlé à chaque jalon (ci-dessous).

**Non-régression du repli `reduit` (J2 à J5)** : à chaque jalon, l'agent relance sous `?force=reduit` (drapeau de F-12) ce que le jalon ajoute, Diapason le rejoue, et toi au J5 avec le réglage d'Edge.
|Jalon|Ce que le jalon ajoute, revérifié en `reduit`|Qui|
|---|---|---|
|J2|une plante de chaque espèce pousse (pixels de trait présents) ; hash identique à `complet`|A, D|
|J3|vent : pointe des herbes déplacée de plus de 2 uf ; particules minimales (5 000, sinon plan B CPU de 1 000 porteurs) ; ton regard|A, D, U|
|J4|saison ≤ 4 000 ms ; **mêmes plantes pour un même lien** (même `gardenHash()`) ; PNG 3840 × 2160 sans interface|A, D|
|J5|aucun `AudioContext` avant action ; contrôle clavier et mouvement réduit ; mode contemplatif (entrée par C et par 90 s, sortie) ; contrôle final des 3 niveaux|A, D, U|

## 11. Cas limites
|Cas|Comportement attendu|St.|
|---|---|---|
|WebGPU absent ou `requestAdapter()` nul|`reduit` si WebGL2, sinon `refus`|D-d|
|Adaptateur logiciel (`adapter.info.isFallbackAdapter`)|`reduit` (`forceWebGL`). La forme `adapter.isFallbackAdapter` vaut `undefined` sur Chromium de classe 156 (vérifié le 2026-11-01) : ne pas l'utiliser ; la recherche 01 cite cette ancienne forme|D-d|
|Initialisation WebGPU qui lève une exception|1 essai en `reduit`, puis `refus`|D-d|
|Rien d'affiché après `RESCUE_DELAY_S` (6 s)|le message HTML de secours apparaît (CSS, sans JavaScript)|D-d|
|Perte du device (raison ≠ `destroyed`)|voile, recréation après 1 s depuis l'état, ≤ 3 tentatives en 60 s, puis `reduit`, puis `refus` avec « Recharger »|D-d|
|Stockage bloqué (exception)|préférences en mémoire ; message d'accueil à chaque visite ; aucune erreur visible|D-c|
|« Réduire les animations »|valeurs `REDUCED_MOTION` (§6), appliquées aussi si la préférence change en cours de session (événement `change`) ; graine pulsante figée (opacité 0,25) ; transitions de saison et fondus conservés|D-d|
|Fenêtre < 480 px de large|barre sur deux lignes ; feuille toujours en `cover`|D-d|
|Fenêtre de taille nulle|rendu suspendu, reprise au redimensionnement|D-d|
|Très grande fenêtre|canvas plafonné à `maxTextureDimension2D` et par l'échelle de rendu du palier|D-d|
|160 plantes atteintes|plantation refusée, message « La feuille est pleine », pas de graine|D-d|
|Clic avant que le rendu des traits soit prêt|un clic mis en attente, exécuté dès que prêt|D-d|
|Presse-papiers refusé|champ de texte avec l'URL sélectionnée|D-d|
|Plein écran refusé (iframe, politique)|le mode contemplatif marche sans plein écran (touche C ; pas d'entrée automatique)|D-d|
|Onglet caché|boucle arrêtée, audio suspendu, contrôleur réinitialisé au retour|D-d|
|Écran à 120/144 Hz|seuils en ms absolues (cible 60 images/s) ; pas de baisse tant que les fenêtres restent ≤ 18,5 ms|D-d|
|Lien abîmé ou d'une version future|refus du lien entier, nouvelle feuille, message (§8)|D-d|
|Plante près d'un bord ; deuxième doigt|géométrie conservée, rognée par la feuille ; deuxième doigt ignoré|D-d|

## 12. Tableau final : objectifs à mesurer et valeurs décidées
|Nombre|Valeur|Statut|Mesuré où, par qui|
|---|---|---|---|
|Particules au palier Élevé|200 000 (brume + quelques milliers de porteurs)|D-u (cible)|`bench.html`, U, J3|
|Images/s au palier Élevé, 1080p, machine moyenne|60|OM|`bench.html`, U, J3|
|Images/s minimum (machine modeste)|30, avec baisse automatique|OM|`bench.html`, U, J3|
|Papier visible|≤ 3 000 ms depuis `navigationStart`, local|OM|`paper-visible`, U décisif, J1|
|Première plante|≤ 3 000 ms depuis `navigationStart` jusqu'au premier pixel de trait, local (C-1)|OM|`first-stroke`, A indicatif, U décisif, J2|
|Réponse à la plantation|≤ 200 ms (p95)|OM|instrumentation, A indicatif et U décisif, J2|
|Réponse au vent|≤ 100 ms|OM|instrumentation, A, J3|
|Transition de saison|3 600 ms (critère < 4 000)|D-d / critère D-c|journal, A, J4|
|Images pendant la croissance|95 % ≤ 33 ms|OM|A indicatif, U décisif, J2|
|Images pendant une transition de saison|aucune > 50 ms|OM|A indicatif, J4|
|Endurance 12 min|aucune image > 100 ms après 2 min ; tas + ≤ 10 Mo|OM|Playwright, A indicatif, J5|
|Génération d'une plante (CPU)|≤ 16 ms|OM|Vitest + navigateur, A, J2|
|Budget GPU par poste (recherche 02, palier Élevé)|composition 2,0 + diffusion 2,5 + tampons 1,2 + particules 1,5 + 3,0 = 10,2 ms visés sur 16,7 ms (marge 6,5 ms) ; poste vent (0,3 ms) retiré, vent analytique|OM|timestamps (Chrome), U, J3|
|Poids de la page|< 2 Mo décompressé hors textures optionnelles|OM, D-u|`size-report`, A, J1 et J5|
|Taille de l'export|≤ 3 s pour 3840 × 2160|OM|A, J4|
|Contrastes|icônes ≈ 6,9:1, texte d'accueil (0,72) ≈ 5,7:1, sur washi uni (calcul) ; sur fond d'encre et « FR · EN » : NV|calcul, OM|A, J5|
|Valeurs décidées ou de départ|colonnes « St. » des §1 à §9 (particules en `reduit` : 5 000, VD, U, J3)|D / VD|—|
|WebGPU livré dans (pas une garantie pour ce site)|Chrome/Edge 113+, Safari 26, Firefox 141+ Windows|vérifié à la source le 2026-11-01 ; Safari NV en pratique (pas de Mac)|U, J6|

## Journal des corrections
Compte `wc -w` : 5740, soit 740 de plus que la limite 5 000 : document de valeurs (les §4 à §6 en pèsent 1 270 sans redite) et ajouts exigés par l audit (C-1, non-régression, débordement, focus, contrôleur) ; aucune valeur décidée n est coupée.
|Point|Où|Changement|
|---|---|---|
|1|tout|Texte resserré, tableaux compacts, lignes répétées du §12 retirées ; compte réel ci-dessus|
|2|§11, F-12|`adapter.info.isFallbackAdapter`, note de vérification|
|3, 22|§1, C-1, §12|`FIRST_PLANT_MS` défini ici une fois ; scénario C-1 ; mesure locale|
|4|F-12, tableau §10|F-12 réduit à papier + message ; non-régression J2 à J5 ; « mêmes plantes pour un même lien » au J4|
|5, 14|§3|`GPU × QC_TIER_RATIO ≤ 11 ms`, 36 fenêtres sur 40 ; test « 8,3 ms ne monte pas »|
|6|§10, §12|« indicatif » (headless) et « décisif » (fenêtré)|
|7, 24|§4.1, F-3|`dmath.sin` ; `**` interdit ; liste blanche ; V8 seulement|
|8|§2.2|Troncature déterministe, test des maxima, seuil de 90 %|
|9|§7.2|Contour de focus ; Espace/Entrée|
|10|§6, F-1|Crête à crête ; bande 0,5 à 2 % (plafond D-d, pour tolérer la valeur nominale 1,5 %) au lieu de 0,5 à 1,5 % ; période ; unité de l'écart-type|
|11|§1, §3, §7.2|Décisions utilisateur appliquées ; Q4 déjà en place|
|13|§12|10,2 ms sur 16,7 ms|
|15–18, 20, 21, 23, 25–28|F-9, F-6, §8, §1, §6, §7.1, F-12, F-11, §3, §12|Critères mesurables ; 1,5 à 2,5 % ; `gardenHash` ; `MAX_PLANTS` ; crochets retirés au J6 ; grain statique, `change`, tactile manuel ; « livré dans » ; 12 min ; `?quality=` ; palier du budget|
|12, 19|ARCH|Voir son journal|
|J2 (2026-11-01, Diapason)|§2.2|`MARKS_MAX_PER_PLANT` 96 -> 512 : pire cas mesuré 372 (cerisier, une marque par saison) ; règle « borne relevée si dépassée à 90 % » ; décidé par l agent J2, constaté par Diapason|
|J3 (2026-11-02, Diapason)|§2, §3, §6|Décisions de l'agent J3, constatées par Diapason (détail et valeurs : `docs/JOURNAL.md` section J3) : réglages `INK_*`, vent, brume, profondeur des feuilles ajustés ; `RT_STAIN` en `rgba16float` (en `rgba8` les taches ne pâlissaient jamais) ; `QC_TIER_RATIO` remplacé par les rapports mesurés (1,20 / 1,40 / 1,43, headless, indicatif) ; `rgba16float` en StorageTexture vérifié dans Three 0.187 : plan B inutile ; particules et brise coupées par défaut en `?test=1` (`&fx=1` les rallume)|
|J4 (2026-11-02, Diapason)|§5, §7, §8, F-10|Décisions de l'agent J4 (détail : JOURNAL J4) : confirmation de « Nouvelle feuille » dès 5 plantes (le scénario F-10 écrit 6 : la ligne J4 d'ARCHITECTURE §13 fait foi) ; verrou de molette 450 ms ; PNG 3 840 x 2 160 d'environ 16 Mo (le grain ne se compresse pas) montrant plantes poussées et particules en vol (feuille sans particules : décision de l'utilisateur à prendre) ; barre limitée aux contrôles du J4 ; URL aussi écrite au chargement|
|J5 (2026-11-02, Diapason)|§7.2, §9, F-9, F-11|Décisions de l'agent J5 (détail et liste de contrôle A/D/U : JOURNAL J5) : sortie du mode contemplatif par touche ou clic, pas par mouvement de souris (suit la SPEC) ; pas de recyclage des 40 plantes ; volume mémorisé mais pas l'état du son ; deux ajouts de niveau sonore hors SPEC (lit de vent seul à RMS 0,013 à 0,015, rattrapage) à valider à l'écoute ; message d'accueil « Clique pour planter » cité par le cahier (§6) sans scénario SPEC : non construit, à trancher|
|Audit J6 (2026-11-03, Diapason)|§8, §12|Sceau : canvas 2D et non SVG. Critères fenêtrés inchangés (réponse au vent ≤ 100 ms ; aucune image > 100 ms après 2 min). Seuils des tests headless (indicatifs) : vent p95 ≤ 100 ms et maximum ≤ 250 ms ; endurance au plus 0,02 % des images > 100 ms et pire image ≤ 250 ms ; `retries: 1` sur ces deux groupes. Crochets de test retirés du build de production par `__TEST_HOOKS__` ; construction de test `build:test` ; `scripts/scan-dist.mjs`|
