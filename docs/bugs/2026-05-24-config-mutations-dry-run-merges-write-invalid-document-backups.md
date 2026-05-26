# Config mutations dry-run merges write invalid document backups

## Summary

The public `@poe-code/config-mutations` executor accepts `dryRun: true` to preview mutations without filesystem writes, and explicit backup mutations honor that guard. However, both `configMutation.merge()` and template config merge operations unconditionally write an `.invalid-<timestamp>` backup when their existing target document cannot be parsed, even while executing in dry-run mode.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/config-mutations/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { configMutation, templateMutation, runMutations } from "./index.js";

function memoryFs(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const writes: Array<{ path: string; content: string }> = [];
  return {
    files, writes,
    readFile: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return content;
    },
    writeFile: async (path: string, content: string) => { files.set(path, content); writes.push({ path, content }); },
    mkdir: async () => {}, unlink: async (path: string) => { files.delete(path); },
    stat: async () => ({ isFile: () => true, isDirectory: () => false }), readdir: async () => []
  };
}

describe("config mutation dry-run invalid-document recovery", () => {
  it("creates invalid backups for both merge operations in dry-run mode", async () => {
    const fs = memoryFs({
      "/home/test/direct.json": "{invalid direct",
      "/home/test/template.json": "{invalid template"
    });
    const direct = await runMutations(
      [configMutation.merge({ target: "~/direct.json", value: { enabled: true } })],
      { fs: fs as never, homeDir: "/home/test", dryRun: true }
    );
    const templated = await runMutations(
      [templateMutation.mergeJson({ target: "~/template.json", templateId: "safe" })],
      { fs: fs as never, homeDir: "/home/test", dryRun: true, templates: async () => '{"enabled":true}' }
    );
    console.log(JSON.stringify({ direct, templated, writes: fs.writes.map((write) => write.path) }));
    expect(fs.writes.map((write) => write.path).filter((path) => path.includes(".invalid-"))).toHaveLength(2);
  });
});
PROBE
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm packages/config-mutations/src/__probe__.test.ts
```

Representative output:

```text
{"direct":{"changed":true,"effects":[{"changed":true,"effect":"write","detail":"update"}]},"templated":{"changed":true,"effects":[{"changed":true,"effect":"write","detail":"update"}]},"writes":["/home/test/direct.json.invalid-<timestamp>.json","/home/test/template.json.invalid-<timestamp>.json"]}
✓ packages/config-mutations/src/__probe__.test.ts > config mutation dry-run invalid-document recovery > creates invalid backups for both merge operations in dry-run mode
```

## Observed Behavior

The ordinary backup mutation explicitly wraps its write in `if (!context.dryRun)` at `packages/config-mutations/src/execution/apply-mutation.ts:356` through `packages/config-mutations/src/execution/apply-mutation.ts:387`. By contrast, parse failure in `applyConfigMerge()` directly awaits `backupInvalidDocument()` before reaching the later dry-run guard for the replacement write at `packages/config-mutations/src/execution/apply-mutation.ts:393` through `packages/config-mutations/src/execution/apply-mutation.ts:452`. `applyTemplateMerge()` repeats the same unconditional invalid-document backup pattern at `packages/config-mutations/src/execution/apply-mutation.ts:656` through `packages/config-mutations/src/execution/apply-mutation.ts:727`.

## Expected Behavior

When `runMutations()` is called with `dryRun: true`, config and template merge paths should not create backup files or otherwise write to disk. Invalid-document recovery should be simulated in the returned effects or skipped until a non-preview execution is requested.

## Impact

Callers using the mutation engine to preview provider configuration can unexpectedly create files containing malformed user configuration, even though no applied configuration write should occur. This dirties homes and CI fixtures, leaks invalid or sensitive config contents into timestamped copies, and violates the executor’s own dry-run behavior across mutation types.
