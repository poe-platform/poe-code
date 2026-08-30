import { readFileSync } from "node:fs";
import os from "node:os";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

import { resolveRunLogDir } from "@poe-code/agent-harness-tools";
import {
  Budget,
  dump,
  inspectSnapshotMigration,
  lint,
  makeAgentModule,
  migrateSnapshot,
  run
} from "@poe-code/safe-js";
import type { Snapshot, SnapshotBackend } from "@poe-code/safe-js";

const mockedFileSystemState = vi.hoisted(() => ({
  failingWritePath: undefined as string | undefined,
  failingWritePathPrefix: undefined as string | undefined,
  failingWriteActualPath: undefined as string | undefined,
  collidingWritePathPrefix: undefined as string | undefined,
  collidingWriteTarget: undefined as string | undefined,
  collidingWritePath: undefined as string | undefined,
  symlinkRacePath: undefined as string | undefined,
  symlinkRaceTarget: undefined as string | undefined
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  function hasOwnErrorCode(error: unknown, code: string): boolean {
    return (
      error instanceof Error &&
      Object.prototype.hasOwnProperty.call(error, "code") &&
      (error as { code?: unknown }).code === code
    );
  }

  async function replaceWithSymlink(path: string, target: string): Promise<void> {
    try {
      await fs.promises.unlink(path);
    } catch (error) {
      if (!hasOwnErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
    await fs.promises.symlink(target, path);
  }

  return {
    ...fs.promises,
    async writeFile(
      path: Parameters<typeof fs.promises.writeFile>[0],
      data: Parameters<typeof fs.promises.writeFile>[1],
      options?: Parameters<typeof fs.promises.writeFile>[2]
    ) {
      const pathText = String(path);
      if (
        pathText === mockedFileSystemState.symlinkRacePath &&
        mockedFileSystemState.symlinkRaceTarget !== undefined
      ) {
        await replaceWithSymlink(pathText, mockedFileSystemState.symlinkRaceTarget);
      }

      if (
        path === mockedFileSystemState.failingWritePath ||
        (mockedFileSystemState.failingWritePathPrefix !== undefined &&
          pathText.startsWith(mockedFileSystemState.failingWritePathPrefix) &&
          pathText.endsWith(".tmp"))
      ) {
        mockedFileSystemState.failingWriteActualPath = pathText;
        await fs.promises.writeFile(path, "[", options);
        throw new Error("host call disk full");
      }

      if (
        mockedFileSystemState.collidingWritePathPrefix !== undefined &&
        mockedFileSystemState.collidingWriteTarget !== undefined &&
        pathText.startsWith(mockedFileSystemState.collidingWritePathPrefix) &&
        pathText.endsWith(".tmp")
      ) {
        mockedFileSystemState.collidingWritePath = pathText;
        await fs.promises.symlink(mockedFileSystemState.collidingWriteTarget, pathText);
      }

      return fs.promises.writeFile(path, data, options);
    },
    async rename(
      oldPath: Parameters<typeof fs.promises.rename>[0],
      newPath: Parameters<typeof fs.promises.rename>[1]
    ) {
      const newPathText = String(newPath);
      if (
        newPathText === mockedFileSystemState.symlinkRacePath &&
        mockedFileSystemState.symlinkRaceTarget !== undefined
      ) {
        await replaceWithSymlink(newPathText, mockedFileSystemState.symlinkRaceTarget);
      }

      return fs.promises.rename(oldPath, newPath);
    },
    default: fs.promises
  };
});

const { runHarnessPair } = await import("./run.js");
const api = await import("../index.js");

const expectedCoverageDemoReturnValue = {
  kind: "coverage-demo",
  version: 1,
  message: "coverage-demo:high:short-circuit-ok",
  numbers: {
    first: 1,
    second: 2,
    third: 3,
    optionalValue: 4,
    total: 18
  },
  branches: ["if", "else-if", "else"],
  comparison: true
};

describe("runHarnessPair", () => {
  it("persists completed migrated checkpoints instead of deleting their history", async () => {
    const source = "return 1;";
    const original = run(source);
    await original;
    const snapshot = JSON.parse(await dump(original));
    const targetSource =
      'import {effect} from "host"; export default async (frontmatter) => { await effect(); return import.meta.migration.value; };';
    vol.fromJSON({
      "/repo/migrated.md": "---\nkind: migrated\nversion: 1\n---\n",
      "/repo/migrated.ajs": targetSource
    });
    const migrated = migrateSnapshot(snapshot, {
      source,
      targetSource,
      state: { value: 2 },
      reconciliation: {
        checkpointDigest: inspectSnapshotMigration(snapshot, { source }).checkpointDigest,
        quiescent: true,
        calls: []
      }
    });
    const snapshotBackend = new MemorySnapshotBackend(migrated);
    const effect = vi.fn(async () => true);
    const options = {
      modulesFor: () => ({ host: { effect } }),
      snapshotBackend,
      snapshotPath: "/snapshots/migrated.json",
      resume: true
    };
    await expect(runHarnessPair("/repo/migrated.md", options)).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
    expect(snapshotBackend.removes).toBe(0);
    expect(snapshotBackend.writes).toHaveLength(1);
    expect(snapshotBackend.snapshot?.migration).toEqual(migrated.migration);
    await expect(runHarnessPair("/repo/migrated.md", options)).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
    expect(effect).toHaveBeenCalledOnce();
    expect(snapshotBackend.writes).toHaveLength(2);
  });

  beforeEach(() => {
    vol.reset();
    mockedFileSystemState.failingWritePath = undefined;
    mockedFileSystemState.failingWritePathPrefix = undefined;
    mockedFileSystemState.failingWriteActualPath = undefined;
    mockedFileSystemState.collidingWritePathPrefix = undefined;
    mockedFileSystemState.collidingWriteTarget = undefined;
    mockedFileSystemState.collidingWritePath = undefined;
    mockedFileSystemState.symlinkRacePath = undefined;
    mockedFileSystemState.symlinkRaceTarget = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers a budget failure without repeating completed effects", async () => {
    vol.fromJSON({
      "/repo/recovery.md": "---\nkind: recovery\nversion: 1\n---\n",
      "/repo/recovery.ajs":
        'import {effect} from "test"; export default async function (frontmatter) { await effect(); let total=0; for(let index=0; index<50; index++) total += index; return total; }'
    });
    const effect = vi.fn(async () => "done");
    const options = { modulesFor: () => ({ test: { effect } }), snapshotPath: "/repo/state.json" };
    await expect(
      runHarnessPair("/repo/recovery.md", { ...options, budget: new Budget({ maxSteps: 50 }) })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    await expect(
      runHarnessPair("/repo/recovery.md", {
        ...options,
        resume: true,
        budget: new Budget({ maxSteps: 5000 })
      })
    ).resolves.toMatchObject({ ok: true, returnValue: 1225 });
    expect(effect).toHaveBeenCalledOnce();
  });

  it("is re-exported from the package entrypoint", () => {
    expect(api.runHarnessPair).toBe(runHarnessPair);
  });

  it("runs the coverage demo template with a stub agent module and returns a stable exact value", async () => {
    const mdPath = "/repo/templates/coverage-demo/coverage-demo.md";
    vol.fromJSON({
      [mdPath]: readCoverageDemoTemplate("coverage-demo.md"),
      "/repo/templates/coverage-demo/coverage-demo.ajs":
        readCoverageDemoTemplate("coverage-demo.ajs")
    });

    const spawn = vi.fn();
    const first = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        agent: {
          spawn
        }
      })
    });
    const second = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        agent: {
          spawn
        }
      })
    });

    expect(first).toMatchObject({
      ok: true,
      returnValue: expectedCoverageDemoReturnValue
    });
    expect(second).toMatchObject({
      ok: true,
      returnValue: expectedCoverageDemoReturnValue
    });
    expect(first.ok ? first.returnValue : undefined).toEqual(
      second.ok ? second.returnValue : undefined
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects a saved coverage demo snapshot after the .ajs source changes", async () => {
    const mdPath = "/repo/templates/coverage-demo/coverage-demo.md";
    const ajsPath = "/repo/templates/coverage-demo/coverage-demo.ajs";
    const snapshotPath = "/snapshots/coverage-demo.json";
    const originalSource = readCoverageDemoTemplate("coverage-demo.ajs");
    vol.fromJSON({
      [mdPath]: readCoverageDemoTemplate("coverage-demo.md"),
      [ajsPath]: originalSource
    });

    const first = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        agent: {
          spawn: vi.fn()
        }
      })
    });
    expect(first).toMatchObject({
      ok: true,
      returnValue: expectedCoverageDemoReturnValue
    });
    vol.mkdirSync(dirname(snapshotPath), { recursive: true });
    vol.writeFileSync(snapshotPath, JSON.stringify(first.snapshot, null, 2));
    vol.writeFileSync(
      ajsPath,
      originalSource.replace("total: merged.total", "total: merged.total + 1")
    );

    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({
          agent: {
            spawn: vi.fn()
          }
        }),
        snapshotPath
      })
    ).rejects.toThrow("source changed since snapshot was taken");
  });

  it("keeps default snapshots isolated for documents sharing a basename", async () => {
    const firstPath = "/repo/a/shared.md";
    const secondPath = "/repo/b/shared.md";
    const source = [
      'import { step } from "host";',
      "export default async (frontmatter) => {",
      "  const first = await step('first');",
      "  const second = await step('second');",
      "  return first.concat('|').concat(second);",
      "};"
    ].join("\n");
    vol.fromJSON({
      [firstPath]: "---\nkind: shared\nversion: 1\n---\n",
      "/repo/a/shared.ajs": source,
      [secondPath]: "---\nkind: shared\nversion: 1\n---\n",
      "/repo/b/shared.ajs": source
    });

    const firstCall = createDeferred<string>();
    const secondCall = createDeferred<string>();
    const controller = new AbortController();
    const firstRun = runHarnessPair(firstPath, {
      modulesFor: () => ({
        host: {
          async step(name: string) {
            return name === "first" ? firstCall.promise : secondCall.promise;
          }
        }
      }),
      signal: controller.signal,
      snapshotIntervalMs: -1
    });

    await flushMicrotasks();
    firstCall.resolve("first-document-secret");
    await flushMicrotasks();
    controller.abort();
    secondCall.reject(new Error("aborted"));
    await expect(firstRun).rejects.toMatchObject({ name: "AbortError" });

    const secondCalls: string[] = [];
    const secondRun = await runHarnessPair(secondPath, {
      modulesFor: () => ({
        host: {
          async step(name: string) {
            secondCalls.push(name);
            return `second-document-${name}`;
          }
        }
      })
    });

    expect(secondCalls).toEqual(["first", "second"]);
    expect(secondRun).toMatchObject({
      ok: true,
      returnValue: "second-document-first|second-document-second"
    });
  });

  it("preserves the replay journal when a new host call write fails", async () => {
    const mdPath = "/repo/harness/replay.md";
    const snapshotPath = "/snapshots/replay.json";
    const storePath = `${snapshotPath}.host-calls.json`;
    const priorRecords = JSON.stringify([{ key: "host.step", args: ["old"], result: "preserved" }]);
    vol.fromJSON({
      [mdPath]: "---\nkind: replay\nversion: 1\n---\n",
      "/repo/harness/replay.ajs": [
        'import { step } from "host";',
        "export default async (frontmatter) => await step('new');"
      ].join("\n"),
      [storePath]: priorRecords
    });
    mockedFileSystemState.failingWritePathPrefix = `${storePath}.`;

    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({
          host: {
            async step() {
              return "new";
            }
          }
        }),
        snapshotPath
      })
    ).rejects.toThrow("host call disk full");

    expect(vol.readFileSync(storePath, "utf8")).toBe(priorRecords);
    expect(mockedFileSystemState.failingWriteActualPath).toMatch(
      new RegExp(`^${storePath.replaceAll(".", "\\.")}\\.`)
    );
    expect(vol.existsSync(mockedFileSystemState.failingWriteActualPath ?? "")).toBe(false);
  });

  it("does not follow a preexisting legacy host-call temp path symlink", async () => {
    const mdPath = "/repo/harness/replay.md";
    const snapshotPath = "/snapshots/replay.json";
    const storePath = `${snapshotPath}.host-calls.json`;
    vol.fromJSON({
      [mdPath]: "---\nkind: replay\nversion: 1\n---\n",
      "/repo/harness/replay.ajs": [
        'import { step } from "host";',
        "export default async (frontmatter) => await step('new');"
      ].join("\n"),
      "/outside/host-calls.tmp": "outside-state\n"
    });
    vol.mkdirSync(dirname(storePath), { recursive: true });
    vol.symlinkSync("/outside/host-calls.tmp", `${storePath}.tmp`);

    await runHarnessPair(mdPath, {
      modulesFor: () => ({
        host: {
          async step() {
            return "new";
          }
        }
      }),
      snapshotPath,
      preserveSnapshotOnSuccess: true
    });

    expect(vol.readFileSync("/outside/host-calls.tmp", "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync(storePath).isSymbolicLink()).toBe(false);
    expect(JSON.parse(vol.readFileSync(storePath, "utf8") as string)).toEqual([
      { key: "host.step", args: ["new"], result: "new", asynchronous: true }
    ]);
  });

  it("does not remove a colliding host-call temp symlink it did not create", async () => {
    const mdPath = "/repo/harness/replay.md";
    const snapshotPath = "/snapshots/replay.json";
    const storePath = `${snapshotPath}.host-calls.json`;
    vol.fromJSON({
      [mdPath]: "---\nkind: replay\nversion: 1\n---\n",
      "/repo/harness/replay.ajs": [
        'import { step } from "host";',
        "export default async (frontmatter) => await step('new');"
      ].join("\n"),
      "/outside/host-calls.tmp": "outside-state\n"
    });
    vol.mkdirSync(dirname(storePath), { recursive: true });
    mockedFileSystemState.collidingWritePathPrefix = `${storePath}.`;
    mockedFileSystemState.collidingWriteTarget = "/outside/host-calls.tmp";

    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({
          host: {
            async step() {
              return "new";
            }
          }
        }),
        snapshotPath,
        preserveSnapshotOnSuccess: true
      })
    ).rejects.toThrow("EEXIST");

    expect(mockedFileSystemState.collidingWritePath).toBeDefined();
    expect(vol.readFileSync("/outside/host-calls.tmp", "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync(mockedFileSystemState.collidingWritePath as string).isSymbolicLink()).toBe(
      true
    );
    expect(vol.existsSync(storePath)).toBe(false);
  });

  it("lints the coverage demo .ajs without diagnostics", () => {
    const ajsPath = "/repo/templates/coverage-demo/coverage-demo.ajs";
    expect(
      lint(readCoverageDemoTemplate("coverage-demo.ajs"), {
        allowedExportNames: ["schema"],
        filename: ajsPath,
        modules: {
          agent: ["spawn"],
          schema: ["S"]
        }
      })
    ).toEqual([]);
  });

  it("validates frontmatter, invokes the default export with the validated value, and returns its result", async () => {
    const mdPath = "/repo/harness/review.md";
    vol.fromJSON({
      [mdPath]: ["---", "kind: review", "version: 1", "title: Build", "---", "", "# Review"].join(
        "\n"
      ),
      "/repo/harness/review.ajs": [
        'import { check } from "test";',
        'import { S } from "schema";',
        "export const schema = S.Object({",
        "  kind: S.String(),",
        "  version: S.Number(),",
        "  title: S.String(),",
        "  retries: S.Optional(S.Number({ default: 2 }))",
        "});",
        "export default async (frontmatter) => await check(frontmatter, import.meta);"
      ].join("\n")
    });

    const check = vi.fn((frontmatter, meta) => ({
      body: meta.body,
      dirname: meta.dirname,
      filename: meta.filename,
      frontmatter,
      kind: meta.kind,
      version: meta.version
    }));
    const modulesFor = vi.fn(() => ({
      test: {
        check
      }
    }));

    const result = await runHarnessPair(mdPath, { modulesFor });

    expect(modulesFor).toHaveBeenCalledWith(
      {
        kind: "review",
        retries: 2,
        title: "Build",
        version: 1
      },
      {
        body: "\n# Review",
        dirname: dirname(mdPath),
        filename: mdPath,
        kind: "review",
        version: 1
      }
    );
    expect(result).toMatchObject({
      ok: true,
      returnValue: {
        body: "\n# Review",
        dirname: dirname(mdPath),
        filename: mdPath,
        frontmatter: {
          kind: "review",
          retries: 2,
          title: "Build",
          version: 1
        },
        kind: "review",
        version: 1
      }
    });
  });

  it("returns zero usage when a harness run produces no spawns", async () => {
    const mdPath = "/repo/harness/no-spawns.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: test\nversion: 1\n---\n",
      "/repo/harness/no-spawns.ajs": "export default (frontmatter) => true;\n"
    });

    await expect(runHarnessPair(mdPath, { modulesFor: () => ({}) })).resolves.toMatchObject({
      ok: true,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        spawnCount: 0
      }
    });
  });

  it("totals usage for every spawn produced by a harness run and emits the totalled event", async () => {
    const mdPath = "/repo/harness/usage.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: test\nversion: 1\n---\n",
      "/repo/harness/usage.ajs": [
        'import { spawn } from "agent";',
        "export default async (frontmatter) => {",
        '  await spawn("codex", { prompt: "one" });',
        '  await spawn("codex", { prompt: "two" });',
        '  await spawn("codex", { prompt: "three" });',
        '  return "done";',
        "};"
      ].join("\n")
    });
    const usages = [
      { inputTokens: 10, outputTokens: 1, cachedTokens: 2, costUsd: 0.01 },
      { inputTokens: 20, outputTokens: 2, cachedTokens: 3 },
      { inputTokens: 30, outputTokens: 4, cachedTokens: 5, costUsd: 0.04 }
    ];
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "done",
      durationMs: 1,
      usage: usages.shift()
    }));
    const events: unknown[] = [];

    const result = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        agent: makeAgentModule(spawnAgent)
      }),
      onEvent: (event) => events.push(event)
    });

    expect(result).toMatchObject({
      ok: true,
      usage: {
        inputTokens: 60,
        outputTokens: 7,
        cachedTokens: 10,
        costUsd: 0.05,
        spawnCount: 3
      }
    });
    expect(events).toContainEqual({
      name: "harness.usage.totalled",
      payload: {
        inputTokens: 60,
        outputTokens: 7,
        cachedTokens: 10,
        costUsd: 0.05,
        spawnCount: 3
      }
    });
  });

  it("counts retries as attempts without inflating logical spawn count", async () => {
    const mdPath = "/repo/harness/retry-usage.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: test\nversion: 1\n---\n",
      "/repo/harness/retry-usage.ajs": [
        'import { spawn } from "agent";',
        "export default async (frontmatter) => {",
        '  await spawn("codex", { prompt: "one" });',
        '  return "done";',
        "};"
      ].join("\n")
    });
    const spawnAgent = vi
      .fn()
      .mockResolvedValueOnce({
        ...createSpawnResult({ inputTokens: 2, outputTokens: 1 }),
        exitCode: 1,
        stderr: "temporary"
      })
      .mockResolvedValueOnce(createSpawnResult({ inputTokens: 3, outputTokens: 2 }));

    const result = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        agent: makeAgentModule(spawnAgent, { defaultRetry: { maxAttempts: 2, backoffMs: 0 } })
      })
    });

    expect(result).toMatchObject({
      ok: true,
      usage: {
        inputTokens: 5,
        outputTokens: 3,
        cachedTokens: 0,
        spawnCount: 1,
        attemptCount: 2
      }
    });
  });

  it("counts thrown transport retries as attempts", async () => {
    const mdPath = "/repo/harness/thrown-retry-usage.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: test\nversion: 1\n---\n",
      "/repo/harness/thrown-retry-usage.ajs": [
        'import { spawn } from "agent";',
        "export default async (frontmatter) => {",
        '  await spawn("codex", { prompt: "one" });',
        '  return "done";',
        "};"
      ].join("\n")
    });
    const spawnAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("transport unavailable"))
      .mockResolvedValueOnce(createSpawnResult({ inputTokens: 3, outputTokens: 2 }));

    const result = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        agent: makeAgentModule(spawnAgent, { defaultRetry: { maxAttempts: 2, backoffMs: 0 } })
      })
    });

    expect(result).toMatchObject({
      ok: true,
      usage: {
        inputTokens: 3,
        outputTokens: 2,
        cachedTokens: 0,
        spawnCount: 1,
        attemptCount: 2
      }
    });
  });

  it("does not count invalid retry policies as logical spawns", async () => {
    const mdPath = "/repo/harness/invalid-retry-usage.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: test\nversion: 1\n---\n",
      "/repo/harness/invalid-retry-usage.ajs": [
        'import { spawn } from "agent";',
        "export default async (frontmatter) => {",
        "  try {",
        '    await spawn.retry("codex", { prompt: "one" }, { maxAttempts: 6, backoffMs: 0 });',
        "  } catch ({ message }) {",
        "    return message;",
        "  }",
        "};"
      ].join("\n")
    });
    const spawnAgent = vi.fn();

    const result = await runHarnessPair(mdPath, {
      modulesFor: () => ({ agent: makeAgentModule(spawnAgent) })
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue: "Agent spawn retry maxAttempts must not exceed 5.",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        spawnCount: 0
      }
    });
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it("leaves cost undefined when no spawn reports cost and sums cost when any spawn reports it", async () => {
    const mdPath = "/repo/harness/cost-optional.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: test\nversion: 1\n---\n",
      "/repo/harness/cost-optional.ajs": [
        'import { spawn } from "agent";',
        "export default async (frontmatter) => {",
        '  await spawn("codex", { prompt: "one" });',
        '  await spawn("codex", { prompt: "two" });',
        '  return "done";',
        "};"
      ].join("\n")
    });

    const noCost = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        agent: makeAgentModule(
          vi
            .fn()
            .mockResolvedValueOnce(createSpawnResult({ inputTokens: 1, outputTokens: 2 }))
            .mockResolvedValueOnce(createSpawnResult({ inputTokens: 3, outputTokens: 4 }))
        )
      })
    });
    expect(noCost.usage).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      cachedTokens: 0,
      spawnCount: 2
    });

    const oneCost = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        agent: makeAgentModule(
          vi
            .fn()
            .mockResolvedValueOnce(createSpawnResult({ inputTokens: 1, outputTokens: 2 }))
            .mockResolvedValueOnce(
              createSpawnResult({ inputTokens: 3, outputTokens: 4, costUsd: 0.02 })
            )
        )
      })
    });
    expect(oneCost.usage).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      cachedTokens: 0,
      costUsd: 0.02,
      spawnCount: 2
    });
  });

  it("resets usage aggregation between runs in the same process", async () => {
    const mdPath = "/repo/harness/reset-usage.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: test\nversion: 1\n---\n",
      "/repo/harness/reset-usage.ajs": [
        'import { spawn } from "agent";',
        "export default async (frontmatter) => {",
        '  await spawn("codex", { prompt: "one" });',
        '  return "done";',
        "};"
      ].join("\n")
    });

    const first = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        agent: makeAgentModule(
          vi.fn(async () => createSpawnResult({ inputTokens: 10, outputTokens: 5, costUsd: 0.03 }))
        )
      })
    });
    const second = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        agent: makeAgentModule(
          vi.fn(async () => createSpawnResult({ inputTokens: 2, outputTokens: 1 }))
        )
      })
    });

    expect(first.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 0,
      costUsd: 0.03,
      spawnCount: 1
    });
    expect(second.usage).toEqual({
      inputTokens: 2,
      outputTokens: 1,
      cachedTokens: 0,
      spawnCount: 1
    });
  });

  it("reports schema-derived frontmatter field info diagnostics without failing the run", async () => {
    const mdPath = "/repo/harness/frontmatter-fields.md";
    const onDiagnostics = vi.fn();
    vol.fromJSON({
      [mdPath]: ["---", "a: alpha", "b: beta", "---", "", "# Frontmatter fields"].join("\n"),
      "/repo/harness/frontmatter-fields.ajs": [
        'import { S } from "schema";',
        "export const schema = S.Object({ a: S.String(), b: S.String() });",
        "export default (frontmatter) => frontmatter.a;"
      ].join("\n")
    });

    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({}),
        onDiagnostics
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "alpha"
    });
    expect(onDiagnostics).toHaveBeenCalledWith([
      expect.objectContaining({
        code: "AS-FRONTMATTER-FIELD-UNUSED",
        message: "Frontmatter field 'b' is declared by the schema but never read.",
        severity: "info"
      })
    ]);
  });

  it("reports fix metadata without rewriting the harness script when fix is omitted", async () => {
    const mdPath = "/repo/harness/no-fix.md";
    const ajsPath = "/repo/harness/no-fix.ajs";
    const ajsSource = [
      'import { log } from "log";',
      "export default (frontmatter) => true;",
      ""
    ].join("\n");
    const onDiagnostics = vi.fn();
    vol.fromJSON({
      [mdPath]: ["---", "kind: test", "version: 1", "---", "", "# No fix"].join("\n"),
      [ajsPath]: ajsSource
    });

    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({
          log: {
            log: vi.fn()
          }
        }),
        onDiagnostics
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: true
    });

    expect(onDiagnostics).toHaveBeenCalledWith([
      expect.objectContaining({
        code: "AS-UNUSED-IMPORT",
        fix: {
          range: [0, 'import { log } from "log";\n'.length],
          replacement: ""
        }
      })
    ]);
    expect(vol.readFileSync(ajsPath, "utf8")).toBe(ajsSource);
  });

  it("writes fixed harness scripts before execution when fix is explicit", async () => {
    const mdPath = "/repo/harness/fix.md";
    const ajsPath = "/repo/harness/fix.ajs";
    vol.fromJSON({
      [mdPath]: ["---", "kind: test", "version: 1", "---", "", "# Fix"].join("\n"),
      [ajsPath]: ['import { log } from "log";', "export default (frontmatter) => true;", ""].join(
        "\n"
      )
    });

    await expect(
      runHarnessPair(mdPath, {
        fix: true,
        modulesFor: () => ({
          log: {
            log: vi.fn()
          }
        })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: true
    });

    expect(vol.readFileSync(ajsPath, "utf8")).toBe("export default (frontmatter) => true;\n");
  });

  it("does not follow a harness script symlink inserted before fixed source publish", async () => {
    const mdPath = "/repo/harness/fix-race.md";
    const ajsPath = "/repo/harness/fix-race.ajs";
    vol.fromJSON({
      [mdPath]: ["---", "kind: test", "version: 1", "---", "", "# Fix race"].join("\n"),
      [ajsPath]: ['import { log } from "log";', "export default (frontmatter) => true;", ""].join(
        "\n"
      ),
      "/outside/fix-race.ajs": "outside-state\n"
    });
    mockedFileSystemState.symlinkRacePath = ajsPath;
    mockedFileSystemState.symlinkRaceTarget = "/outside/fix-race.ajs";

    await expect(
      runHarnessPair(mdPath, {
        fix: true,
        modulesFor: () => ({
          log: {
            log: vi.fn()
          }
        })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: true
    });

    expect(vol.readFileSync("/outside/fix-race.ajs", "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync(ajsPath).isSymbolicLink()).toBe(false);
    expect(vol.readFileSync(ajsPath, "utf8")).toBe("export default (frontmatter) => true;\n");
  });

  it("passes raw frontmatter through when the script does not export a schema", async () => {
    const mdPath = "/repo/harness/raw.md";
    vol.fromJSON({
      [mdPath]: ["---", "kind: raw", "version: 1", "title: 123", "---", "", "# Raw"].join("\n"),
      "/repo/harness/raw.ajs": "export default (frontmatter) => frontmatter;"
    });

    await expect(runHarnessPair(mdPath, { modulesFor: () => ({}) })).resolves.toMatchObject({
      ok: true,
      returnValue: {
        kind: "raw",
        title: 123,
        version: 1
      }
    });
  });

  it("throws validation errors with the md path and field path and leaves snapshots untouched", async () => {
    const mdPath = "/repo/harness/invalid.md";
    const snapshotPath = "/snapshots/invalid.json";
    vol.fromJSON({
      [mdPath]: ["---", "kind: review", "version: 1", "title: 123", "---", "", "# Invalid"].join(
        "\n"
      ),
      "/repo/harness/invalid.ajs": [
        'import { S } from "schema";',
        "export const schema = S.Object({ title: S.String() });",
        "export default (frontmatter) => frontmatter;"
      ].join("\n")
    });

    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({}),
        snapshotPath
      })
    ).rejects.toThrow(`${mdPath} (title): Expected string at title, got integer`);

    expect(vol.existsSync(snapshotPath)).toBe(false);
  });

  it("throws a lint error when the .ajs is missing a default export", async () => {
    const mdPath = "/repo/harness/no-default.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: review\nversion: 1\n---\n",
      "/repo/harness/no-default.ajs": [
        'import { S } from "schema";',
        "export const schema = S.Object({ kind: S.String(), version: S.Number() });"
      ].join("\n")
    });

    await expect(runHarnessPair(mdPath, { modulesFor: () => ({}) })).rejects.toMatchObject({
      name: "LintError",
      diagnostics: [expect.objectContaining({ code: "AS-EXPORT-DEFAULT-MISSING" })]
    });
  });

  it("allows a top-level return warning in .ajs and still succeeds", async () => {
    const mdPath = "/repo/harness/top-return.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: review\nversion: 1\n---\n",
      "/repo/harness/top-return.ajs": "export default (frontmatter) => 'ok';\nreturn 'ignored';"
    });

    await expect(runHarnessPair(mdPath, { modulesFor: () => ({}) })).resolves.toMatchObject({
      ok: true,
      returnValue: "ok"
    });
  });

  it("passes caller-provided allowed globals to lint", async () => {
    const mdPath = "/repo/harness/allowed-global.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: review\nversion: 1\n---\n",
      "/repo/harness/allowed-global.ajs":
        "const unused = () => Custom.x;\nexport default (frontmatter) => 'ok';"
    });

    await expect(
      runHarnessPair(mdPath, {
        allowedGlobals: ["Custom"],
        modulesFor: () => ({})
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "ok"
    });
  });

  it("resumes from an existing snapshotPath at the next host call", async () => {
    const mdPath = "/repo/harness/resume.md";
    const snapshotPath = "/snapshots/resume.json";
    vol.fromJSON({
      [mdPath]: "---\nkind: resume\nversion: 1\n---\n",
      "/repo/harness/resume.ajs": [
        'import { step } from "host";',
        "export default async (frontmatter) => {",
        "  const first = await step('first');",
        "  const second = await step('second');",
        "  return first.concat('|').concat(second);",
        "};"
      ].join("\n")
    });

    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const firstController = new AbortController();
    const firstCalls: string[] = [];
    const firstRun = runHarnessPair(mdPath, {
      modulesFor: () => ({
        host: {
          async step(name: string) {
            firstCalls.push(name);
            return name === "first" ? first.promise : second.promise;
          }
        }
      }),
      signal: firstController.signal,
      snapshotIntervalMs: -1,
      snapshotPath
    });

    await flushMicrotasks();
    expect(firstCalls).toEqual(["first"]);

    first.resolve("alpha");
    await flushMicrotasks();

    expect(firstCalls).toEqual(["first", "second"]);
    expect(vol.existsSync(snapshotPath)).toBe(true);

    firstController.abort();
    second.reject(new Error("aborted"));
    await expect(firstRun).rejects.toMatchObject({
      name: "AbortError"
    });

    const secondCalls: string[] = [];
    const resumed = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        host: {
          async step(name: string) {
            secondCalls.push(name);
            return "beta";
          }
        }
      }),
      snapshotPath
    });

    expect(secondCalls).toEqual(["second"]);
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: "alpha|beta"
    });
  });

  it("restores snapshotted clock state so replay keeps the same time.now sequence", async () => {
    const mdPath = "/repo/harness/clock.md";
    const snapshotPath = "/snapshots/clock.json";
    vol.fromJSON({
      [mdPath]: "---\nkind: clock\nversion: 1\n---\n",
      "/repo/harness/clock.ajs": [
        'import * as time from "time";',
        'import { wait } from "host";',
        "export default async (frontmatter) => {",
        "  const first = time.now();",
        "  await wait('first');",
        "  const second = time.now();",
        "  await wait('second');",
        "  const third = time.now();",
        "  return String(first).concat('|').concat(String(second)).concat('|').concat(String(third));",
        "};"
      ].join("\n")
    });

    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const controller = new AbortController();
    const firstCalls: string[] = [];
    let now = 1_000;
    const firstRun = runHarnessPair(mdPath, {
      clock: {
        now: () => now
      },
      modulesFor: () => ({
        host: {
          async wait(name: string) {
            firstCalls.push(name);
            return name === "first" ? first.promise : second.promise;
          }
        }
      }),
      signal: controller.signal,
      snapshotIntervalMs: -1,
      snapshotPath
    });

    await flushMicrotasks();
    expect(firstCalls).toEqual(["first"]);

    now = 31_000;
    first.resolve("alpha");
    await flushMicrotasks();

    expect(firstCalls).toEqual(["first", "second"]);
    expect(JSON.parse(vol.readFileSync(snapshotPath, "utf8") as string)).toMatchObject({
      clock: {
        next: 31_001
      }
    });

    controller.abort();
    second.reject(new Error("aborted"));
    await expect(firstRun).rejects.toMatchObject({
      name: "AbortError"
    });

    const secondCalls: string[] = [];
    const resumed = await runHarnessPair(mdPath, {
      clock: {
        now: () => 9_999
      },
      modulesFor: () => ({
        host: {
          async wait(name: string) {
            secondCalls.push(name);
            return "beta";
          }
        }
      }),
      snapshotPath
    });

    expect(secondCalls).toEqual(["second"]);
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: "1000|31000|31001"
    });
  });

  it("does not restore clock state whose next value is only inherited", async () => {
    const mdPath = "/repo/harness/inherited-clock.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: inherited-clock\nversion: 1\n---\n",
      "/repo/harness/inherited-clock.ajs": [
        'import * as time from "time";',
        'import { wait } from "host";',
        "export default async (frontmatter) => {",
        "  await wait('first');",
        "  await wait('second');",
        "  return String(time.now());",
        "};"
      ].join("\n")
    });

    const snapshotBackend = new MemorySnapshotBackend();
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const controller = new AbortController();
    const firstRun = runHarnessPair(mdPath, {
      clock: {
        now: () => 1_000
      },
      modulesFor: () => ({
        host: {
          async wait(name: string) {
            return name === "first" ? first.promise : second.promise;
          }
        }
      }),
      signal: controller.signal,
      snapshotBackend,
      snapshotIntervalMs: -1
    });

    await flushMicrotasks();
    first.resolve("done");
    await flushMicrotasks();

    expect(snapshotBackend.snapshot).toMatchObject({
      sourceHash: expect.any(String)
    });
    snapshotBackend.snapshot = {
      ...snapshotBackend.snapshot,
      clock: Object.create({ next: 42 }) as Snapshot["clock"]
    } as Snapshot;

    controller.abort();
    second.reject(new Error("aborted"));
    await expect(firstRun).rejects.toMatchObject({
      name: "AbortError"
    });

    const resumed = await runHarnessPair(mdPath, {
      clock: {
        now: () => 1_000
      },
      modulesFor: () => ({
        host: {
          async wait() {
            return "done";
          }
        }
      }),
      snapshotBackend
    });

    expect(resumed).toMatchObject({
      ok: true,
      returnValue: "1000"
    });
  });

  it("uses the injected clock source for each live time.now call", async () => {
    const mdPath = "/repo/harness/live-clock.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: live-clock\nversion: 1\n---\n",
      "/repo/harness/live-clock.ajs": [
        'import * as time from "time";',
        "export default (frontmatter) => {",
        "  const first = time.now();",
        "  const second = time.now();",
        "  return String(first).concat('|').concat(String(second));",
        "};"
      ].join("\n")
    });

    const values = [1_000, 5_000];
    const result = await runHarnessPair(mdPath, {
      clock: {
        now: () => values.shift() ?? 9_000
      },
      modulesFor: () => ({})
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue: "1000|5000"
    });
  });

  it.each(
    [undefined, 123].flatMap((randomSeed) =>
      [false, true].flatMap((durable) =>
        [false, true].flatMap((missingSidecar) =>
          [false, true].map((customTime) => ({ randomSeed, durable, missingSidecar, customTime }))
        )
      )
    )
  )(
    "keeps time.uuid and time.now stable across snapshot replay with seed $randomSeed (durable: $durable, missing sidecar: $missingSidecar, custom time: $customTime)",
    async ({ randomSeed, durable, missingSidecar, customTime }) => {
      const injectedTime = customTime ? { time: { now: () => 7000, uuid: () => "custom" } } : {};
      const mdPath = "/repo/harness/stable-id.md";
      const snapshotPath = "/snapshots/stable-id.json";
      const script = [
        'import * as time from "time";',
        'import { wait } from "host";',
        "export default async (frontmatter) => {",
        "  const first = time.uuid().concat('@').concat(String(time.now())).concat('#').concat(String(Math.random()));",
        "  await wait('first');",
        "  const second = time.uuid().concat('@').concat(String(time.now())).concat('#').concat(String(Math.random()));",
        "  await wait('second');",
        "  const third = time.uuid().concat('@').concat(String(time.now())).concat('#').concat(String(Math.random()));",
        "  return first.concat('|').concat(second).concat('|').concat(third);",
        "};"
      ].join("\n");
      vol.fromJSON({
        [mdPath]: "---\nkind: stable-id\nversion: 1\n---\n",
        "/repo/harness/stable-id.ajs": script
      });

      const first = createDeferred<string>();
      const second = createDeferred<string>();
      const controller = new AbortController();
      const firstRun = runHarnessPair(mdPath, {
        clock: {
          now: () => 5_000
        },
        modulesFor: () => ({
          ...injectedTime,
          host: {
            async wait(name: string) {
              return name === "first" ? first.promise : second.promise;
            }
          }
        }),
        randomSeed,
        signal: controller.signal,
        snapshotIntervalMs: -1,
        snapshotPath
      });

      await flushMicrotasks();
      first.resolve("alpha");
      await flushMicrotasks();

      const checkpoint = vol.readFileSync(snapshotPath, "utf8") as string;

      controller.abort();
      second.reject(new Error("aborted"));
      await expect(firstRun).rejects.toMatchObject({
        name: "AbortError"
      });

      if (durable) vol.writeFileSync(snapshotPath, checkpoint);
      if (missingSidecar) vol.unlinkSync(`${snapshotPath}.host-calls.json`);

      const saved = JSON.parse(vol.readFileSync(snapshotPath, "utf8") as string);
      expect(saved.random?.seed).toEqual(expect.any(Number));

      const resumed = await runHarnessPair(mdPath, {
        clock: {
          now: () => 99_999
        },
        modulesFor: () => ({
          ...injectedTime,
          host: {
            async wait() {
              return "beta";
            }
          }
        }),
        randomSeed,
        snapshotPath
      });

      const fresh = await runHarnessPair(mdPath, {
        clock: {
          now: () => 5_000
        },
        modulesFor: () => ({
          ...injectedTime,
          host: {
            async wait() {
              return "done";
            }
          }
        }),
        randomSeed: saved.random.seed,
        snapshotPath: "/snapshots/stable-id-fresh.json"
      });

      expect(resumed).toMatchObject({
        ok: true,
        returnValue: fresh.ok ? fresh.returnValue : undefined
      });
    }
  );

  it("replays caught host failures without consuming a successful sidecar entry", async () => {
    const mdPath = "/repo/harness/caught.md";
    const snapshotPath = "/snapshots/caught.json";
    vol.fromJSON({
      [mdPath]: "---\nkind: caught\nversion: 1\n---\n",
      "/repo/harness/caught.ajs":
        "import { read, wait } from 'host'; export default async (frontmatter) => { let message; try { await read(); } catch (error) { message = error.message; } await wait(message); return message; };"
    });
    vol.mkdirSync("/snapshots", { recursive: true });
    let reads = 0;
    const read = async () => {
      reads += 1;
      throw new Error("original failure");
    };
    const gate = createDeferred<string>();
    const waiting = createDeferred<boolean>();
    let caughtMessage: unknown;
    const controller = new AbortController();
    const original = runHarnessPair(mdPath, {
      modulesFor: () => ({
        host: {
          read,
          wait: (message: unknown) => {
            caughtMessage = message;
            waiting.resolve(true);
            return gate.promise;
          }
        }
      }),
      signal: controller.signal,
      snapshotIntervalMs: -1,
      snapshotPath
    });
    await waiting.promise;
    await flushMicrotasks();
    expect(reads).toBe(1);
    expect(caughtMessage).toBe("original failure");
    controller.abort();
    gate.reject(new Error("aborted"));
    await expect(original).rejects.toMatchObject({ name: "AbortError" });
    expect(JSON.parse(vol.readFileSync(snapshotPath, "utf8") as string)).toMatchObject({
      replay: {
        calls: [
          expect.objectContaining({
            operation: "read",
            outcome: { status: "rejected", data: expect.any(Object) }
          }),
          expect.any(Object)
        ]
      }
    });
    const resumed = await runHarnessPair(mdPath, {
      modulesFor: () => ({ host: { read, wait: async () => "done" } }),
      snapshotPath
    });
    expect(resumed).toMatchObject({ ok: true, returnValue: "original failure" });
    expect(reads).toBe(1);
  });

  it("does not replay stale host calls after a successful run with the same snapshotPath", async () => {
    const mdPath = "/repo/harness/fresh.md";
    const snapshotPath = "/snapshots/fresh.json";
    vol.fromJSON({
      [mdPath]: "---\nkind: fresh\nversion: 1\n---\n",
      "/repo/harness/fresh.ajs": [
        'import { read } from "host";',
        "export default async (frontmatter) => await read();"
      ].join("\n")
    });

    const firstRead = vi.fn(() => "first");
    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({
          host: {
            read: firstRead
          }
        }),
        snapshotPath
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "first"
    });
    expect(firstRead).toHaveBeenCalledTimes(1);

    const secondRead = vi.fn(() => "second");
    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({
          host: {
            read: secondRead
          }
        }),
        snapshotPath
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "second"
    });
    expect(secondRead).toHaveBeenCalledTimes(1);
  });

  it("drives a custom snapshot backend during checkpoint, resume, and cleanup", async () => {
    const mdPath = "/repo/harness/backend.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: backend\nversion: 1\n---\n",
      "/repo/harness/backend.ajs": [
        'import { step } from "host";',
        "export default async (frontmatter) => {",
        "  const first = await step('first');",
        "  const second = await step('second');",
        "  return first.concat('|').concat(second);",
        "};"
      ].join("\n")
    });

    const snapshotBackend = new MemorySnapshotBackend();
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const controller = new AbortController();
    const firstCalls: string[] = [];
    const firstRun = runHarnessPair(mdPath, {
      modulesFor: () => ({
        host: {
          async step(name: string) {
            firstCalls.push(name);
            return name === "first" ? first.promise : second.promise;
          }
        }
      }),
      signal: controller.signal,
      snapshotBackend,
      snapshotIntervalMs: -1
    });

    await flushMicrotasks();
    expect(firstCalls).toEqual(["first"]);

    first.resolve("alpha");
    await flushMicrotasks();

    expect(firstCalls).toEqual(["first", "second"]);
    expect(snapshotBackend.writes).toHaveLength(3);
    expect(snapshotBackend.snapshot).toMatchObject({
      sourceHash: expect.any(String)
    });

    controller.abort();
    second.reject(new Error("aborted"));
    await expect(firstRun).rejects.toMatchObject({
      name: "AbortError"
    });

    const secondCalls: string[] = [];
    const resumed = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        host: {
          async step(name: string) {
            secondCalls.push(name);
            return "beta";
          }
        }
      }),
      snapshotBackend
    });

    expect(secondCalls).toEqual(["second"]);
    expect(snapshotBackend.reads).toBeGreaterThanOrEqual(2);
    expect(snapshotBackend.removes).toBe(1);
    expect(snapshotBackend.snapshot).toBeUndefined();
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: "alpha|beta"
    });
  });

  it("reports source hash mismatches from a custom snapshot backend clearly", async () => {
    const mdPath = "/repo/harness/backend-mismatch.md";
    const snapshotBackend = new MemorySnapshotBackend({
      version: 1,
      sourceHash: "stale"
    });
    vol.fromJSON({
      [mdPath]: "---\nkind: mismatch\nversion: 1\n---\n",
      "/repo/harness/backend-mismatch.ajs": "export default (frontmatter) => 'fresh';"
    });

    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({}),
        snapshotBackend
      })
    ).rejects.toThrow("source changed since snapshot was taken");
  });

  it("starts fresh with an existing snapshotPath when resume is false", async () => {
    const mdPath = "/repo/harness/no-resume.md";
    const snapshotPath = "/snapshots/no-resume.json";
    vol.fromJSON({
      [mdPath]: "---\nkind: fresh\nversion: 1\n---\n",
      "/repo/harness/no-resume.ajs": [
        'import { read } from "host";',
        "export default async (frontmatter) => await read();"
      ].join("\n"),
      [snapshotPath]: JSON.stringify({ sourceHash: "stale" }),
      [`${snapshotPath}.host-calls.json`]: JSON.stringify([
        { key: "host.read", args: [], result: "stale" }
      ])
    });

    const read = vi.fn(() => "fresh");
    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({
          host: {
            read
          }
        }),
        resume: false,
        snapshotPath
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "fresh"
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(vol.existsSync(snapshotPath)).toBe(false);
    expect(vol.existsSync(`${snapshotPath}.host-calls.json`)).toBe(false);
  });

  it("rejects a symlinked default snapshot directory before writing state", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/test");
    const mdPath = "/repo/harness/probe.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: probe\nversion: 1\n---\n",
      "/repo/harness/probe.ajs": "export default (frontmatter) => 'done';",
      "/outside/sentinel.txt": "untouched"
    });
    const runLogDir = resolveRunLogDir({
      planPath: mdPath,
      runner: "harness",
      homeDir: "/home/test"
    });
    vol.mkdirSync(dirname(runLogDir), { recursive: true });
    vol.symlinkSync("/outside", runLogDir);

    await expect(runHarnessPair(mdPath, { modulesFor: () => ({}) })).rejects.toThrow(
      "Default harness snapshot path must not contain symbolic links."
    );
    expect(vol.existsSync("/outside/snapshot.json")).toBe(false);
  });

  it("rejects a symlinked default snapshot directory before reading replay state", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/test");
    const mdPath = "/repo/harness/probe.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: probe\nversion: 1\n---\n",
      "/repo/harness/probe.ajs": "export default (frontmatter) => 'done';",
      "/outside/snapshot.json": JSON.stringify({ version: 1, sourceHash: "external" })
    });
    const runLogDir = resolveRunLogDir({
      planPath: mdPath,
      runner: "harness",
      homeDir: "/home/test"
    });
    vol.mkdirSync(dirname(runLogDir), { recursive: true });
    vol.symlinkSync("/outside", runLogDir);

    await expect(runHarnessPair(mdPath, { modulesFor: () => ({}) })).rejects.toThrow(
      "Default harness snapshot path must not contain symbolic links."
    );
  });

  it("rejects an explicit CLI default snapshot path through a symlinked parent", async () => {
    const mdPath = "/repo/harness/probe.md";
    const snapshotPath = "/repo/.poe-code/harnesses/probe/snapshot.json";
    vol.fromJSON({
      [mdPath]: "---\nkind: probe\nversion: 1\n---\n",
      "/repo/harness/probe.ajs": "export default (frontmatter) => 'done';",
      "/outside/sentinel.txt": "untouched"
    });
    vol.mkdirSync("/repo/.poe-code/harnesses", { recursive: true });
    vol.symlinkSync("/outside", "/repo/.poe-code/harnesses/probe");

    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({}),
        snapshotPath,
        snapshotPathIsDefault: true
      })
    ).rejects.toThrow("Default harness snapshot path must not contain symbolic links.");
    expect(vol.existsSync("/outside/snapshot.json")).toBe(false);
  });

  it("rejects a symlinked default host-call replay sidecar before reading it", async () => {
    const mdPath = "/repo/harness/probe.md";
    const snapshotPath = "/repo/.poe-code/harnesses/probe/snapshot.json";
    vol.fromJSON({
      [mdPath]: "---\nkind: probe\nversion: 1\n---\n",
      "/repo/harness/probe.ajs": "export default (frontmatter) => 'done';",
      "/outside/host-calls.json": JSON.stringify([{ key: "host.read", args: [], result: "stale" }])
    });
    vol.mkdirSync(dirname(snapshotPath), { recursive: true });
    vol.symlinkSync("/outside/host-calls.json", `${snapshotPath}.host-calls.json`);

    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({}),
        snapshotPath,
        snapshotPathIsDefault: true
      })
    ).rejects.toThrow("Default harness snapshot path must not contain symbolic links.");
  });

  it("deep-merges frontmatterOverrides into the validated frontmatter before invoking the default export", async () => {
    const mdPath = "/repo/harness/override.md";
    vol.fromJSON({
      [mdPath]: [
        "---",
        "kind: override",
        "version: 1",
        "agent:",
        "  agent: codex",
        "  mode: edit",
        "---",
        ""
      ].join("\n"),
      "/repo/harness/override.ajs": [
        'import { S } from "schema";',
        "export const schema = S.Object({",
        "  kind: S.String(),",
        "  version: S.Number(),",
        "  agent: S.Object({",
        "    agent: S.String(),",
        "    mode: S.Optional(S.String()),",
        "    model: S.Optional(S.String())",
        "  })",
        "});",
        "export default async (frontmatter) => frontmatter.agent;"
      ].join("\n")
    });

    const result = await runHarnessPair(mdPath, {
      modulesFor: () => ({}),
      frontmatterOverrides: { agent: { model: "iris-alpha" } }
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue: { agent: "codex", mode: "edit", model: "iris-alpha" }
    });
  });

  it("lets frontmatterOverrides replace a scalar field on the agent block", async () => {
    const mdPath = "/repo/harness/override-scalar.md";
    vol.fromJSON({
      [mdPath]: [
        "---",
        "kind: override-scalar",
        "version: 1",
        "agent:",
        "  agent: codex",
        "  model: original",
        "---",
        ""
      ].join("\n"),
      "/repo/harness/override-scalar.ajs": [
        'import { S } from "schema";',
        "export const schema = S.Object({",
        "  kind: S.String(),",
        "  version: S.Number(),",
        "  agent: S.Object({",
        "    agent: S.String(),",
        "    model: S.Optional(S.String())",
        "  })",
        "});",
        "export default async (frontmatter) => frontmatter.agent;"
      ].join("\n")
    });

    const result = await runHarnessPair(mdPath, {
      modulesFor: () => ({}),
      frontmatterOverrides: { agent: { agent: "claude-code", model: "iris-alpha" } }
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue: { agent: "claude-code", model: "iris-alpha" }
    });
  });

  it("ignores undefined values inside frontmatterOverrides instead of clobbering the frontmatter", async () => {
    const mdPath = "/repo/harness/override-undefined.md";
    vol.fromJSON({
      [mdPath]: [
        "---",
        "kind: override-undefined",
        "version: 1",
        "agent:",
        "  agent: codex",
        "  mode: edit",
        "---",
        ""
      ].join("\n"),
      "/repo/harness/override-undefined.ajs": [
        'import { S } from "schema";',
        "export const schema = S.Object({",
        "  kind: S.String(),",
        "  version: S.Number(),",
        "  agent: S.Object({",
        "    agent: S.String(),",
        "    mode: S.Optional(S.String()),",
        "    model: S.Optional(S.String())",
        "  })",
        "});",
        "export default async (frontmatter) => frontmatter.agent;"
      ].join("\n")
    });

    const result = await runHarnessPair(mdPath, {
      modulesFor: () => ({}),
      frontmatterOverrides: { agent: { agent: undefined, mode: undefined, model: "iris-alpha" } }
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue: { agent: "codex", mode: "edit", model: "iris-alpha" }
    });
  });
});

class MemorySnapshotBackend implements SnapshotBackend {
  reads = 0;
  removes = 0;
  snapshot: Snapshot | undefined;
  writes: Snapshot[] = [];

  constructor(snapshot?: Snapshot) {
    this.snapshot = snapshot;
  }

  async read(): Promise<Snapshot | undefined> {
    this.reads += 1;
    return this.snapshot;
  }

  async write(snapshot: Snapshot): Promise<void> {
    this.writes.push(snapshot);
    this.snapshot = snapshot;
  }

  async remove(): Promise<void> {
    this.removes += 1;
    this.snapshot = undefined;
  }
}

function createDeferred<TValue>() {
  let resolve!: (value: TValue) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TValue>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    reject,
    resolve
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function readCoverageDemoTemplate(fileName: "coverage-demo.ajs" | "coverage-demo.md"): string {
  return readFileSync(new URL(`../templates/coverage-demo/${fileName}`, import.meta.url), "utf8");
}

function createSpawnResult(usage: {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costUsd?: number;
}) {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    summary: "done",
    durationMs: 1,
    usage
  };
}
