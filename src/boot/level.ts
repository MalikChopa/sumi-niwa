// F-12 : détection du niveau de rendu au chargement.
// complet = WebGPU matériel ; reduit = WebGL2 (ou WebGPU logiciel) ; refus = ni l'un ni l'autre.
import type { Level } from '../constants';

export interface Detection {
  level: Level;
  /** Raison lisible (journal de la console en mode test, jamais affichée à l'écran). */
  reason: string;
  /** Niveau demandé par `?force=`, ou null. */
  forced: Level | null;
}

/** Lit `?force=complet|reduit|refus`. Toute autre valeur est ignorée. */
export function parseForce(search: string): Level | null {
  const v = new URLSearchParams(search).get('force');
  return v === 'complet' || v === 'reduit' || v === 'refus' ? v : null;
}

/** WebGL2 disponible ? Sonde sur un canvas jetable (jamais celui du rendu). */
export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    return gl !== null;
  } catch {
    return false;
  }
}

/**
 * WebGPU matériel disponible ?
 * `isFallbackAdapter` se lit sur `adapter.info` (SPEC §11) : la forme `adapter.isFallbackAdapter`
 * vaut `undefined` sur Chromium 156 et ne verrait jamais un adaptateur logiciel.
 */
interface MinimalGPU {
  requestAdapter(): Promise<{ info?: { isFallbackAdapter?: boolean } } | null>;
}

async function webgpuState(): Promise<'hardware' | 'software' | 'none'> {
  const gpu = (navigator as Navigator & { gpu?: MinimalGPU }).gpu;
  if (!gpu) return 'none';
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return 'none';
    return adapter.info?.isFallbackAdapter === true ? 'software' : 'hardware';
  } catch {
    return 'none';
  }
}

export async function detectLevel(search: string): Promise<Detection> {
  const forced = parseForce(search);
  if (forced === 'refus') return { level: 'refus', reason: '?force=refus', forced };
  if (forced === 'reduit') {
    return hasWebGL2()
      ? { level: 'reduit', reason: '?force=reduit', forced }
      : { level: 'refus', reason: '?force=reduit mais WebGL2 absent', forced };
  }
  const gpu = await webgpuState();
  // ?force=complet ne saute que le test de l'adaptateur logiciel ; sans WebGPU il retombe sur la chaîne normale.
  if (gpu === 'hardware' || (forced === 'complet' && gpu === 'software')) {
    return { level: 'complet', reason: gpu === 'hardware' ? 'adaptateur WebGPU matériel' : '?force=complet (adaptateur logiciel accepté)', forced };
  }
  if (hasWebGL2()) {
    return {
      level: 'reduit',
      reason: gpu === 'software' ? 'adaptateur WebGPU logiciel (info.isFallbackAdapter)' : 'WebGPU absent ou requestAdapter() nul, WebGL2 présent',
      forced,
    };
  }
  return { level: 'refus', reason: 'ni WebGPU ni WebGL2', forced };
}
