# Skill Bridge Failed Exclude Write Corrupts Prior Git Ignore State

## Summary

The exported `@poe-code/agent-skill-config` ignore-block helper appends generated skill entries by overwriting `.git/info/exclude` directly. If the write partially modifies the file before rejecting, adding a temporary bridge block fails while destroying pre-existing repository-local ignore rules.

## Reproduction

Create a disposable Vitest probe at `packages/agent-skill-config/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const excludePath = "/repo/.git/info/exclude";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs,
    writeFileSync(filePath: Parameters<typeof fs.writeFileSync>[0], data: Parameters<typeof fs.writeFileSync>[1], options?: Parameters<typeof fs.writeFileSync>[2]) {
      if (filePath === excludePath) {
        fs.writeFileSync(filePath, "# user", options);
        throw new Error("exclude disk full");
      }
      fs.writeFileSync(filePath, data, options);
    }
  };
});

const { appendExcludeBlock, setGitDirRunnerForTest } = await import("./git-exclude.js");

describe("skill bridge interrupted exclude update", () => {
  it("destroys prior git ignore rules when adding a block rejects", () => {
    vol.reset();
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(excludePath, "# user ignore\n.DS_Store\n");
    const restore = setGitDirRunnerForTest(() => "/repo/.git");

    try {
      expect(() => appendExcludeBlock("/repo", "run-1", [".poe-code/skills/run-1"])).toThrow("exclude disk full");
      const raw = vol.readFileSync(excludePath, "utf8") as string;
      console.log(JSON.stringify({ raw }));
      expect(raw).toBe("# user");
    } finally {
      restore();
    }
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"# user"}
✓ packages/agent-skill-config/src/__probe__.test.ts > skill bridge interrupted exclude update > destroys prior git ignore rules when adding a block rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`appendExcludeBlock()` resolves the repository-local exclude path, reads existing ignore content, and writes a replacement document through `fs.writeFileSync()` at `packages/agent-skill-config/src/git-exclude.ts:94` through `packages/agent-skill-config/src/git-exclude.ts:111`. In the probe, `.git/info/exclude` initially contains two user rules; adding a generated-skill block rejects with `"exclude disk full"` after the file is already truncated to `"# user"`, losing the original content.

## Expected Behavior

Temporary ignore-block insertion should leave existing `.git/info/exclude` rules intact when persistence cannot complete. The helper should commit replacement content atomically or restore the prior readable file after a failed write.

## Impact

Normal skill bridging can erase repository-local user ignore configuration during a transient disk or filesystem failure. Even though the bridge operation reports an error, files that users intentionally ignored may become visible to Git or be unintentionally staged afterward because the prior ignore rules are no longer present.
