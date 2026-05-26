# Agent skill config newline skill name injects extra Git exclude rule

## Summary

The exported `@poe-code/agent-skill-config` `bridgeActiveSkills()` API accepts a bare skill reference containing an embedded newline and copies that legitimate same-directory skill into the spawn agent's local skills. It then writes the target's relative path verbatim into line-oriented `.git/info/exclude` content. A single bridged skill such as `helper\nsecret.env` therefore inserts an unrelated standalone ignore rule `secret.env` in addition to the intended generated-skill path.

## Reproduction

Create the disposable probe `packages/agent-skill-config/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { bridgeActiveSkills, cleanupBridgedSkills } = await import("./bridge-active-skills.js");
const { setGitDirRunnerForTest } = await import("./git-exclude.js");

describe("bridge newline skill reference exclude injection", () => {
  let restoreRunner: () => void;

  beforeEach(() => {
    vol.reset();
    vol.mkdirSync("/repo/.git/info", { recursive: true });
    vol.mkdirSync("/repo/.poe-code/skills/helper\nsecret.env", { recursive: true });
    vol.writeFileSync("/repo/.poe-code/skills/helper\nsecret.env/SKILL.md", "# helper\n");
    restoreRunner = setGitDirRunnerForTest(() => "/repo/.git");
  });

  afterEach(() => {
    restoreRunner?.();
  });

  it("injects a separate ignore pattern from the accepted skill name", () => {
    const manifest = bridgeActiveSkills(
      "opencode",
      "/repo",
      ["helper\nsecret.env"],
      "/home/test",
      "run-1"
    );
    const exclude = vol.readFileSync("/repo/.git/info/exclude", "utf8") as string;
    console.log(JSON.stringify({ exclude }));

    expect(exclude).toContain(".opencode/skills/helper\nsecret.env\n");
    expect(exclude.split("\n")).toContain("secret.env");

    cleanupBridgedSkills(manifest);
  });
});
```

Run the targeted test, then delete the probe:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-skill-config/src/__probe__.test.ts
```

The probe passes and prints an exclude block containing the injected second ignore line:

```text
{"exclude":"# poe-code-spawn-skills:run-1 begin\n.opencode/skills/helper\nsecret.env\n# poe-code-spawn-skills:run-1 end\n"}
✓ packages/agent-skill-config/src/__probe__.test.ts > bridge newline skill reference exclude injection > injects a separate ignore pattern from the accepted skill name
```

## Observed Behavior

`resolveSkillReference()` validates only empty/trimmed and slash-count constraints for a bare reference in `packages/agent-skill-config/src/resolve-skill-reference.ts:64` through `packages/agent-skill-config/src/resolve-skill-reference.ts:93`; an interior newline remains a valid directory-name character and resolves inside `.poe-code/skills`. `bridgeActiveSkills()` copies the resolved skill and derives the relative generated target path at `packages/agent-skill-config/src/bridge-active-skills.ts:192` through `packages/agent-skill-config/src/bridge-active-skills.ts:292`. It passes that path as an exclude entry, and `appendExcludeBlock()` serializes each entry directly as one newline-delimited line at `packages/agent-skill-config/src/git-exclude.ts:82` through `packages/agent-skill-config/src/git-exclude.ts:110`. The accepted skill name `helper\nsecret.env` therefore emits both `.opencode/skills/helper` and the unintended independent ignore rule `secret.env`.

## Expected Behavior

Generated Git exclude entries should not be forgeable from skill identifiers. The bridge should reject skill names containing line-break characters or encode/validate generated ignore paths so each copied target contributes exactly one intended ignore rule.

## Impact

A user-, plan-, plugin-, or agent-controlled active-skill reference can silently modify Git ignore behavior for unrelated project files while appearing to bridge only one contained skill. Sensitive or important files such as `secret.env` can become hidden from `git status` and ordinary review workflows until the generated block is inspected or removed, obscuring local changes during agent runs.
