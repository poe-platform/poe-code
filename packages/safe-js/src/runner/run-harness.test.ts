import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { createSandboxClosure, createSandboxPromise } = await import("../interp/values.js");
const { makeHarnessModule } = await import("../modules/harness.js");
const { runHarness, runHarnessPair } = await import("./run-harness.js");

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

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

  it("ignores inherited frontmatter metadata for markdown harnesses", async () => {
    const filepath = "/repo/docs/plans/no-frontmatter.md";
    vol.fromJSON({
      [filepath]: [
        "```js",
        'import { meta } from "harness";',
        "return [meta.kind, meta.version, meta.filepath].join('|');",
        "```"
      ].join("\n")
    });

    const modulesFor = vi.fn((frontmatter, meta) => ({
      harness: makeHarnessModule(frontmatter, meta)
    }));

    await withObjectPrototypeProperties(
      {
        kind: "polluted-kind",
        version: 99
      },
      async () => {
        const result = await runHarness(filepath, { modulesFor });

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
          returnValue: `||${filepath}`
        });
      }
    );
  });

  it("normalizes missing harness files with the missing path in the message", async () => {
    const filepath = "/repo/docs/plans/missing.md";

    await expect(
      runHarness(filepath, {
        modulesFor: () => ({})
      })
    ).rejects.toThrow(`Harness file not found: ${filepath}`);
  });

  it("normalizes harness paths under a file parent", async () => {
    const filepath = "/repo/docs/plans/missing.md";
    vol.mkdirSync("/repo", { recursive: true });
    vol.writeFileSync("/repo/docs", "not a directory");

    await expect(
      runHarness(filepath, {
        modulesFor: () => ({})
      })
    ).rejects.toThrow(`Harness file not found: ${filepath}`);
  });

  it("normalizes missing paired raw script files", async () => {
    const filepath = "/repo/docs/plans/example.md";
    const scriptPath = "/repo/docs/plans/example.ajs";
    vol.fromJSON({
      [filepath]: "---\nkind: pipeline\n---\nbody"
    });

    await expect(
      runHarnessPair(filepath, {
        modulesFor: () => ({})
      })
    ).rejects.toThrow(`Harness file not found: ${scriptPath}`);
  });

  it("throws a clear error when the path points at a directory", async () => {
    const filepath = "/repo/docs/plans/directory.md";
    vol.mkdirSync(filepath, { recursive: true });

    await expect(
      runHarness(filepath, {
        modulesFor: () => ({})
      })
    ).rejects.toThrow(`Harness path must point to a file: ${filepath}`);
  });

  it("throws a no code block error when the file is empty", async () => {
    const filepath = "/repo/docs/plans/empty.md";

    vol.fromJSON({
      [filepath]: ""
    });

    await expect(
      runHarness(filepath, {
        modulesFor: () => ({})
      })
    ).rejects.toThrow("No code block found");
  });

  it("accepts hashbangs in raw scripts and fenced code blocks", async () => {
    const rawPath = "/repo/docs/plans/raw.ajs";
    const markdownPath = "/repo/docs/plans/markdown.md";

    vol.fromJSON({
      [rawPath]: "#!/usr/bin/env bun\nreturn 1;",
      [markdownPath]: ["# Example", "", "```js", "#!/usr/bin/env node", "return 2;", "```"].join(
        "\n"
      )
    });

    await expect(
      runHarness(rawPath, {
        modulesFor: () => ({})
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });

    await expect(
      runHarness(markdownPath, {
        modulesFor: () => ({})
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
  });

  it("reports parse errors on source-mapped markdown lines", async () => {
    const filepath = "/repo/docs/plans/syntax.md";

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "```js",
        "const value = ;",
        "```"
      ].join("\n")
    });

    await expect(
      runHarness(filepath, {
        modulesFor: () => ({})
      })
    ).rejects.toMatchObject({
      filename: filepath,
      line: 7,
      name: "ParseError"
    });
  });

  it("returns an execution error result when the first await throws and still runs finally", async () => {
    const filepath = "/repo/docs/plans/await-throws.md";
    const cleanup = vi.fn(() => undefined);

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "```js",
        'import { cleanup, fail } from "api";',
        "try {",
        "  await fail();",
        "  return 'missed';",
        "} finally {",
        "  cleanup();",
        "}",
        "```"
      ].join("\n")
    });

    const ajsPath = "/repo/docs/plans/await-throws.ajs";

    vol.fromJSON({
      [ajsPath]: [
        'import { cleanup, fail } from "api";',
        "export default async (frontmatter) => {",
        "  try {",
        "    await fail();",
        "    return 'missed';",
        "  } finally {",
        "    cleanup();",
        "  }",
        "};"
      ].join("\n")
    });

    const result = await runHarnessPair(filepath, {
      modulesFor: () => ({
        api: {
          cleanup: createSandboxClosure({
            call: () => cleanup(),
            name: "cleanup"
          }),
          fail: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(Promise.reject(new Error("first await failed"))),
            name: "fail"
          })
        }
      })
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        message: "first await failed",
        name: "Error"
      }
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("returns the value when the harness completes with no awaits", async () => {
    const filepath = "/repo/docs/plans/no-awaits.md";

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "```js",
        "return 42;",
        "```"
      ].join("\n")
    });

    await expect(
      runHarness(filepath, {
        modulesFor: () => ({})
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 42
    });
  });

  it("invokes a markdown default export with no arguments", async () => {
    const filepath = "/repo/docs/plans/default-export.md";

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "```js",
        'export default () => "entrypoint ran";',
        "```"
      ].join("\n")
    });

    await expect(
      runHarness(filepath, {
        modulesFor: () => ({})
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "entrypoint ran"
    });
  });

  it("surfaces modulesFor errors before code runs", async () => {
    const filepath = "/repo/docs/plans/modules-for-throws.md";
    const error = new Error("module setup failed");

    vol.fromJSON({
      [filepath]: ["```js", "return 'missed';", "```"].join("\n")
    });

    await expect(
      runHarness(filepath, {
        modulesFor: () => {
          throw error;
        }
      })
    ).rejects.toBe(error);
  });

  it("names the missing module when modulesFor omits a required module", async () => {
    const filepath = "/repo/docs/plans/missing-module.md";

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

    await expect(
      runHarness(filepath, {
        modulesFor: () => ({})
      })
    ).rejects.toThrow("Unknown module 'api'");
  });

  it("does not snapshot when snapshotIntervalMs is zero", async () => {
    const filepath = "/repo/docs/plans/no-snapshots.md";
    const write = vi.fn(async () => undefined);

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "```js",
        'import { wait } from "api";',
        "await wait();",
        "return 'done';",
        "```"
      ].join("\n")
    });

    await expect(
      runHarness(filepath, {
        modulesFor: () => ({
          api: {
            wait: createSandboxClosure({
              async: true,
              call: () => createSandboxPromise(Promise.resolve("ok")),
              name: "wait"
            })
          }
        }),
        snapshotBackend: {
          read: async () => undefined,
          remove: async () => undefined,
          write
        },
        snapshotIntervalMs: 0
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
    expect(write).not.toHaveBeenCalled();
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
      [filepath]: ["---", "kind: pipeline", "version: 1", "---", "", "return 42;"].join("\n")
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
          call: () =>
            [Object.keys(frontmatter).length, meta.kind, meta.version, meta.filepath].join("|"),
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

  it("treats .safejs files as raw scripts without frontmatter or markdown block extraction", async () => {
    const filepath = "/repo/scripts/raw.safejs";
    const modulesFor = vi.fn((frontmatter, meta) => ({
      api: {
        run: createSandboxClosure({
          call: () =>
            [Object.keys(frontmatter).length, meta.kind, meta.version, meta.filepath].join("|"),
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
      [filepath]: ['import { meta } from "harness";', "return meta.filepath;"].join("\n")
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

  it("does not register the harness module for .safejs files", async () => {
    const filepath = "/repo/scripts/no-harness.safejs";

    vol.fromJSON({
      [filepath]: ['import { meta } from "harness";', "return meta.filepath;"].join("\n")
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

  it("returns an aborted result when the signal is aborted before the first step", async () => {
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

    const result = await runHarness(filepath, {
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

    expect(result).toMatchObject({
      aborted: true,
      error: {
        message: "This operation was aborted",
        name: "AbortError"
      },
      ok: false
    });
    expect(after).not.toHaveBeenCalled();
  });

  it("does not mark inherited error names as aborted", async () => {
    const filepath = "/repo/docs/plans/inherited-abort.md";

    vol.fromJSON({
      [filepath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "```js",
        'import { fail } from "api";',
        "return fail();",
        "```"
      ].join("\n")
    });

    await withObjectPrototypeProperties({ name: "AbortError" }, async () => {
      const result = await runHarness(filepath, {
        modulesFor: () => ({
          api: {
            fail: createSandboxClosure({
              call: () => {
                throw {};
              },
              name: "fail"
            })
          }
        })
      });

      expect(result).toMatchObject({
        ok: false
      });
      expect(result).not.toHaveProperty("aborted");
    });
  });

  it("checkpoints the running script to snapshotPath", async () => {
    vol.mkdirSync("/checkpoints");
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
    expect(
      JSON.parse(vol.readFileSync("/checkpoints/harness.json", "utf8") as string)
    ).toMatchObject({
      sourceHash: expect.any(String)
    });

    second.resolve("omega");
    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
  });
});

describe("runHarnessPair", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores inherited frontmatter metadata for harness pairs", async () => {
    const mdPath = "/repo/harnesses/no-frontmatter.md";
    const ajsPath = "/repo/harnesses/no-frontmatter.ajs";

    vol.fromJSON({
      [mdPath]: "Body",
      [ajsPath]: [
        "export default async (frontmatter) =>",
        "  [import.meta.kind, import.meta.version, import.meta.filepath].join('|');"
      ].join("\n")
    });

    const modulesFor = vi.fn(() => ({}));

    await withObjectPrototypeProperties(
      {
        kind: "polluted-kind",
        version: 99
      },
      async () => {
        const result = await runHarnessPair(mdPath, { modulesFor });

        expect(modulesFor).toHaveBeenCalledWith(
          {},
          {
            filepath: mdPath,
            kind: undefined,
            version: undefined
          }
        );
        expect(result).toMatchObject({
          ok: true,
          returnValue: `||${mdPath}`
        });
      }
    );
  });

  it("rejects frontmatter agents whose agent does not support the requested mode", async () => {
    const mdPath = "/repo/harnesses/unsupported-mode.md";
    const ajsPath = "/repo/harnesses/unsupported-mode.ajs";

    vol.fromJSON({
      [mdPath]: [
        "---",
        "agents:",
        "  builder:",
        "    agent: cursor",
        "    mode: auto",
        "---",
        "",
        "Body"
      ].join("\n"),
      [ajsPath]: 'export default async (frontmatter) => "unreachable";'
    });

    const modulesFor = vi.fn(() => ({}));

    await expect(runHarnessPair(mdPath, { modulesFor })).rejects.toThrow(
      'Harness agent "builder": agent "cursor" does not support mode "auto".'
    );
    expect(modulesFor).not.toHaveBeenCalled();
  });

  it("accepts frontmatter agents whose agent supports the requested mode", async () => {
    const mdPath = "/repo/harnesses/supported-mode.md";
    const ajsPath = "/repo/harnesses/supported-mode.ajs";

    vol.fromJSON({
      [mdPath]: [
        "---",
        "agents:",
        "  builder:",
        "    agent: claude-code",
        "    mode: auto",
        "---",
        "",
        "Body"
      ].join("\n"),
      [ajsPath]: 'export default async (frontmatter) => "ran";'
    });

    const result = await runHarnessPair(mdPath, { modulesFor: () => ({}) });

    expect(result).toMatchObject({ ok: true, returnValue: "ran" });
  });

  it("keeps concurrent runs against the same pair independent", async () => {
    const mdPath = "/repo/harnesses/example.md";
    const ajsPath = "/repo/harnesses/example.ajs";

    vol.fromJSON({
      [mdPath]: ["---", "name: alpha", "---", "", "Body"].join("\n"),
      [ajsPath]: [
        'import { step } from "state";',
        "export default async (frontmatter) => {",
        "  const first = await step();",
        "  const second = await step();",
        "  return JSON.stringify([frontmatter.name, first, second]);",
        "};"
      ].join("\n")
    });

    const modulesFor = vi.fn(() => {
      let count = 0;
      return {
        state: {
          step: createSandboxClosure({
            async: true,
            call: () => {
              count += 1;
              return createSandboxPromise(Promise.resolve(count));
            },
            name: "step"
          })
        }
      };
    });

    const [first, second] = await Promise.all([
      runHarnessPair(mdPath, { modulesFor }),
      runHarnessPair(mdPath, { modulesFor })
    ]);

    expect(modulesFor).toHaveBeenCalledTimes(2);
    expect(first).toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["alpha", 1, 2])
    });
    expect(second).toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["alpha", 1, 2])
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
