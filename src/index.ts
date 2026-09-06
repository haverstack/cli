/**
 * @haverstack/cli — programmatic entry.
 *
 * The package is primarily a binary (`haverstack` / `hstack`); these exports
 * exist so the dogfooding sandbox and tests can drive command internals
 * without spawning a process.
 */

export { openStack } from './openStack.js';
export type { OpenedStack, StackMode } from './openStack.js';
export { collectTypes, formatTypes } from './commands/types.js';
