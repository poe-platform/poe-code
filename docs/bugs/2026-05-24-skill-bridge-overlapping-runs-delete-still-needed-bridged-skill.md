# Skill bridge overlapping runs delete still-needed bridged skill

## Summary

`bridgeActiveSkills()` skips a requested skill when a prior active run has already copied that basename into the spawned agent's local skill directory. The second run records only a `local-collision` warning and no ownership/reference to the existing generated skill. When the first run later cleans up, it recursively removes the shared target even though the second spawned run still depends on it.

## Reproduction

From the repository root, run a disposable Vitest probe that starts two overlapping Codex skill bridges for the same active skill, then cleans up only the first run:

```sh
cat > packages/agent-skill-config/src/__probe__.test.ts <<'EOF'
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bridgeActiveSkills, cleanupBridgedSkills } from "./bridge-active-skills.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

describe("concurrent active skill bridges", () => {
  it("lets cleanup of one run delete a skill still requested by another run", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-bridge-race-"));
    roots.push(root);
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    fs.mkdirSync(path.join(cwd, ".poe-code", "skills", "helper"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".poe-code", "skills", "helper", "SKILL.md"), "live helper");
    const first = bridgeActiveSkills("codex", cwd, ["helper"], home, "run-1");
    const second = bridgeActiveSkills("codex", cwd, ["helper"], home, "run-2");
    const target = path.join(cwd, ".codex", "skills", "helper", "SKILL.md");
    cleanupBridgedSkills(first);
    console.log(JSON.stringify({ secondEntries: second.entries.length, warning: second.warnings[0]?.kind, targetExists: fs.existsSync(target) }));
    expect(second.warnings[0]?.kind).toBe("local-collision");
    expect(fs.existsSync(target)).toBe(false);
  });
});
EOF
trap 'rm -f packages/agent-skill-config/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
nl -ba packages/agent-skill-config/src/bridge-active-skills.ts | sed -n '164,247p'
nl -ba packages/agent-skill-config/README.md | sed -n '30,56p'
```

## Observed Behavior

The second active run is treated as a collision rather than sharing ownership, and cleanup from the first run deletes the skill it still needs:

```text
{"secondEntries":0,"warning":"local-collision","targetExists":false}
✓ packages/agent-skill-config/src/__probe__.test.ts > concurrent active skill bridges > lets cleanup of one run delete a skill still requested by another run
```

The bridge contract states that active skills are copied into the spawning agent's local skill directory in `packages/agent-skill-config/README.md:30`. `bridgeActiveSkills()` creates entries only for newly copied targets and turns an already-existing target into a `local-collision` warning in `packages/agent-skill-config/src/bridge-active-skills.ts:200`. `cleanupBridgedSkills()` later recursively deletes every target owned by the earlier manifest in `packages/agent-skill-config/src/bridge-active-skills.ts:239`, without tracking whether another live run requested the same generated target.

## Expected Behavior

Overlapping active runs that require the same bridged skill should share a reference-counted or run-owned generated target, or each run should receive an isolated destination. Cleaning up one run must not remove a skill still required by another active spawned agent.

## Impact

Concurrent agents launched in the same project can lose their runtime skills unpredictably when an earlier sibling exits. A still-running agent may stop seeing mandated tools or instructions mid-task, behave inconsistently across concurrent launches, or fail only after unrelated teardown occurs.
