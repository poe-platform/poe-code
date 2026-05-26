# Ralph live agent change executes new agent but reports initial agent

## Summary

`@poe-code/ralph` reloads its document before later iterations so changing `agent` affects which executor actually runs, but its `onIterationStart` progress callback selects the announced agent from the initial configuration snapshot. After a live edit changes agents, Ralph reports that the old agent is running while it invokes the new agent.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/ralph/src/__probe__.test.ts <<'PROBE'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { runRalph } from "./run/ralph.js";

describe("Ralph live agent reporting", () => {
  it("reports the initial agent after a later iteration reloads a different agent", async () => {
    const docPath = "/repo/.poe-code/ralph/plans/work.md";
    const document = (agent: string) => `---\nagent: ${agent}\niterations: 2\nstatus:\n  state: open\n  iteration: 0\n---\nWork`;
    const volume = Volume.fromJSON({ [docPath]: document("claude-code") }, "/");
    const fs = createFsFromVolume(volume).promises as any;
    const announced: string[] = [];
    const executed: string[] = [];

    await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath,
      fs,
      async runAgent(input) {
        executed.push(input.agent);
        if (executed.length === 1) {
          await fs.writeFile(docPath, document("codex"), "utf8");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      onIterationStart(_iteration, _maxIterations, agent) {
        announced.push(agent);
      }
    });

    console.log(JSON.stringify({ announced, executed }));
    expect(executed).toEqual(["claude-code", "codex"]);
    expect(announced).toEqual(["claude-code", "claude-code"]);
  });
});
PROBE
npm exec -- vitest run packages/ralph/src/__probe__.test.ts --reporter verbose
rm packages/ralph/src/__probe__.test.ts
```

Output:

```text
{"announced":["claude-code","claude-code"],"executed":["claude-code","codex"]}
✓ packages/ralph/src/__probe__.test.ts > Ralph live agent reporting > reports the initial agent after a later iteration reloads a different agent
```

## Observed Behavior

`runRalph()` resolves `config` once before workflow execution at `packages/ralph/src/run/ralph.ts:48`. Its `readConfig` callback later re-resolves fresh document content and creates workflow participants from `fresh.agents` at `packages/ralph/src/run/ralph.ts:70` through `packages/ralph/src/run/ralph.ts:81`, so the updated document causes iteration two to execute `codex`. However, `onIterationStart` still selects `currentSpecifier` from the original `config.agents` array at `packages/ralph/src/run/ralph.ts:131` through `packages/ralph/src/run/ralph.ts:140`. In the reproduction, actual execution changes from `claude-code` to `codex`, while both progress callbacks announce `claude-code`.

## Expected Behavior

When Ralph supports live-reloaded agent configuration for execution, its iteration-start callback should report the same current agent selected from that iteration's effective configuration rather than the original startup snapshot.

## Impact

Dashboards, CLI status output, logs, and embedding callers can attribute live work to the wrong model runner after a plan is updated mid-run. Operators may believe an iteration used one agent while a different agent made edits or consumed runtime/model resources.
