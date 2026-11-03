// Fin de `npm run build` : contrôle `dist/` (aucun crochet de test, aucune page de mesure, LICENSES.txt présent).
// Code de sortie 3 au moindre écart : la construction de production échoue plutôt que de livrer un crochet.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProduction } from './prod-scan.mjs';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
if (!existsSync(DIST)) {
  console.error('dist/ introuvable.');
  process.exit(1);
}
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const files = walk(DIST).map((p) => ({ name: relative(DIST, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }));
const problems = scanProduction(files);
if (problems.length > 0) {
  console.error('[scan-dist] la construction de production n\'est pas conforme :\n - ' + problems.join('\n - '));
  process.exit(3);
}
console.log(`[scan-dist] production conforme : ${files.length} fichiers, aucun crochet de test, LICENSES.txt et <link rel="license"> présents.`);
