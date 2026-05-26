# Memory token stats reports valid URL source as missing local file

## Summary

The exported `@poe-code/memory` APIs disagree about supported provenance: `auditClaims()` accepts URL-backed claim sources, while `computeTokenStats()` interprets the same URL frontmatter entry as a repository-relative file path and reports it missing. A memory page can therefore be audit-clean while status token accounting falsely reports an invalid source.

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

const { auditClaims } = await import("./audit.js");
const { computeTokenStats } = await import("./tokens.js");

describe("memory URL source accounting", () => {
  beforeEach(() => vol.reset());

  it("audits a URL source as valid but reports it missing in token stats", async () => {
    const url = "https://example.test/spec.md";
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/one.md": [
        "---",
        "sources:",
        `  - ${url}`,
        "---",
        `<!-- memory:extracted source=${url} -->`,
        "Remote claim."
      ].join("\n")
    });

    await expect(auditClaims("/repo/.poe-code/memory", "/repo")).resolves.toEqual([]);
    await expect(computeTokenStats("/repo/.poe-code/memory")).resolves.toMatchObject({
      sourceTokens: 0,
      missingSources: [url]
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
✓ packages/memory/src/__probe__.test.ts > memory URL source accounting > audits a URL source as valid but reports it missing in token stats
```

`auditSourceRef()` immediately accepts URL-like sources at `packages/memory/src/audit.ts:93` through `packages/memory/src/audit.ts:110`, so the page has no provenance audit issue. `computeTokenStats()` does not distinguish URLs; it resolves any non-absolute source against the repository root, attempts a local `fs.readFile()`, and records `ENOENT` as missing at `packages/memory/src/tokens.ts:22` through `packages/memory/src/tokens.ts:53`.

The documented package surface permits source provenance and exposes token-reduction status through the same memory API at `packages/memory/README.md:38` through `packages/memory/README.md:40`, `packages/memory/README.md:81` through `packages/memory/README.md:85`, and `packages/memory/README.md:198` through `packages/memory/README.md:208`.

## Expected Behavior

Token accounting should handle URL provenance consistently with claim auditing. A URL source that is accepted as remote provenance must not be resolved as a local repository file and listed as a missing local source; it should either be excluded from local source-token calculation or handled through an explicit remote-source policy.

## Impact

Projects using permitted URL provenance receive misleading status output: audit reports clean memory while token metrics report missing sources for valid remote references. This creates false lint/status signals, corrupts token-reduction reporting for remote-sourced pages, and makes automation unable to distinguish genuinely broken local references from supported URL sources.
