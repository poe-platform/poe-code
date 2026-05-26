# Skill bridge duplicate run ID cleanup removes live ignore block

## Summary

`bridgeActiveSkills()` identifies generated `.git/info/exclude` blocks solely by caller-supplied `runId`. If two simultaneously active bridges use the same run ID but install different skills, both blocks receive identical markers. Cleaning up one manifest removes every block bearing that ID, including the ignore entry needed for the other live bridge whose copied skill remains on disk.

## Reproduction

From the repository root, run a disposable Vitest probe that bridges two different skills with the same run ID and tears down only the first manifest:

```sh
cat > packages/agent-skill-config/src/__probe__.test.ts <<'EOF'
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bridgeActiveSkills, cleanupBridgedSkills } from "./bridge-active-skills.js";
import { setGitDirRunnerForTest } from "./git-exclude.js";

const roots: string[] = [];
const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("bridge run-id collisions", () => {
  it("lets cleanup erase another live run's ignore block when ids collide", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-bridge-runid-"));
    roots.push(root);
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    const gitDir = path.join(cwd, ".git");
    restores.push(setGitDirRunnerForTest(() => gitDir));
    for (const name of ["one", "two"]) {
      fs.mkdirSync(path.join(cwd, ".poe-code", "skills", name), { recursive: true });
      fs.writeFileSync(path.join(cwd, ".poe-code", "skills", name, "SKILL.md"), name);
    }
    const first = bridgeActiveSkills("codex", cwd, ["one"], home, "same-run");
    const second = bridgeActiveSkills("codex", cwd, ["two"], home, "same-run");
    const excludePath = path.join(gitDir, "info", "exclude");
    const before = fs.readFileSync(excludePath, "utf8");
    cleanupBridgedSkills(first);
    const after = fs.readFileSync(excludePath, "utf8");
    console.log(JSON.stringify({ before, after, secondTargetExists: fs.existsSync(second.entries[0]!.targetPath) }));
    expect(before).toContain(".codex/skills/two");
    expect(after).not.toContain(".codex/skills/two");
    expect(fs.existsSync(second.entries[0]!.targetPath)).toBe(true);
  });
});
EOF
trap 'rm -f packages/agent-skill-config/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
nl -ba packages/agent-skill-config/src/git-exclude.ts | sed -n '39,113p;115,132p'
nl -ba packages/agent-skill-config/src/bridge-active-skills.ts | sed -n '267,293p'
```

## Observed Behavior

Before cleanup, both copied skills have separate ignore blocks carrying the same markers. After cleaning up only the first manifest, the second skill still exists but all generated ignore coverage is gone:

```text
{"before":"# poe-code-spawn-skills:same-run begin\n.codex/skills/one\n# poe-code-spawn-skills:same-run end\n# poe-code-spawn-skills:same-run begin\n.codex/skills/two\n# poe-code-spawn-skills:same-run end\n","after":"","secondTargetExists":true}
✓ packages/agent-skill-config/src/__probe__.test.ts > bridge run-id collisions > lets cleanup erase another live run's ignore block when ids collide
```

`appendExcludeBlock()` generates markers directly from `runId` and appends them to the Git exclude file in `packages/agent-skill-config/src/git-exclude.ts:40` and `packages/agent-skill-config/src/git-exclude.ts:94`. `removeBlock()` deletes every complete block using those same marker strings in `packages/agent-skill-config/src/git-exclude.ts:62`. `cleanupBridgedSkills()` invokes that run-ID-only removal after deleting its own targets in `packages/agent-skill-config/src/bridge-active-skills.ts:284`, without verifying that the removed ignore entries belong to the cleaning manifest.

## Expected Behavior

Cleanup should remove only ignore entries created for the manifest being cleaned. Duplicate caller-provided run IDs must either be rejected, namespaced with a unique bridge identity, or removed by exact tracked entries so another live bridge retains its generated-skill ignore coverage.

## Impact

When concurrent or retried spawns reuse a run identifier, generated skill directories for still-running agents can unexpectedly become visible to Git status, diffs, commits, or downstream file scanners after an unrelated cleanup. This leaks temporary injected runtime instructions into normal repository state and can lead users to accidentally commit generated skills.
