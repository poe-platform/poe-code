# Config mutations dry-run transform writes invalid document backup

## Summary

`configMutation.transform()` is a public mutation operation that accepts the same `dryRun: true` executor context used to preview configuration changes without writing them. When its target file contains malformed JSON, the transform path nevertheless writes a timestamped invalid-document backup before invoking the caller’s transform and before reaching any dry-run protection for the requested update or deletion.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/config-mutations/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { configMutation, runMutations } from "./index.js";

function memoryFs(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    writes,
    readFile: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return content;
    },
    writeFile: async (path: string, content: string) => { files.set(path, content); writes.push(path); },
    mkdir: async () => {}, unlink: async (path: string) => { files.delete(path); },
    stat: async () => ({ isFile: () => true, isDirectory: () => false }), readdir: async () => []
  };
}

describe("config transform dry-run invalid-document recovery", () => {
  it("writes an invalid-document backup while previewing a transform", async () => {
    const fs = memoryFs({ "/home/test/settings.json": "{invalid" });
    const outcome = await runMutations(
      [configMutation.transform({ target: "~/settings.json", transform: () => ({ content: { repaired: true }, changed: true }) })],
      { fs: fs as never, homeDir: "/home/test", dryRun: true }
    );
    console.log(JSON.stringify({ outcome, writes: fs.writes }));
    expect(fs.writes).toHaveLength(1);
    expect(fs.writes[0]).toContain("settings.json.invalid-");
  });
});
PROBE
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm packages/config-mutations/src/__probe__.test.ts
```

Representative output:

```text
{"outcome":{"changed":true,"effects":[{"changed":true,"effect":"write","detail":"update"}]},"writes":["/home/test/settings.json.invalid-<timestamp>.json"]}
✓ packages/config-mutations/src/__probe__.test.ts > config transform dry-run invalid-document recovery > writes an invalid-document backup while previewing a transform
```

## Observed Behavior

`applyConfigTransform()` reads and parses its target, then handles parse failure by directly awaiting `backupInvalidDocument()` at `packages/config-mutations/src/execution/apply-mutation.ts:535` through `packages/config-mutations/src/execution/apply-mutation.ts:566`. It does so before invoking `mutation.transform()` and before the `context.dryRun` checks guarding the later unlink or write branches at `packages/config-mutations/src/execution/apply-mutation.ts:568` through `packages/config-mutations/src/execution/apply-mutation.ts:606`. This differs from the explicit backup mutation, which suppresses its copy write under dry run at `packages/config-mutations/src/execution/apply-mutation.ts:356` through `packages/config-mutations/src/execution/apply-mutation.ts:387`.

## Expected Behavior

Previewing a config transform with `dryRun: true` should not write backup files or mutate the filesystem, even when the input file is malformed. The operation may report that recovery would be needed, but recovery artifacts should be written only during actual application.

## Impact

Provider cleanup and repair flows implemented through config transforms can leak malformed or sensitive configuration contents into new backup files during non-mutating previews. This makes dry-run unsafe for inspection, dirties user homes and test environments, and creates unexpected persisted copies even when callers intentionally requested no writes.
