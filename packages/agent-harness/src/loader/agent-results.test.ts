import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { dump, makeAgentModule, restore } from "@poe-code/safe-js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

const { runHarnessPair } = await import("./run.js");

describe("agent result policies through the harness loader", () => {
  beforeEach(() => vol.reset());
  afterEach(() => vi.restoreAllMocks());

  it("persists a first checked failure before any successful host call", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vol.fromJSON({
      "/repo/test.md": "---\nkind: stress\nversion: 1\n---\n",
      "/repo/test.ajs":
        'import {spawn} from "agent"; export default async(frontmatter)=>{await spawn("codex",{prompt:"Run",check:true});};'
    });
    const spawn = vi.fn(async () => ({
      exitCode: 7,
      stdout: "partial",
      stderr: "child failed",
      summary: "partial",
      durationMs: 1
    }));
    const options = {
      modulesFor: () => ({ agent: makeAgentModule(spawn) }),
      snapshotPath: "/repo/.poe-code/harnesses/failure/snapshot.json",
      snapshotPathIsDefault: true
    };

    await expect(runHarnessPair("/repo/test.md", options)).rejects.toMatchObject({
      message: expect.stringContaining("child failed")
    });
    expect(vol.existsSync(options.snapshotPath)).toBe(true);
    expect(spawn).toHaveBeenCalledOnce();
    const snapshot = JSON.parse(vol.readFileSync(options.snapshotPath, "utf8") as string);
    expect(snapshot.executionSemantics).toBe("jobs-v8");
    expect(() =>
      restore(snapshot, { source: vol.readFileSync("/repo/test.ajs", "utf8") as string })
    ).not.toThrow();
    expect(warning).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "retry",
      call: 'await spawn.retry("codex", {prompt:"Run"}, {maxAttempts:1,backoffMs:0})',
      expected: 7
    },
    {
      name: "checked retry",
      call: 'await spawn.retry("codex", {prompt:"Run",check:true}, {maxAttempts:1,backoffMs:0})',
      expected: ["AgentSpawnError", 7, true]
    },
    {
      name: "parallel",
      call: '(await spawn.parallel([["codex", {prompt:"Run"}]]))[0]',
      expected: 7
    },
    {
      name: "checked parallel",
      call: 'await spawn.parallel([["codex", {prompt:"Run"}]], {check:true})',
      expected: ["SpawnParallelError", 7, true]
    },
    {
      name: "aggregate",
      call: 'await spawn.parallel([["codex", {prompt:"Run",check:true}]], {failFast:false})',
      expected: ["AggregateError", 7, true]
    }
  ])("preserves $name behavior and replay", async ({ call, expected }) => {
    vol.fromJSON({
      "/repo/test.md": "---\nkind: stress\nversion: 1\n---\n",
      "/repo/test.ajs": `import {spawn} from "agent"; export default async(frontmatter)=>{try { const result=${call}; return result.exitCode; } catch(error) { return [error.name, error.result?.exitCode ?? error.errors?.[0].result.exitCode, error instanceof Error]; }};`
    });
    const spawn = vi.fn(async () => ({
      exitCode: 7,
      stdout: "partial",
      stderr: "failed",
      summary: "partial",
      durationMs: 1
    }));
    const options = {
      modulesFor: () => ({ agent: makeAgentModule(spawn) }),
      snapshotPath: "/repo/state.json"
    };
    let result = await runHarnessPair("/repo/test.md", options);
    expect(result).toMatchObject({ ok: true, returnValue: expected });
    for (let generation = 0; generation < 2; generation++) {
      vol.writeFileSync(options.snapshotPath, await dump(result));
      result = await runHarnessPair("/repo/test.md", options);
      expect(result).toMatchObject({ ok: true, returnValue: expected });
    }
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("preserves own function methods, cycles and aliases without invoking accessors", async () => {
    const accessor = vi.fn(() => () => "unsafe");
    const method = vi.fn(() => 7);
    const operation = Object.assign(() => 0, { again: method });
    Object.defineProperty(operation, "hidden", { value: method });
    Object.defineProperty(operation, "self", { value: operation });
    Object.defineProperty(operation, "unsafe", { get: accessor });
    vol.fromJSON({
      "/repo/test.md": "---\nkind: stress\nversion: 1\n---\n",
      "/repo/test.ajs":
        'import {operation} from "host"; export default async(frontmatter)=>{return [operation.self === operation, operation.hidden === operation.again, await operation.hidden(), typeof operation.unsafe];};'
    });

    const result = await runHarnessPair("/repo/test.md", {
      modulesFor: () => ({ host: { operation } })
    });

    expect(result).toMatchObject({ ok: true, returnValue: [true, true, 7, "undefined"] });
    expect(accessor).not.toHaveBeenCalled();
    expect(method).toHaveBeenCalledOnce();
  });
});
