/**
 * @haverstack/cli — programmatic entry.
 *
 * The package is primarily a binary (`haverstack` / `hstack`); these exports
 * exist so the dogfooding sandbox and tests can drive command internals
 * without spawning a process.
 */

export { openStack, computeMode } from './openStack.js';
export type { OpenedStack, StackMode, OpenStackOptions } from './openStack.js';
export { formatBanner } from './banner.js';
export { collectTypes, formatTypes } from './commands/types.js';
export { stackAdd, stackList, stackUse, stackRemove } from './commands/stack.js';

export { loadConfig, saveConfig, getProfile, shortDid } from './config.js';
export type { Config, Profile } from './config.js';
export { generateAndStoreKey, loadSigner, keyLocation } from './keys.js';
export type { StoredKey, Signer } from './keys.js';
export { configDir, configPath, editsDir, keysDir } from './paths.js';
