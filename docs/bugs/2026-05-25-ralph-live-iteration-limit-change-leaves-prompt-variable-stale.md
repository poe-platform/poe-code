# Ralph live iteration limit change leaves prompt variable stale

## Summary

`@poe-code/ralph` re-resolves the plan document before later iterations, including its prompt and `iterations` configuration, but replaces the documented `{{ max_iterations }}` prompt variable from the initial configuration snapshot. After a live plan update changes the iteration limit, subsequent agent prompts still state the old limit.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/ralph/src/__probe__.test.ts <<'PROBE'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { runRalph } from "./run/ralph.js";

describe("Ralph live max_iterations prompt interpolation", () => {
  it("runs a reloaded prompt with the initial iteration-limit variable", async () => {
    const docPath = "/repo/.poe-code/ralph/plans/work.md";
    const document = (iterations: number) => `---\nagent: claude-code\niterations: ${iterations}\nstatus:\n  state: open\n  iteration: 0\n---\nLimit={{ max_iterations }}`;
    const volume = Volume.fromJSON({ [docPath]: document(2) }, "/");
    const fs = createFsFromVolume(volume).promises as any;
    const prompts: string[] = [];

    await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath,
      fs,
      async runAgent(input) {
        prompts.push(input.prompt);
        if (prompts.length === 1) {
          await fs.writeFile(docPath, document(3), "utf8");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    console.log(JSON.stringify({ prompts }));
    expect(prompts).toEqual(["Limit=2", "Limit=2"]);
  });
});
PROBE
npm exec -- vitest run packages/ralph/src/__probe__.test.ts --reporter verbose
rm packages/ralph/src/__probe__.test.ts
```

Output:

```text
{"prompts":["Limit=2","Limit=2"]}
✓ packages/ralph/src/__probe__.test.ts > Ralph live max_iterations prompt interpolation > runs a reloaded prompt with the initial iteration-limit variable
```

## Observed Behavior

`runRalph()` initially resolves `config` at `packages/ralph/src/run/ralph.ts:48`. Before later iterations, its `readConfig` callback resolves the freshly edited document at `packages/ralph/src/run/ralph.ts:70` through `packages/ralph/src/run/ralph.ts:81`, creating a current workflow with `fresh.maxIterations`. However, the agent prompt wrapper interpolates `{{ max_iterations }}` using `config.maxIterations` from startup at `packages/ralph/src/run/ralph.ts:87` through `packages/ralph/src/run/ralph.ts:107`. In the reproduction, the plan changes its `iterations` frontmatter from `2` to `3` after the first prompt, yet the second freshly reloaded prompt is still sent as `"Limit=2"`.

## Expected Behavior

When Ralph applies a live-reloaded plan configuration to the next agent iteration, documented prompt variables that describe that effective configuration should use the current plan values. After the plan changes to `iterations: 3`, the next prompt should interpolate `{{ max_iterations }}` as `3`.

## Impact

Agents can receive incorrect instructions about the active loop budget after operators update a running plan. Plans that tell an agent how much time or how many iterations remain may drive decisions using stale information, even while other parts of the reloaded document already affect execution.
