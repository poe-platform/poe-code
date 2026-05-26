# Agent skill config install skill name traversal writes outside skill directory

## Summary

The exported `@poe-code/agent-skill-config` `installSkill()` API accepts an arbitrary `SkillFile.name` and concatenates it into the destination path without validating it as a single skill-folder segment. Supplying a relative name such as `../escaped` writes `SKILL.md` outside the target agent's configured skill directory while returning a display path that still appears to be underneath that skill root.

## Reproduction

From the repository root, create and execute this disposable in-memory Vitest probe, then remove it:

```sh
cat > packages/agent-skill-config/src/__probe__.test.ts <<'EOF'
import { Volume, createFsFromVolume } from "memfs";
import { expect, it } from "vitest";
import type { FileSystem } from "@poe-code/config-mutations";
import { installSkill } from "./apply.js";

it("installs a relative-segment skill outside the configured skill directory", async () => {
  const volume = Volume.fromJSON({});
  const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

  const result = await installSkill(
    "claude-code",
    { name: "../escaped", content: "# escaped" },
    { fs, cwd: "/project", homeDir: "/home/test", scope: "local" }
  );

  await expect(fs.readFile("/project/.claude/escaped/SKILL.md", { encoding: "utf8" }))
    .resolves.toBe("# escaped");
  expect(result.displayPath).toBe(".claude/skills/../escaped/SKILL.md");
});
EOF
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-skill-config/src/__probe__.test.ts
```

The focused probe passes:

```text
✓ packages/agent-skill-config/src/__probe__.test.ts > installs a relative-segment skill outside the configured skill directory
```

## Observed Behavior

Installing the local Claude skill named `../escaped` writes its instructions to `/project/.claude/escaped/SKILL.md`, which is adjacent to—not within—the configured `/project/.claude/skills` directory. The returned `displayPath` remains `.claude/skills/../escaped/SKILL.md`, masking the normalized destination. `installSkill()` composes `skillFolderPath` and `skillFilePath` directly from `skill.name` at `packages/agent-skill-config/src/apply.ts:117` through `packages/agent-skill-config/src/apply.ts:164`. The downstream mutation path resolver validates only that the constructed raw target begins with `~`, then expands and normalizes relative segments via `path.join(...)` at `packages/config-mutations/src/execution/path-utils.ts:55` through `packages/config-mutations/src/execution/path-utils.ts:75`.

## Expected Behavior

`installSkill()` should accept only a safe single folder name for `skill.name`, or enforce after normalization that the destination remains beneath the configured agent skill directory. A relative-segment name should reject before any file is created.

## Impact

Any SDK caller or CLI flow that accepts an external skill name can cause instruction files to be created outside the intended agent skill root. In local scope this mutates neighboring project configuration paths; in global scope additional traversal segments can target broader user-home locations, while the returned display path obscures the escape.
