/**
 * The one-line context banner. Printed to stderr (so `--json` on stdout
 * stays clean) before a command acts, so a later permission error is never
 * a surprise about which stack or whose authority was in play.
 * See docs/design.md § Trust posture differs by backend.
 */

import type { OpenedStack } from './openStack.js';

export function formatBanner(opened: Pick<OpenedStack, 'target' | 'mode'>): string {
  return `→ ${opened.target}  [${opened.mode}]`;
}
