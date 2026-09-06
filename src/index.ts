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
export { queryAll } from './paginate.js';

export { collectTypes, formatTypes, showType } from './commands/types.js';
export { listRecords, showRecord, recordVersions } from './commands/records.js';
export type { ListOptions, ShowOptions } from './commands/records.js';
export { stackAdd, stackList, stackUse, stackRemove } from './commands/stack.js';

export {
  renderRecord,
  summarize,
  bodyFieldOf,
  formatSchema,
  fieldKindLabel,
} from './record/format.js';

export { loadConfig, saveConfig, getProfile, shortDid } from './config.js';
export type { Config, Profile } from './config.js';
export { generateAndStoreKey, loadSigner, keyLocation } from './keys.js';
export type { StoredKey, Signer } from './keys.js';
export { configDir, configPath, editsDir, keysDir } from './paths.js';
export { iso, oneLine } from './util.js';
