// Contrôle de la construction de PRODUCTION (audit J6, points 2 et 3) : aucun crochet de test, aucune page de mesure,
// les avis de licence présents. Partagé par `scripts/scan-dist.mjs` (npm run build) et `tests/unit/prod-bundle.test.ts`.

/** Chaînes qui ne doivent JAMAIS figurer dans un fichier livré (crochets de test, pages de mesure, marques, paramètres de test). */
export const FORBIDDEN = [
  '__jardin', // window.__jardin
  '__TEST_HOOKS__', // interrupteur non remplacé
  'test-hud', // cartouche de marques
  'paper-visible', // marques de performance
  'first-stroke',
  'bench.html',
  'determinism.html',
  'autoplant', // &autoplant=1
  'simulateDeviceLoss',
];

/** Noms de fichiers qui ne doivent pas exister dans la production. */
export const FORBIDDEN_FILES = [/(^|\/)bench[^/]*\.(html|js)$/, /(^|\/)determinism[^/]*\.(html|js)$/, /(^|\/)probe[^/]*\.js$/];

/**
 * @param {{ name: string, text?: string }[]} files fichiers livrés (`name` relatif, séparateur `/`) ; `text` pour les fichiers texte
 * @returns {string[]} problèmes relevés (vide = conforme)
 */
export function scanProduction(files) {
  const problems = [];
  for (const f of files) {
    if (FORBIDDEN_FILES.some((re) => re.test(f.name))) problems.push(`fichier de test livré : ${f.name}`);
    if (f.text === undefined) continue;
    for (const s of FORBIDDEN) if (f.text.includes(s)) problems.push(`${f.name} contient « ${s} »`);
    // Paramètres réservés au mode test lus dans l'adresse : `.get("test")`, `.get('fx')`... (`force` et `quality` restent permis).
    const m = /\.get\(\s*["'`](test|fx|welcome|windring|autoplant)["'`]\s*\)/.exec(f.text);
    if (m) problems.push(`${f.name} lit le paramètre « ${m[1]} »`);
  }
  const lic = files.find((f) => f.name === 'LICENSES.txt');
  if (!lic || lic.text === undefined) problems.push('LICENSES.txt absent');
  else {
    if (!lic.text.includes('The MIT License') || !lic.text.includes('three.js authors')) problems.push('LICENSES.txt : licence de three.js absente');
    if (!lic.text.includes('VoidZero')) problems.push('LICENSES.txt : avis de Vite absent');
  }
  const html = files.find((f) => f.name === 'index.html');
  if (!html || html.text === undefined) problems.push('index.html absent');
  else if (!/<link[^>]*rel="license"[^>]*href="LICENSES\.txt"|<link[^>]*href="LICENSES\.txt"[^>]*rel="license"/.test(html.text)) problems.push('index.html : <link rel="license"> absent');
  return problems;
}
