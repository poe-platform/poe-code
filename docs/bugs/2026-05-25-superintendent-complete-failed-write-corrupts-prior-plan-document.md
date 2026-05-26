# Superintendent Complete Failed Write Corrupts Prior Plan Document

## Summary

The public Superintendent `complete` command rewrites the live plan document directly when marking a loop complete. If that write fails after persisting only a prefix, the command rejects but destroys the prior valid plan, including its status and authored task content.

## Reproduction

Create a disposable Vitest probe at `packages/superintendent/src/commands/__probe__.test.ts`:

```ts
import { fs as memfs, vol } from "memfs";
import { expect, it, vi } from "vitest";

import { completeCommand } from "./complete.js";

const document = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: build
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: review
  round: 2
  review_turn: 1
---
# Keep this task plan
`;

it("corrupts the prior plan when completion persistence fails", async () => {
  vol.reset();
  const targetPath = "/repo/docs/plans/feature.md";
  vol.fromJSON({ [targetPath]: document }, "/");

  await expect(
    completeCommand.handler({
      params: { path: targetPath },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: (filePath: string, encoding?: BufferEncoding) => memfs.promises.readFile(filePath, encoding) as Promise<string>,
        async writeFile(filePath: string, content: string) {
          await memfs.promises.writeFile(filePath, content.slice(0, 12));
          throw new Error("disk full");
        },
        exists: vi.fn(async () => true)
      },
      env: { get: vi.fn(() => undefined) },
      progress: vi.fn()
    })
  ).rejects.toThrow("disk full");

  await expect(memfs.promises.readFile(targetPath, "utf8")).resolves.toBe("---\n$schema:");
});
```

Run:

```sh
npm exec -- vitest run packages/superintendent/src/commands/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/superintendent/src/commands/__probe__.test.ts > corrupts the prior plan when completion persistence fails
```

Remove the disposable probe after validation.

## Observed Behavior

`completeCommand.handler()` reads the Superintendent Markdown document, builds completed-status frontmatter using `transitionState()` and `setStatusReason()`, and directly writes the transformed text back to `params.path` at `packages/superintendent/src/commands/complete.ts:12` through `packages/superintendent/src/commands/complete.ts:27`. The transformed output begins with canonicalized frontmatter emitted through `packages/superintendent/src/document/write.ts:24` through `packages/superintendent/src/document/write.ts:49`. In the probe, a partial failing write reduces the originally valid plan to `---\n$schema:` and the command rejects with `disk full`.

## Expected Behavior

Manual completion should atomically replace the Superintendent plan document or leave its previous content intact when persistence fails. Reporting an unsuccessful completion must not corrupt the document required to resume, inspect, or manually recover the workflow.

## Impact

A disk-full, interrupted filesystem, or permission failure during a routine `superintendent complete` action can erase the only plan document for an active or review-stage loop. Users lose status history and task-board content while the operation reports failure, preventing safe follow-up actions on the prior valid workflow state.
