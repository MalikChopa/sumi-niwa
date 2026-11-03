export const FORBIDDEN: string[];
export const FORBIDDEN_FILES: RegExp[];
export function scanProduction(files: { name: string; text?: string }[]): string[];
