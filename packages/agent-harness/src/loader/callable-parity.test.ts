import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { makeAgentModule, run } from "@poe-code/safe-js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

import { runHarnessPair } from "./run.js";

const mdPath = "/repo/harness/example.md";
const snapshotPath = "/snapshots/example.json";

function writePair(source: string): void {
  vol.fromJSON({
    [mdPath]: "---\nkind: test\nversion: 1\n---\n",
    "/repo/harness/example.ajs": source
  });
}

beforeEach(() => {
  vol.reset();
  vol.mkdirSync("/snapshots", { recursive: true });
});
afterEach(() => vol.reset());

describe("harness callable parity", () => {
  it.each(["parallel", "retry"] as const)("preserves spawn.%s", async (method) => {
    const expression =
      method === "parallel"
        ? 'await spawn.parallel([["codex", { prompt: "First" }], ["codex", { prompt: "Second" }]], { maxConcurrent: 2 })'
        : 'await spawn.retry("codex", { prompt: "First" }, { maxAttempts: 1, backoffMs: 0 })';
    const source = [
      'import { spawn } from "agent";',
      "export default async (frontmatter) => {",
      `  return JSON.stringify(${expression});`,
      "};"
    ].join("\n");
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "done",
      stderr: "",
      summary: "done",
      durationMs: 1
    }));
    const modules = { agent: makeAgentModule(spawnAgent) };
    const direct = await run(source, { modules, entryPointArgs: [{}] });
    expect(direct.ok).toBe(true);
    expect(spawnAgent).toHaveBeenCalledTimes(method === "parallel" ? 2 : 1);
    spawnAgent.mockClear();
    writePair(source);
    const harness = await runHarnessPair(mdPath, { snapshotPath, modulesFor: () => modules });
    expect(harness).toMatchObject({ ok: true, returnValue: direct.returnValue });
    expect(spawnAgent).toHaveBeenCalledTimes(method === "parallel" ? 2 : 1);
  });

  it("preserves chaining on a native async host function", async () => {
    const source = [
      'import { read } from "host";',
      "export default async (frontmatter) => {",
      '  return await read().then(value => value.concat(" result"));',
      "};"
    ].join("\n");
    let calls = 0;
    const read = async () => {
      calls += 1;
      return "example";
    };
    const modules = { host: { read } };
    expect(await run(source, { modules, entryPointArgs: [{}] })).toMatchObject({
      ok: true,
      returnValue: "example result"
    });
    expect(calls).toBe(1);
    writePair(source);
    await expect(
      runHarnessPair(mdPath, { snapshotPath, modulesFor: () => modules })
    ).resolves.toMatchObject({ ok: true, returnValue: "example result" });
    expect(calls).toBe(2);
  });

  const contracts = [
    {
      name: "sync promise results",
      read: () => Promise.resolve("example"),
      body: 'return await read().then(value => value.concat(" result"));',
      expected: "example result"
    },
    {
      name: "async chained callbacks",
      read: async () => "example",
      body: "return await read().then(async value => (await read()).concat(value));",
      expected: "exampleexample"
    },
    {
      name: "rejected async results",
      read: async () => {
        throw new Error("fixture failure");
      },
      body: "return await read().catch(error => error.message);",
      expected: "fixture failure"
    },
    {
      name: "synchronous returns",
      read: () => "example",
      body: 'return read().concat(" result");',
      expected: "example result"
    },
    {
      name: "synchronous throws",
      read: () => {
        throw new Error("fixture failure");
      },
      body: "try { read(); } catch (error) { return error.message; }",
      expected: "fixture failure"
    },
    {
      name: "async callable properties",
      read: Object.assign(() => "parent", { child: async () => "example" }),
      body: 'return await read.child().then(value => value.concat(" result"));',
      expected: "example result"
    },
    {
      name: "sync callable properties",
      read: Object.assign(() => "parent", { child: () => "example" }),
      body: 'return read.child().concat(" result");',
      expected: "example result"
    }
  ];

  describe.each(["record", "map"] as const)("%s modules", (kind) => {
    it.each(contracts)("preserves $name", async (contract) => {
      const source = `import { read } from "host"; export default async (frontmatter) => { ${contract.body} };`;
      const modules =
        kind === "record"
          ? { host: { read: contract.read } }
          : new Map([["host", new Map([["read", contract.read]])]]);
      expect(await run(source, { modules, entryPointArgs: [{}] })).toMatchObject({
        ok: true,
        returnValue: contract.expected
      });
      writePair(source);
      const options = { snapshotPath, modulesFor: () => modules };
      expect(
        await runHarnessPair(mdPath, {
          ...options,
          preserveSnapshotOnSuccess: true,
          snapshotIntervalMs: -1
        })
      ).toMatchObject({ ok: true, returnValue: contract.expected });
      expect(vol.existsSync(snapshotPath)).toBe(true);
      const persisted = vol.toJSON();
      vol.reset();
      vol.fromJSON(persisted);
      const unexpectedRead = () => {
        throw new Error("Completed host call repeated during recovery");
      };
      const unexpectedChild = () => {
        throw new Error("Completed helper repeated during recovery");
      };
      const restoredModules =
        kind === "record"
          ? { host: { read: Object.assign(unexpectedRead, { child: unexpectedChild }) } }
          : new Map([
              [
                "host",
                new Map([["read", Object.assign(unexpectedRead, { child: unexpectedChild })]])
              ]
            ]);
      expect(
        await runHarnessPair(mdPath, { snapshotPath, modulesFor: () => restoredModules })
      ).toMatchObject({ ok: true, returnValue: contract.expected });
      expect(vol.existsSync(snapshotPath)).toBe(false);
      expect(vol.existsSync(`${snapshotPath}.host-calls.json`)).toBe(false);
    });
  });

  it("preserves spawn.retry attempt behavior and logical usage", async () => {
    const source = [
      'import { spawn } from "agent";',
      "export default async (frontmatter) => {",
      '  return await spawn.retry("codex", { prompt: "First" }, { maxAttempts: 2, backoffMs: 0 }).then(result => result.summary);',
      "};"
    ].join("\n");
    const spawnAgent = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "retry",
        summary: "retry",
        durationMs: 1
      })
      .mockResolvedValue({
        exitCode: 0,
        stdout: "done",
        stderr: "",
        summary: "done",
        durationMs: 1
      });
    const directAgent = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "retry",
        summary: "retry",
        durationMs: 1
      })
      .mockResolvedValue({
        exitCode: 0,
        stdout: "done",
        stderr: "",
        summary: "done",
        durationMs: 1
      });
    expect(
      await run(source, { modules: { agent: makeAgentModule(directAgent) }, entryPointArgs: [{}] })
    ).toMatchObject({ ok: true, returnValue: "done" });
    expect(directAgent).toHaveBeenCalledTimes(2);
    writePair(source);
    expect(
      await runHarnessPair(mdPath, {
        snapshotPath,
        modulesFor: () => ({ agent: makeAgentModule(spawnAgent) })
      })
    ).toMatchObject({ ok: true, returnValue: "done", usage: { spawnCount: 1, attemptCount: 2 } });
    expect(spawnAgent).toHaveBeenCalledTimes(2);
  });

  it.each(["parallel", "retry", "async-chain"] as const)(
    "resumes after completed %s work without repeating it",
    async (method) => {
      const operation =
        method === "parallel"
          ? 'await spawn.parallel([["codex", { prompt: "First" }], ["codex", { prompt: "Second" }]], { maxConcurrent: 2 }).then(results => results.map(result => result.summary).join("|"))'
          : method === "retry"
            ? 'await spawn.retry("codex", { prompt: "First" }, { maxAttempts: 1, backoffMs: 0 }).then(result => result.summary)'
            : 'await read().then(value => value.concat(" result"))';
      const source = [
        'import { spawn } from "agent";',
        'import { read, wait } from "host";',
        "export default async (frontmatter) => {",
        `  const result = ${operation};`,
        "  await wait(result);",
        "  return result;",
        "};"
      ].join("\n");
      const expected =
        method === "parallel" ? "done|done" : method === "retry" ? "done" : "example result";
      const spawnAgent = vi.fn(async () => ({
        exitCode: 0,
        stdout: "done",
        stderr: "",
        summary: "done",
        durationMs: 1
      }));
      let reads = 0;
      const read = async () => {
        reads += 1;
        return "example";
      };
      const baseline = await run(source, {
        modules: {
          agent: makeAgentModule(spawnAgent),
          host: { read, wait: async () => undefined }
        },
        entryPointArgs: [{}]
      });
      expect(baseline).toMatchObject({ ok: true, returnValue: expected });
      spawnAgent.mockClear();
      reads = 0;
      writePair(source);
      const waiting = deferred<void>();
      const pending = deferred<void>();
      void pending.promise.catch(() => undefined);
      const controller = new AbortController();
      const original = runHarnessPair(mdPath, {
        snapshotPath,
        snapshotIntervalMs: -1,
        signal: controller.signal,
        modulesFor: () => ({
          agent: makeAgentModule(spawnAgent),
          host: {
            read,
            wait: async () => {
              waiting.resolve();
              return pending.promise;
            }
          }
        })
      });
      try {
        await Promise.race([
          waiting.promise,
          original.then(() => {
            throw new Error("Harness finished before the recovery gate");
          })
        ]);
        for (let index = 0; index < 3; index += 1)
          await new Promise<void>((resolve) => setImmediate(resolve));
        expect(vol.existsSync(snapshotPath)).toBe(true);
        expect(reads).toBe(method === "async-chain" ? 1 : 0);
        expect(spawnAgent).toHaveBeenCalledTimes(
          method === "parallel" ? 2 : method === "retry" ? 1 : 0
        );
        controller.abort();
        pending.reject(new Error("Interrupted fixture"));
        await expect(original).rejects.toMatchObject({ name: "AbortError" });
      } finally {
        controller.abort();
        pending.reject(new Error("Fixture cleanup"));
        await original.catch(() => undefined);
      }
      const persisted = vol.toJSON();
      vol.reset();
      vol.fromJSON(persisted);
      const resumedAgent = vi.fn(async () => {
        throw new Error("Completed agent repeated");
      });
      const resumedRead = vi.fn(async () => {
        throw new Error("Completed host call repeated");
      });
      const resumedWait = vi.fn(async () => undefined);
      const resumed = await runHarnessPair(mdPath, {
        snapshotPath,
        modulesFor: () => ({
          agent: makeAgentModule(resumedAgent),
          host: { read: resumedRead, wait: resumedWait }
        })
      });
      expect(resumed).toMatchObject({ ok: true, returnValue: expected, usage: { spawnCount: 0 } });
      expect(resumed.usage.attemptCount ?? 0).toBe(0);
      expect(resumedAgent).not.toHaveBeenCalled();
      expect(resumedRead).not.toHaveBeenCalled();
      expect(resumedWait).toHaveBeenCalledExactlyOnceWith(expected);
      expect(vol.existsSync(snapshotPath)).toBe(false);
      expect(vol.existsSync(`${snapshotPath}.host-calls.json`)).toBe(false);
    }
  );
});

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}
