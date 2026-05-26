# Config mutations remove global content regex skips subsequent matching files

## Summary

`fileMutation.remove({ whenContentMatches })` accepts a JavaScript `RegExp` guard for conditional deletion. When a caller supplies a valid global or sticky expression and reuses it across multiple remove mutations, the executor calls `.test()` without resetting regex state. Two files with identical matching content can therefore produce one deletion followed by a false no-op solely because the guard’s `lastIndex` was advanced by the previous file.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/config-mutations/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { fileMutation, runMutations } from "./index.js";

describe("removeFile global content matcher", () => {
  it("skips the second matching file because the regexp lastIndex is reused", async () => {
    const vol = new Volume();
    const fs = createFsFromVolume(vol).promises as never;
    vol.mkdirSync("/home/test", { recursive: true });
    vol.writeFileSync("/home/test/one.txt", "owned=true");
    vol.writeFileSync("/home/test/two.txt", "owned=true");
    const matcher = /owned=true/g;
    const outcome = await runMutations(
      [
        fileMutation.remove({ target: "~/one.txt", whenContentMatches: matcher }),
        fileMutation.remove({ target: "~/two.txt", whenContentMatches: matcher })
      ],
      { fs, homeDir: "/home/test" }
    );
    const oneExists = vol.existsSync("/home/test/one.txt");
    const twoExists = vol.existsSync("/home/test/two.txt");
    console.log(JSON.stringify({ outcome, oneExists, twoExists, lastIndex: matcher.lastIndex }));
    expect(oneExists).toBe(false);
    expect(twoExists).toBe(true);
    expect(outcome.effects).toEqual([
      { changed: true, effect: "delete", detail: "delete" },
      { changed: false, effect: "none", detail: "noop" }
    ]);
  });
});
PROBE
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm packages/config-mutations/src/__probe__.test.ts
```

Output:

```text
{"outcome":{"changed":true,"effects":[{"changed":true,"effect":"delete","detail":"delete"},{"changed":false,"effect":"none","detail":"noop"}]},"oneExists":false,"twoExists":true,"lastIndex":0}
✓ packages/config-mutations/src/__probe__.test.ts > removeFile global content matcher > skips the second matching file because the regexp lastIndex is reused
```

## Observed Behavior

The public option accepts `whenContentMatches?: RegExp` at `packages/config-mutations/src/mutations/file-mutation.ts:17` through `packages/config-mutations/src/mutations/file-mutation.ts:25` and `packages/config-mutations/src/types.ts:151` through `packages/config-mutations/src/types.ts:161`. `applyRemoveFile()` evaluates that shared expression directly through `mutation.whenContentMatches.test(trimmed)` at `packages/config-mutations/src/execution/apply-mutation.ts:252` through `packages/config-mutations/src/execution/apply-mutation.ts:303`. Global and sticky JavaScript regexes mutate `lastIndex` after a successful match, so the next identical content check begins at the wrong offset and is treated as non-matching.

## Expected Behavior

Conditional removal results should depend on each file’s content, not on prior executions of the same guard object. The executor should use stateless matching semantics, reset `lastIndex` before each check, or reject stateful regex flags in this public mutation option.

## Impact

Declarative cleanup manifests can silently fail to remove later matching files when they reuse a global content matcher, leaving credentials, managed configuration fragments, or generated artifacts behind while reporting no-op outcomes. The result depends on mutation ordering rather than persisted file contents, making cleanup unreliable and difficult to diagnose.
