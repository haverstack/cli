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

export { collectTypes, formatTypes, showType, typesDefine } from './commands/types.js';
export {
  listRecords,
  showRecord,
  recordVersions,
  removeRecord,
  restoreRecord,
} from './commands/records.js';
export type { ListOptions, ShowOptions } from './commands/records.js';
export { stackAdd, stackList, stackUse, stackRemove } from './commands/stack.js';

export {
  tagAdd,
  tagRemove,
  linkAdd,
  linkRemove,
  buildRelationshipTarget,
} from './commands/associations.js';
export type { LinkTargetOptions } from './commands/associations.js';
export { permAdd, permRemove, grantAdd, grantRemove, grantList } from './commands/access.js';
export type { PermTargetOptions, GrantTargetOptions } from './commands/access.js';
export { attachAdd, attachRemove } from './commands/attach.js';

export { newRecord, editRecord, editStatus, commitEdit, discardEdit } from './commands/edit.js';
export type { StartResult, NewOptions, CommitOptions, CommitOutcome } from './commands/edit.js';
export {
  acquireEdit,
  listEdits,
  resolveEdit,
  releaseEdit,
  editDir,
  editRoot,
  recordMdPath,
  readEditFile,
  writeEditFile,
  EditInProgressError,
  RESERVED_WORKING_FILES,
} from './edit/lock.js';
export type { LockData, OpenEdit, EditMode } from './edit/lock.js';
export {
  resolveEditorCommand,
  launchEditor,
  launchExplorer,
  NoEditorError,
} from './edit/editor.js';
export { downloadEmbeds, reconcileAttachments } from './edit/attachments.js';

export {
  renderRecord,
  readonlyBlock,
  summarize,
  bodyFieldOf,
  formatSchema,
  fieldKindLabel,
  RESERVED_FRONT_MATTER_KEYS,
} from './record/format.js';
export type { RenderOptions } from './record/format.js';
export { scaffoldRecord } from './record/scaffold.js';
export type { ScaffoldOptions } from './record/scaffold.js';
export { parseRecord, RecordParseError } from './record/parse.js';
export type { ParsedRecord, ParseOptions } from './record/parse.js';
export { validateAgainstSchema } from './record/validate.js';
export type { FieldIssue } from './record/validate.js';

export { loadConfig, saveConfig, getProfile, shortDid } from './config.js';
export type { Config, Profile } from './config.js';
export { generateAndStoreKey, loadSigner, keyLocation } from './keys.js';
export type { StoredKey, Signer } from './keys.js';
export { configDir, configPath, editsDir, keysDir } from './paths.js';
export { iso, oneLine } from './util.js';
