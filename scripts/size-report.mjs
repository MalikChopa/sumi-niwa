// Poids du build : décompressé et gzip, par fichier et au total, comparé à l'objectif de 2 Mo décompressé
// (SPEC `PAGE_WEIGHT`, textures optionnelles exclues : aucune au J1). Usage : npm run build puis npm run size-report.
// Le rapport porte sur la PRODUCTION (`dist/`, sans crochets de test ni pages de mesure) ; si la construction de test existe
// (`npm run build:test`), son total est donné pour information seulement (audit J6, point 2).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const LIMIT = 2 * 1024 * 1024; // objectif : < 2 Mo décompressé

if (!existsSync(DIST)) {
  console.error('dist/ introuvable : lance `npm run build` d\'abord.');
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const kb = (n) => (n / 1024).toFixed(1).padStart(9) + ' Ko';
let raw = 0;
let gz = 0;
console.log('fichier'.padEnd(34) + 'décompressé'.padStart(14) + 'gzip'.padStart(14));
for (const f of walk(DIST).sort()) {
  const buf = readFileSync(f);
  const g = gzipSync(buf, { level: 9 }).length;
  raw += buf.length;
  gz += g;
  console.log(relative(DIST, f).replaceAll('\\', '/').padEnd(34) + kb(buf.length) + kb(g));
}
console.log('-'.repeat(62));
console.log('TOTAL'.padEnd(34) + kb(raw) + kb(gz));
console.log(`Total décompressé : ${raw} octets = ${(raw / 1048576).toFixed(3)} Mo, objectif < 2 Mo (${LIMIT} octets) : ${raw < LIMIT ? 'RESPECTÉ' : 'DÉPASSÉ'} (${((raw / LIMIT) * 100).toFixed(1)} % de l'objectif).`);
console.log('Gzip (information seulement) : ' + `${gz} octets = ${(gz / 1048576).toFixed(3)} Mo.`);
const TEST_DIR = fileURLToPath(new URL('../node_modules/.jardin-test', import.meta.url));
if (existsSync(TEST_DIR)) {
  const testRaw = walk(TEST_DIR).reduce((n, f) => n + statSync(f).size, 0);
  console.log(`Information : la construction de TEST (build:test, non publiée) pèse ${testRaw} octets = ${(testRaw / 1048576).toFixed(3)} Mo.`);
}
process.exit(raw < LIMIT ? 0 : 2);
