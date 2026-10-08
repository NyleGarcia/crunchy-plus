import type { Mode } from './types';

/** localStorage key (crunchyroll.com origin) the MAIN-world hook reads synchronously at document_start. */
export const HOOK_CONFIG_KEY = 'crunchyplus:config';
export const HOOK_TAG = '__crunchyplus';
export interface HookConfig {
  mode: Mode;
  dubLocale: string;
}
