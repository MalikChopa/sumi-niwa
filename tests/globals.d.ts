// Octets d'une capture Playwright (un Buffer de Node) : type local, pour ne pas dépendre de @types/node (absent d'un clone propre).
type PngBuf = Uint8Array & { toString(encoding?: string): string };

// Déclarations minimales : @types/node n'est pas dans la liste des installations approuvées (J1, J2).
declare const process: { env: Record<string, string | undefined>; cwd(): string };

// Seules fonctions de Node utilisées par les tests unitaires et la configuration (écriture des valeurs de référence,
// licences au build).
declare module 'node:fs' {
  export function writeFileSync(path: string, data: string): void;
  /** Lecture binaire (J4 : en-tête d'un PNG téléchargé). */
  export function readFileSync(path: string): { length: number; readUInt32BE(offset: number): number; subarray(a: number, b: number): { toString(enc: string): string } };
  /** Lecture de texte (licences au build, lecture des sources par les tests de garde). */
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  export function existsSync(path: string | URL): boolean;
}
