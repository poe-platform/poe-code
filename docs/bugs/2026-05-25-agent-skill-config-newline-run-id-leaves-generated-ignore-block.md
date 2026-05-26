# Agent skill config newline run ID leaves generated ignore block

## Summary

The exported `@poe-code/agent-skill-config` Git exclude bookkeeping helpers embed caller-provided `runId` values directly in line-oriented marker text. When a run ID contains a newline, `appendExcludeBlock()` writes split begin/end markers that `removeExcludeBlock()` cannot match later, so a normal append-then-remove lifecycle leaves the generated ignore entry persisted in `.git/info/exclude`.

## Reproduction

Create the disposable probe `packages/agent-skill-config/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { appendExcludeBlock, removeExcludeBlock, setGitDirRunnerForTest } = await import("./git-exclude.js");

beforeEach(() => {
  vol.reset();
});

it("cannot clean up an exclude block whose run id contains a newline", () => {
  const cwd = "/repo";
  const runId = "run-1\n# injected";
  const restore = setGitDirRunnerForTest(() => ".git");

  try {
    appendExcludeBlock(cwd, runId, [".opencode/skills/foo"]);
    removeExcludeBlock(cwd, runId);

    const excludePath = path.join(cwd, ".git/info/exclude");
    const contents = vol.readFileSync(excludePath, "utf8") as string;
    expect(contents).toContain(".opencode/skills/foo");
    expect(contents).toContain("# injected begin");
  } finally {
    restore();
  }
});
```

Run:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-skill-config/src/__probe__.test.ts > cannot clean up an exclude block whose run id contains a newline
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`markers()` constructs the begin and end marker lines by interpolating `runId` without validating it at `packages/agent-skill-config/src/git-exclude.ts:40` through `packages/agent-skill-config/src/git-exclude.ts:45`. `appendBlock()` then persists those values as separate newline-delimited content at `packages/agent-skill-config/src/git-exclude.ts:76` through `packages/agent-skill-config/src/git-exclude.ts:92`, while `removeBlock()` removes a block only when an individual parsed line exactly equals the full interpolated marker string at `packages/agent-skill-config/src/git-exclude.ts:59` through `packages/agent-skill-config/src/git-exclude.ts:74`. In the probe, `runId = "run-1\n# injected"` creates a split marker, and a subsequent `removeExcludeBlock()` leaves `.opencode/skills/foo` and the injected marker fragment in the exclude file. Both helpers are publicly exported at `packages/agent-skill-config/src/index.ts:29` through `packages/agent-skill-config/src/index.ts:30`.

## Expected Behavior

Run IDs used in line-oriented ignore-block markers should be validated or encoded so appended blocks can always be removed by the corresponding cleanup operation. Passing a run identity containing line breaks should reject before mutating `.git/info/exclude`, or round-trip safely without leaving persistent generated lines.

## Impact

Bridge callers that propagate external session identifiers into `runId` can permanently dirty repository ignore state after otherwise successful cleanup. Stale generated ignores can conceal future skill or hook files from version control, complicate debugging and cleanup, and accumulate marker fragments that no longer correspond to live bridge content.
