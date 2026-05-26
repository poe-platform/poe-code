# Memory source symlink escapes repository provenance boundary

## Summary

The exported memory provenance APIs accept a source reference such as `docs/linked.md` as repository-local based only on its lexical path, then follow a symbolic link at that location to read an external file. `auditClaims()` reports no provenance issue for the linked source, while `computeTokenStats()` reads and counts the external target as source material.

## Reproduction

Create this disposable Vitest probe at `packages/memory/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("../../tokenfill/dist/index.js", () => ({
  countTokens: (text: string) => text.split(/\s+/u).filter(Boolean).length,
}));

const { auditClaims } = await import("./audit.js");
const { computeTokenStats } = await import("./tokens.js");

describe("memory source provenance symlink escape", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("accepts and counts an external source reachable through a repo-local symlink", async () => {
    vol.fromJSON({
      "/outside/private.md": "external secret material\n",
      "/repo/docs/.keep": "",
      "/repo/.poe-code/memory/pages/note.md": [
        "---",
        "sources:",
        "  - docs/linked.md#L1",
        "---",
        "<!-- memory:extracted source=docs/linked.md#L1 -->",
        "The note cites an apparently local source.",
        "",
      ].join("\n"),
    });
    vol.symlinkSync("/outside/private.md", "/repo/docs/linked.md");

    await expect(auditClaims("/repo/.poe-code/memory", "/repo")).resolves.toEqual([]);
    await expect(computeTokenStats("/repo/.poe-code/memory")).resolves.toMatchObject({
      sourceTokens: 3,
      missingSources: [],
    });
  });
});
```

Run the focused probe, then remove it:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
rm -f packages/memory/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/memory/src/__probe__.test.ts > memory source provenance symlink escape > accepts and counts an external source reachable through a repo-local symlink
```

## Observed Behavior

With `/repo/docs/linked.md` symlinked to `/outside/private.md`, a page citing `docs/linked.md#L1` passes `auditClaims("/repo/.poe-code/memory", "/repo")` with no issues, even though the actual bytes read reside outside `/repo`. The same citation causes `computeTokenStats()` to read the external text and return `sourceTokens: 3` with no missing source.

`auditSourceRef()` rejects absolute and lexically escaping paths, but it only applies `path.resolve(repoRoot, source.path)` and `isWithinRoot()` before calling `fs.readFile(absPath, "utf8")` at `packages/memory/src/audit.ts:87` through `packages/memory/src/audit.ts:140`; the read follows the repository-local symlink. `computeTokenStats()` similarly resolves each source string lexically and reads the resulting path directly at `packages/memory/src/tokens.ts:22` through `packages/memory/src/tokens.ts:53`, with no canonical containment check.

## Expected Behavior

Repository-relative provenance must remain within the canonical repository boundary when source content is validated or counted. A relative source path that traverses a symbolic link to an external target should be rejected or reported as invalid instead of accepted as local provenance and read normally.

## Impact

A memory page can present external filesystem content as valid project provenance through a checked-in or locally planted symlink. Auditing may falsely certify the citation while status or ingestion token accounting reads external data, undermining provenance guarantees and exposing content outside the intended repository boundary to memory tooling.
