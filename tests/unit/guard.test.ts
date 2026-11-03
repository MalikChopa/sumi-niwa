// Garde en liste blanche (ARCHITECTURE 12.1, SPEC §4.1) : dans src/core, tout `Math` qui n'est pas de la forme
// `Math.<nom de la liste blanche>(` est une erreur, de même que `**`, `**=`, `Math[`, `= Math`, `} = Math`,
// `globalThis.Math`. Le scanner est lui-même testé sur des exemples fautifs.
import { describe, expect, it } from 'vitest';

export const MATH_WHITELIST = ['sqrt', 'floor', 'ceil', 'round', 'trunc', 'abs', 'min', 'max', 'sign', 'fround', 'imul'];

/**
 * Retire les commentaires (bloc et ligne) en lisant le source comme un analyseur lexical (audit J6 point 15) : les chaînes
 * ('', "", `` avec `${ }` imbriqués) et les expressions régulières sont lues en entier, donc un `//` ou un `/*` qui s'y trouve
 * n'est plus pris pour un commentaire (l'ancienne version avalait la fin de ligne : `const s = "a //"; const x = Math.sin(1);`
 * passait). Le contenu des chaînes est conservé (un `Math` dans une chaîne est refusé). Limite connue : `/` après `}` est lu comme
 * une division ; une expression régulière en début d'instruction juste après un bloc serait mal lue (aucune dans src/core).
 */
export function stripComments(src: string): string {
  const n = src.length;
  const BS = String.fromCharCode(92); // barre oblique inverse
  const NL = String.fromCharCode(10);
  let i = 0;
  let out = '';
  const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'new', 'else', 'do', 'instanceof']);

  function readString(q: string): void {
    out += q;
    i++;
    while (i < n) {
      const c = src[i] as string;
      if (c === BS) {
        out += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      out += c;
      i++;
      if (c === q || c === NL) return;
    }
  }
  function readTemplate(): void {
    out += '`';
    i++;
    while (i < n) {
      const c = src[i] as string;
      if (c === BS) {
        out += src.slice(i, i + 2);
        i += 2;
      } else if (c === '`') {
        out += c;
        i++;
        return;
      } else if (c === '$' && src[i + 1] === '{') {
        out += '${';
        i += 2;
        code(true);
        out += '}';
        i++; // l'accolade fermante laissée par code(true)
      } else {
        out += c;
        i++;
      }
    }
  }
  function readRegex(): void {
    out += '/';
    i++;
    let inClass = false;
    while (i < n) {
      const c = src[i] as string;
      if (c === BS) {
        out += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      out += c;
      i++;
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if ((c === '/' && !inClass) || c === NL) break;
    }
    while (i < n && /[a-z]/i.test(src[i] as string)) out += src[i++];
  }
  /** Lit du code ; avec `untilBrace`, s'arrête (sans la consommer) sur l'accolade qui ferme un `${`. */
  function code(untilBrace: boolean): void {
    let depth = 0;
    let prev = '';
    let prev2 = '';
    let word = '';
    while (i < n) {
      const c = src[i] as string;
      const d = src[i + 1];
      if (c === '/' && d === '/') {
        while (i < n && src[i] !== NL) i++;
        continue;
      }
      if (c === '/' && d === '*') {
        const e = src.indexOf('*/', i + 2);
        const end = e < 0 ? n : e + 2;
        out += src.slice(i, end).split('').map((ch) => (ch === NL ? NL : ' ')).join('');
        i = end;
        continue;
      }
      if (c === '"' || c === "'") {
        readString(c);
        prev2 = prev;
        prev = c;
        word = '';
        continue;
      }
      if (c === '`') {
        readTemplate();
        prev2 = prev;
        prev = '`';
        word = '';
        continue;
      }
      if (c === '/') {
        const incdec = (prev === '+' || prev === '-') && prev2 === prev;
        const regexOk = !incdec && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || REGEX_AFTER_WORD.has(word));
        if (regexOk) {
          readRegex();
          prev2 = prev;
          prev = '/';
          word = '';
          continue;
        }
      }
      if (c === '{') depth++;
      if (c === '}') {
        if (untilBrace && depth === 0) return;
        depth--;
      }
      out += c;
      i++;
      if (!/\s/.test(c)) {
        prev2 = prev;
        prev = c;
        word = /[A-Za-z0-9_$]/.test(c) ? word + c : '';
      }
    }
  }
  code(false);
  return out;
}

