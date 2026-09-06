import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const XDG_VARS = [
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME',
  'XDG_DATA_HOME',
  'HAVERSTACK_STACK',
] as const;

export type TempEnv = {
  dir: string;
  cleanup: () => Promise<void>;
};

/**
 * Point every XDG dir the CLI uses at a fresh scratch directory and clear
 * $HAVERSTACK_STACK, so config and key I/O in a test never touches the real
 * home. Restores the previous values on cleanup.
 */
export async function withTempEnv(): Promise<TempEnv> {
  const dir = await mkdtemp(join(tmpdir(), 'hstack-test-'));
  const saved = new Map<string, string | undefined>();
  for (const v of XDG_VARS) {
    saved.set(v, process.env[v]);
    if (v === 'HAVERSTACK_STACK') delete process.env[v];
    else process.env[v] = join(dir, v);
  }
  return {
    dir,
    cleanup: async () => {
      for (const [v, value] of saved) {
        if (value === undefined) delete process.env[v];
        else process.env[v] = value;
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}
