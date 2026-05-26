# Memory token stats reads absolute source outside repository

## Summary

The exported `@poe-code/memory` token-accounting API accepts an absolute path from page `sources` frontmatter and reads that file even when it is outside the repository. This bypasses the provenance boundary enforced by claim auditing and exposes external file contents to token accounting.

## Reproduction

Create the disposable probe `packages/memory/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});
vi.mock("../../tokenfill/dist/index.js", () => ({
  countTokens: (input: string) => input.split(/\s+/u).filter(Boolean).length
}));

const { computeTokenStats } = await import("./tokens.js");

describe("memory token stats source path containment", () => {
  beforeEach(() => vol.reset());

  it("counts content from an absolute source outside the repository", async () => {
    vol.fromJSON({
      "/outside/private.txt": "hidden external token material",
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/one.md": [
        "---",
        "sources:",
        "  - /outside/private.txt",
        "---",
        "memory"
      ].join("\n")
    });

    await expect(computeTokenStats("/repo/.poe-code/memory")).resolves.toMatchObject({
      sourceTokens: 4,
      missingSources: []
    });
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
rm -f packages/memory/src/__probe__.test.ts
```

## Observed Behavior

The probe passes:

```text
✓ packages/memory/src/__probe__.test.ts > memory token stats source path containment > counts content from an absolute source outside the repository
```

`computeTokenStats()` collects each page frontmatter source and, when it sees an absolute path, passes it directly to `fs.readFile()` at `packages/memory/src/tokens.ts:22` through `packages/memory/src/tokens.ts:50`. Thus an absolute `/outside/private.txt` entry is read and its four tokens are included in `sourceTokens` rather than being rejected.

The package already defines the opposite provenance rule for audited claims: `auditSourceRef()` rejects absolute paths and any relative path resolving outside the repository at `packages/memory/src/audit.ts:93` through `packages/memory/src/audit.ts:110`.

## Expected Behavior

Token accounting should enforce the same repository containment boundary as provenance auditing. Absolute local source paths and relative paths that escape the repository should be rejected or reported invalid without reading external file contents.

## Impact

A crafted, corrupted, or incorrectly reconciled memory page can cause ordinary token-stat calculation to read files outside the project and incorporate their contents into reported source-token metrics. Callers that expose token statistics can therefore trigger unintended external-file reads and disclose information about those files through observable token totals.
