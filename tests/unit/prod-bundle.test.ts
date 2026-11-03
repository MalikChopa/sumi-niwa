// Garde non temporelle de l'interrupteur `__TEST_HOOKS__` (audit J6, points 2 et 3) : la construction de PRODUCTION, faite en
// mémoire, ne doit contenir ni crochet de test (`window.__jardin`, `?test=1`, cartouche de marques, paramètres de test), ni page de
// mesure, et doit livrer `LICENSES.txt` avec un `<link rel="license">`. La construction de TEST doit au contraire les contenir
// (sinon ce test serait creux : il passerait aussi si le scan ne cherchait plus rien).
import { describe, expect, it } from 'vitest';
import { build } from 'vite';
import { scanProduction } from '../../scripts/prod-scan.mjs';

interface OutFile {
  type: 'chunk' | 'asset';
  fileName: string;
  code?: string;
  source?: string | Uint8Array;
}

async function buildInMemory(mode: 'production' | 'test'): Promise<{ name: string; text: string }[]> {
  const res = (await build({ root: process.cwd(), configFile: process.cwd() + '/vite.config.ts', mode, logLevel: 'silent', build: { write: false, emptyOutDir: false } })) as unknown as { output: OutFile[] } | { output: OutFile[] }[];
  const outputs = Array.isArray(res) ? res.flatMap((r) => r.output) : res.output;
  return outputs.map((o) => ({
    name: o.fileName,
    text: o.type === 'chunk' ? (o.code ?? '') : typeof o.source === 'string' ? o.source : new TextDecoder().decode(o.source ?? new Uint8Array()),
  }));
}

describe('construction de production : aucun crochet de test, licences livrées', () => {
  it('aucune chaîne de crochet, aucune page de mesure, LICENSES.txt et lien de licence présents', async () => {
    const files = await buildInMemory('production');
    expect(files.some((f) => f.name === 'index.html')).toBe(true);
    expect(scanProduction(files)).toEqual([]);
    expect(files.map((f) => f.name).filter((n) => /bench|determinism|probe/.test(n))).toEqual([]);
    const all = files.map((f) => f.text).join('\n');
    expect(all).not.toContain('__jardin');
    expect(all).not.toContain('test-hud');
  }, 120_000);

  it('la construction de test contient bien les crochets et les pages de mesure (le scan n\'est pas creux)', async () => {
    const files = await buildInMemory('test');
    const problems = scanProduction(files);
    expect(problems.some((p) => p.includes('__jardin'))).toBe(true);
    expect(files.some((f) => /bench.*\.js$/.test(f.name))).toBe(true);
    expect(files.some((f) => f.name === 'determinism.html')).toBe(true);
  }, 120_000);

  it('LICENSES.txt reprend les textes réels des paquets installés', async () => {
    const files = await buildInMemory('production');
    const lic = files.find((f) => f.name === 'LICENSES.txt')?.text ?? '';
    expect(lic).toContain('Copyright © 2010-2026 three.js authors');
    expect(lic).toContain('Permission is hereby granted, free of charge');
    expect(lic).toContain('VoidZero');
    expect(lic.length).toBeLessThan(10_000); // le cœur de la licence de Vite seulement, pas les 100 Ko de licences d'outils
  }, 120_000);
});
