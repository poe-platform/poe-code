# Ralph model-only agent specifier runs with empty agent id

## Summary

The exported `@poe-code/ralph` workflow runner accepts a plan agent specifier containing only a model, such as `:openai/gpt-5.4`. Instead of rejecting the missing agent identifier, `runRalph()` executes the workflow by invoking its configured `runAgent()` implementation with `agent: ""` and `model: "openai/gpt-5.4"`.

## Reproduction

Create a disposable Vitest probe at `packages/ralph/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { RalphRunOptions } from "./types.js";
import { runRalph } from "./run/ralph.js";

function createRunFs(files: Record<string, string>): NonNullable<RalphRunOptions["fs"]> {
  const rawFs = createFsFromVolume(Volume.fromJSON(files, "/")).promises;
  return {
    readFile: (filePath: string, encoding: BufferEncoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
    writeFile: async (filePath: string, content: string) => {
      await rawFs.mkdir(path.dirname(filePath), { recursive: true });
      await rawFs.writeFile(filePath, content, { encoding: "utf8" });
    },
    readdir: (filePath: string) => rawFs.readdir(filePath) as Promise<string[]>,
    open: (filePath: string, flags: string) => rawFs.open(filePath, flags),
    stat: async (filePath: string) => {
      const stat = await rawFs.stat(filePath);
      return { isFile: () => stat.isFile(), isDirectory: () => stat.isDirectory(), mtimeMs: Number(stat.mtimeMs) };
    },
    unlink: async (filePath: string) => { await rawFs.unlink(filePath); },
    mkdir: async (filePath: string, options?: { recursive?: boolean }) => { await rawFs.mkdir(filePath, options); },
    rmdir: async (filePath: string) => { await rawFs.rmdir(filePath); },
    rename: async (oldPath: string, newPath: string) => {
      await rawFs.mkdir(path.dirname(newPath), { recursive: true });
      await rawFs.rename(oldPath, newPath);
    }
  } as RalphRunOptions["fs"];
}

describe("ralph model-only agent specifier", () => {
  it("runs a document agent with an empty agent id and inline model", async () => {
    const fs = createRunFs({
      "/repo/plan.md": ["---", "agent: :openai/gpt-5.4", "iterations: 1", "---", "", "Do work"].join("\n")
    });
    const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    const result = await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/plan.md",
      fs,
      runAgent
    });

    console.log(JSON.stringify({ result, input: runAgent.mock.calls[0]?.[0] }));
    expect(runAgent.mock.calls[0]?.[0]).toMatchObject({ agent: "", model: "openai/gpt-5.4" });
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/ralph/src/__probe__.test.ts --reporter verbose
rm -f packages/ralph/src/__probe__.test.ts
```

## Observed Behavior

The malformed plan executes one iteration and forwards an empty agent id to the configured executor:

```text
{"result":{"stopReason":"max_iterations","docPath":"/repo/plan.md","iterationsCompleted":1},"input":{"agent":"","prompt":"\nDo work","cwd":"/repo","model":"openai/gpt-5.4"}}
✓ packages/ralph/src/__probe__.test.ts > ralph model-only agent specifier > runs a document agent with an empty agent id and inline model
```

`normalizeAgents()` in `packages/ralph/src/run/ralph.ts` validates only that the complete frontmatter string is non-empty, then passes `:openai/gpt-5.4` into `parseAgentSpecifier()`. That shared parser returns an empty `agent` component with a populated `model`. During each workflow iteration, `runRalph()` forwards `specifier.agent` directly to the public `runAgent()` callback while separately forwarding `specifier.model`, so the invalid identifier reaches execution rather than being rejected during plan resolution.

## Expected Behavior

Ralph plan validation should reject inline agent specifiers whose agent portion is empty before starting a workflow iteration. A model suffix may override a valid agent, but it must not create an executable workflow entry with no agent identity.

## Impact

Malformed or generated Ralph documents can reach an executor with an empty agent identifier while the workflow records a completed iteration and archives the plan normally. Depending on the executor, this can launch an unintended default agent/provider, fail only after workflow state changes, or produce misleading run logs attributed to a missing role identity.
