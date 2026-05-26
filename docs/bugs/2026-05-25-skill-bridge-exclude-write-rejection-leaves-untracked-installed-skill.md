# Skill bridge exclude write rejection leaves untracked installed skill

## Summary

`@poe-code/agent-skill-config` copies resolved active skills into the spawning agent's local skill directory before it records those generated paths in `.git/info/exclude`. If the exclude bookkeeping write rejects without modifying the exclude file, `bridgeActiveSkills()` still throws after the copied skill has been installed and returns no `BridgeManifest` that the caller can pass to `cleanupBridgedSkills()`.

## Reproduction

Create the disposable probe `packages/agent-skill-config/src/__probe__.test.ts`:

```ts
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vol } from 'memfs';

vi.mock('node:fs', async () => {
  const { fs } = await import('memfs');
  return fs;
});

const fs = await import('node:fs');
const { bridgeActiveSkills } = await import('./bridge-active-skills.js');
const { setGitDirRunnerForTest } = await import('./git-exclude.js');

describe('skill bridge exclude write failure', () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync('/repo/.poe-code/skills/helper', { recursive: true });
    vol.writeFileSync('/repo/.poe-code/skills/helper/SKILL.md', '# helper\n');
  });

  it('throws after copying a skill that the caller cannot clean up by manifest', () => {
    const restoreRunner = setGitDirRunnerForTest(() => '/repo/.git');
    const writeFileSync = vi.spyOn(fs, 'writeFileSync').mockImplementation((filePath, ...args) => {
      if (String(filePath) === path.join('/repo/.git/info/exclude')) {
        throw new Error('exclude write failed');
      }
      return (vol.writeFileSync as unknown as (...callArgs: unknown[]) => unknown)(filePath, ...args) as never;
    });

    try {
      expect(() => bridgeActiveSkills('opencode', '/repo', ['helper'], '/home/test', 'run-1')).toThrow(
        'exclude write failed',
      );
      expect(vol.existsSync('/repo/.opencode/skills/helper/SKILL.md')).toBe(true);
    } finally {
      writeFileSync.mockRestore();
      restoreRunner();
    }
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-skill-config/src/__probe__.test.ts > skill bridge exclude write failure > throws after copying a skill that the caller cannot clean up by manifest
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`bridgeActiveSkills()` copies each skill into the agent-local destination and appends the corresponding entry to its in-memory list at `packages/agent-skill-config/src/bridge-active-skills.ts:255` through `packages/agent-skill-config/src/bridge-active-skills.ts:264`. Only after all copying is complete does it call `appendExcludeBlock()` at lines 267 through 273; the manifest is returned only at lines 275 through 281. `appendExcludeBlock()` writes the exclude document at `packages/agent-skill-config/src/git-exclude.ts:94` through `packages/agent-skill-config/src/git-exclude.ts:111`. In the probe, that final write rejects immediately with `exclude write failed`, while `.opencode/skills/helper/SKILL.md` remains installed and no manifest is returned.

## Expected Behavior

Bookkeeping failure during bridge setup should roll back copied skills, or the API should provide a usable partial manifest/cleanup path before reporting failure. A failed bridge request must not silently leave active skill instructions installed in the spawning agent's local skill search path.

## Impact

A read-only `.git/info` directory, permission error, or transient filesystem failure can make spawn preparation fail while leaving undeclared bridged instructions active for later agent runs. Because the caller receives only an exception and no cleanup manifest, the residual skill may continue influencing subsequent executions without being ignored or automatically removed.