export function findForbidden(src: string): string[] {
  const code = stripComments(src);
  const errors: string[] = [];
  const allowed = new RegExp(`^Math\\.(${MATH_WHITELIST.join('|')})\\s*\\(`);
  const re = /\bMath\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const rest = code.slice(m.index, m.index + 40);
    if (!allowed.test(rest)) errors.push(`Math interdit : « ${rest.split('\n')[0]} »`);
  }
  if (/\*\*/.test(code)) errors.push('opérateur ** ou **= interdit');
  // Portes dérobées vers `Math` (`globalThis["Ma" + "th"]`, `self`, `window`, `eval`, `Function`, `Reflect`) : aucune raison d'en avoir dans src/core.
  const door = /\b(globalThis|window|self|eval|Function|Reflect)\b/.exec(code);
  if (door) errors.push(`accès global interdit : « ${door[1]} »`);
  return errors;
}

// src/core et le seul module hors de src/core qu'il importe (src/constants.ts).
const sources = import.meta.glob(['../../src/core/**/*.ts', '../../src/constants.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('garde Math de src/core', () => {
  it('le scanner refuse les exemples fautifs', () => {
    const bad = [
      'const a = Math.asin(x);',
      'const b = x ** 2;',
      'y **= 2;',
      'const M = Math; M.sin(1);',
      'const { sin } = Math;',
      'const f = Math["sin"];',
      'const g = globalThis.Math.cos(1);',
      'const h = Math.sin(1);',
      'const k = Math.PI;',
      'const r = Math.random();',
      'const p = Math.pow(2, 3);',
      'const e = Math.exp(1);',
      // Audit J6 point 15 : cas tordus qui passaient avec l'ancien nettoyage par expressions régulières.
      'const s = "a //"; const x = Math.sin(1);',
      "const s = 'a /*'; const x = Math.sin(1); /* fin */",
      'const r = /a\\/*b/; const x = Math.sin(1);',
      'const t = `a // ${ Math.cos(1) }`;',
      'const t = `x ${ "}" } //`; const y = Math.tan(1);',
      'const g = globalThis["Ma" + "th"].sin(1);',
      'const w = window.Math.sin(1);',
      'const f = new Function("return Math.sin(1)");',
    ];
    for (const b of bad) expect(findForbidden(b), b).not.toEqual([]);
  });

  it('le scanner accepte la liste blanche et ignore les commentaires', () => {
    const ok = [
      'const a = Math.sqrt(x) + Math.floor(y) + Math.imul(a, b) + Math.fround(z);',
      '// Math.sin est interdit\nconst b = Math.max(1, 2);',
      '/** pas de ** ici, ni Math.cos */ const c = Math.abs(-1);',
      'const d = Math.min (1, 2);',
      'const e = "a // pas un commentaire"; const f = Math.abs(-1);',
      'const g = a / b / c + Math.floor(d / 2); const h = i++ / 2;',
      'const re = /[/]x\\//.test(s) ? Math.max(1, 2) : 0;',
      'const t = `a ${ x /* c */ } b`; // Math.sin\nconst u = Math.round(1);',
    ];
    for (const o of ok) expect(findForbidden(o), o).toEqual([]);
  });

  it('le nettoyage garde les numéros de ligne (commentaires de bloc remplacés par des blancs)', () => {
    const src = 'a;\n/* x\ny */ b;\n// z\nc;';
    expect(stripComments(src).split('\n').length).toBe(src.split('\n').length);
  });

  it('src/core (et src/constants.ts) ne contient aucun Math hors liste blanche', () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThanOrEqual(8);
    const all: string[] = [];
    for (const f of files) for (const e of findForbidden(sources[f] as string)) all.push(`${f} : ${e}`);
    expect(all).toEqual([]);
  });
});
