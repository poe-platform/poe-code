import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { createSandboxClosure, createSandboxPromise } = await import("../interp/values.js");
const { makeHarnessModule } = await import("../modules/harness.js");
const { runHarness } = await import("./run-harness.js");

describe("runHarness", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads frontmatter and the first js block, builds modules, and returns the run result", async () => {
    const filepath = "/repo/docs/plans/example.md";

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: inspect",
        "agents:",
        "  planner:",
        "    agent: codex",
        "---",
        "",
        "# Example",
        "",
        "```js",
        'import { tasks, agents, meta } from "harness";',
        "return [tasks[0].id, agents.planner.agent, meta.kind, meta.version, meta.filepath].join('|');",
        "```"
      ].join("\n")
    });

    const modulesFor = vi.fn((frontmatter, meta) => ({
      harness: makeHarnessModule(frontmatter, meta)
    }));

    const result = await runHarness(filepath, { modulesFor });

    expect(modulesFor).toHaveBeenCalledTimes(1);
    expect(modulesFor).toHaveBeenCalledWith(
      {
        agents: {
          planner: {
            agent: "codex"
          }
        },
        kind: "pipeline",
        tasks: [
          {
            id: "inspect"
          }
        ],
        version: 1
      },
      {
        filepath,
        kind: "pipeline",
        version: 1
      }
    );
    expect(result).toMatchObject({
      ok: true,
      returnValue: `inspect|codex|pipeline|1|${filepath}`
    });
  });

  it("allows harness applyConstraints through lint and runtime module exports", async () => {
    const filepath = "/repo/docs/plans/constrained.md";

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "principles:",
        "  - Cloudflare only",
        "  - REST only",
        "---",
        "",
        "```js",
        'import { applyConstraints } from "harness";',
        'return applyConstraints("Build the API.");',
        "```"
      ].join("\n")
    });

    const result = await runHarness(filepath, {
      modulesFor: (frontmatter, meta) => ({
        harness: makeHarnessModule(frontmatter, meta)
      })
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue:
        "CONSTRAINTS (hard rules, honor all):\n- Cloudflare only\n- REST only\n\nBuild the API."
    });
  });

  it("aborts before execution when lint reports an error diagnostic", async () => {
    const filepath = "/repo/docs/plans/invalid.md";
    const execute = vi.fn(() => "ran");

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "```js",
        'import { missing } from "api";',
        "return missing();",
        "```"
      ].join("\n")
    });

    await expect(
      runHarness(filepath, {
        modulesFor: () => ({
          api: {
            execute
          }
        })
      })
    ).rejects.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "AS005",
          filename: filepath,
          line: 7,
          severity: "error"
        })
      ],
      name: "LintError"
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it("reports lint diagnostics on the original file lines for BOM and CRLF content", async () => {
    const filepath = "/repo/docs/plans/windows.md";

    vol.fromJSON({
      [filepath]: [
        "\uFEFF---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "## Windows",
        "",
        "```js",
        'import { missing } from "api";',
        "return missing();",
        "```"
      ].join("\r\n")
    });

    await expect(
      runHarness(filepath, {
        modulesFor: () => ({
          api: {}
        })
      })
    ).rejects.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "AS005",
          filename: filepath,
          line: 9,
          severity: "error"
        })
      ],
      name: "LintError"
    });
  });

  it("supports map-based module registries for linting and execution", async () => {
    const filepath = "/repo/docs/plans/map-registry.md";

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "```js",
        'import { run } from "api";',
        "return run();",
        "```"
      ].join("\n")
    });

    const result = await runHarness(filepath, {
      modulesFor: () =>
        new Map([
          [
            "api",
            new Map([
              [
                "run",
                createSandboxClosure({
                  call: () => "ok",
                  name: "run"
                })
              ]
            ])
          ]
        ])
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue: "ok"
    });
  });

  it("runs the body directly when the file has frontmatter but no fenced script block", async () => {
    const filepath = "/repo/docs/plans/no-fence.md";

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "return 42;"
      ].join("\n")
    });

    const result = await runHarness(filepath, {
      modulesFor: () => ({})
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue: 42
    });
  });

  it("treats .ajs files as raw scripts without frontmatter or markdown block extraction", async () => {
    const filepath = "/repo/scripts/raw.ajs";
    const modulesFor = vi.fn((frontmatter, meta) => ({
      api: {
        run: createSandboxClosure({
          call: () => [Object.keys(frontmatter).length, meta.kind, meta.version, meta.filepath].join("|"),
          name: "run"
        })
      }
    }));

    vol.fromJSON({
      [filepath]: [
        "/*",
        "```js",
        "return 'extracted';",
        "```",
        "*/",
        "",
        'import { run } from "api";',
        "return run();"
      ].join("\n")
    });

    const result = await runHarness(filepath, { modulesFor });

    expect(modulesFor).toHaveBeenCalledTimes(1);
    expect(modulesFor).toHaveBeenCalledWith(
      {},
      {
        filepath,
        kind: undefined,
        version: undefined
      }
    );
    expect(result).toMatchObject({
      ok: true,
      returnValue: `0|||${filepath}`
    });
  });

  it("does not register the harness module for .ajs files", async () => {
    const filepath = "/repo/scripts/no-harness.ajs";

    vol.fromJSON({
      [filepath]: [
        'import { meta } from "harness";',
        "return meta.filepath;"
      ].join("\n")
    });

    await expect(
      runHarness(filepath, {
        modulesFor: (frontmatter, meta) => ({
          api: {
            run: createSandboxClosure({
              call: () => "ok",
              name: "run"
            })
          },
          harness: makeHarnessModule(frontmatter, meta)
        })
      })
    ).rejects.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "AS004",
          filename: filepath,
          line: 1,
          message: "Unknown module 'harness'. Available modules: api.",
          severity: "error"
        })
      ],
      name: "LintError"
    });
  });

  it("passes an already-aborted signal through to execution", async () => {
    const filepath = "/repo/docs/plans/abort.md";
    const controller = new AbortController();
    const after = vi.fn(() => "after");

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "```js",
        'import { wait } from "async";',
        "return wait();",
        "```"
      ].join("\n")
    });

    controller.abort();

    const result = runHarness(filepath, {
      modulesFor: () => ({
        async: {
          wait: createSandboxClosure({
            call: () => after(),
            name: "wait"
          })
        }
      }),
      signal: controller.signal
    });

    await expect(result).rejects.toMatchObject({
      message: "aborted",
      name: "SandboxError"
    });
    expect(after).not.toHaveBeenCalled();
  });

  it("checkpoints the running script to snapshotPath", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T00:00:00.000Z"));

    const filepath = "/repo/docs/plans/checkpoint.md";
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    let waitCalls = 0;

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "```js",
        'import { wait } from "async";',
        "await wait();",
        "await wait();",
        "return 'done';",
        "```"
      ].join("\n")
    });

    const result = runHarness(filepath, {
      modulesFor: () => ({
        async: {
          wait: createSandboxClosure({
            async: true,
            call: () => {
              waitCalls += 1;
              return createSandboxPromise(waitCalls === 1 ? first.promise : second.promise);
            },
            name: "wait"
          })
        }
      }),
      snapshotPath: "/checkpoints/harness.json",
      signal: undefined
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(waitCalls).toBe(1);
    expect(vol.existsSync("/checkpoints/harness.json")).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);
    first.resolve("alpha");
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);

    expect(waitCalls).toBe(2);
    expect(JSON.parse(vol.readFileSync("/checkpoints/harness.json", "utf8") as string)).toMatchObject({
      sourceHash: expect.any(String)
    });

    second.resolve("omega");
    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
  });
});

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

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
