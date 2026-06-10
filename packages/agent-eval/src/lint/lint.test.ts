import { createFsFromVolume, Volume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failedReadFileTarget: undefined as string | undefined,
  fs: undefined as unknown as ReturnType<typeof createFsFromVolume>["promises"]
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (...args: unknown[]) => {
      const [target] = args as Parameters<typeof mocks.fs.readFile>;
      if (String(target) === mocks.failedReadFileTarget) {
        throw new Error("readFile denied");
      }

      return mocks.fs.readFile(...(args as Parameters<typeof mocks.fs.readFile>));
    },
    readdir: (...args: unknown[]) =>
      mocks.fs.readdir(...(args as Parameters<typeof mocks.fs.readdir>)),
    stat: (...args: unknown[]) => mocks.fs.stat(...(args as Parameters<typeof mocks.fs.stat>)),
    realpath: (...args: unknown[]) => mocks.fs.realpath(...(args as Parameters<typeof mocks.fs.realpath>))
  }
}));

const { evalLint } = await import("./lint.js");

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

describe("evalLint", () => {
  beforeEach(() => {
    mocks.failedReadFileTarget = undefined;
    mocks.fs = createFsFromVolume(Volume.fromJSON(validFiles(), "/")).promises;
  });

  it("returns no issues for a pinned eval with scorer and oracle solution", async () => {
    await expect(lint()).resolves.toEqual({
      evalId: "smoke",
      issues: []
    });
  });

  it("rejects eval ids that escape the source directory", async () => {
    await expect(evalLint({ sourceDir: "/repo/evals", evalId: "../victim" })).rejects.toThrow(
      'Invalid eval id "../victim". Eval ids must be first-level directory names.'
    );
  });

  it("does not lint an eval definition symlinked outside the source directory", async () => {
    mocks.fs = createFsFromVolume(Volume.fromJSON(validFiles(), "/")).promises;
    await mocks.fs.mkdir("/outside", { recursive: true });
    await mocks.fs.writeFile("/outside/eval.yaml", evalYaml({ wallClockMs: 1000 }), "utf8");
    await mocks.fs.unlink("/repo/evals/smoke/eval.yaml");
    await mocks.fs.symlink("/outside/eval.yaml", "/repo/evals/smoke/eval.yaml");

    await expect(lint()).rejects.toThrow(
      "eval.yaml must stay within the canonical source directory."
    );
  });

  it("does not lint a plan symlinked outside the source directory", async () => {
    mocks.fs = createFsFromVolume(Volume.fromJSON(validFiles(), "/")).promises;
    await mocks.fs.mkdir("/outside", { recursive: true });
    await mocks.fs.writeFile("/outside/plan.md", ["---", "kind: bad", "---", "External"].join("\n"), "utf8");
    await mocks.fs.unlink("/repo/evals/smoke/plan.md");
    await mocks.fs.symlink("/outside/plan.md", "/repo/evals/smoke/plan.md");

    await expect(lint()).rejects.toThrow(
      "plan.md must stay within the canonical source directory."
    );
  });

  it("accepts valid named metric configuration", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        validFiles({
          evalYaml: [
            evalYaml(),
            "metrics:",
            "  - id: task_completion",
            "    required: true",
            "    threshold: 1",
            "    evaluator:",
            "      kind: deterministic"
          ].join("\n")
        }),
        "/"
      )
    ).promises;

    await expect(lint()).resolves.toEqual({ evalId: "smoke", issues: [] });
  });

  it("reports E001 when eval.yaml is missing", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        validFiles({
          omit: ["/repo/evals/smoke/eval.yaml"]
        }),
        "/"
      )
    ).promises;

    await expectIssueCodes(["E001"]);
  });

  it("reports E001 when eval.yaml fails schema validation", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        validFiles({
          evalYaml: ["id: smoke", "title: Missing required fields"].join("\n")
        }),
        "/"
      )
    ).promises;

    await expectIssueCodes(["E001"]);
  });

  it("reports E002 when plan.md is missing", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        validFiles({
          omit: ["/repo/evals/smoke/plan.md"]
        }),
        "/"
      )
    ).promises;

    await expectIssueCodes(["E002"]);
  });

  it("does not treat inherited readFile error codes as missing lint files", async () => {
    mocks.failedReadFileTarget = "/repo/evals/smoke/plan.md";

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(lint()).rejects.toThrow("readFile denied");
    });
  });

  it("reports E002 when plan.md frontmatter fails to parse", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        validFiles({
          plan: ["---", "kind: [", "---", "Run the task."].join("\n")
        }),
        "/"
      )
    ).promises;

    await expectIssueCodes(["E002"]);
  });

  it("reports E003 when plan.md frontmatter kind is unsupported", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        validFiles({
          plan: ["---", "kind: unknown", "---", "Run the task."].join("\n")
        }),
        "/"
      )
    ).promises;

    await expectIssueCodes(["E003"]);
  });

  it("reports E004 and W001 when oracle/ is missing", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        validFiles({
          omit: [
            "/repo/evals/smoke/oracle/tests/default.test.ts",
            "/repo/evals/smoke/oracle/solution/index.ts"
          ]
        }),
        "/"
      )
    ).promises;

    await expectIssueCodes(["E004", "W001"]);
  });

  it("reports E005 when there is no scorer command and no oracle test files", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        validFiles({
          evalYaml: evalYaml({ scorer: false }),
          omit: ["/repo/evals/smoke/oracle/tests/default.test.ts"]
        }),
        "/"
      )
    ).promises;

    await expectIssueCodes(["E005"]);
  });

  it("reports W001 when oracle/solution/ is missing", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        validFiles({
          omit: ["/repo/evals/smoke/oracle/solution/index.ts"]
        }),
        "/"
      )
    ).promises;

    await expectIssueCodes(["W001"]);
  });

  it("reports W001 when oracle/solution/ exists but is empty", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON({
        ...validFiles({
          omit: ["/repo/evals/smoke/oracle/solution/index.ts"]
        }),
        "/repo/evals/smoke/oracle/solution": null
      }),
      "/"
    ).promises;

    await expectIssueCodes(["W001"]);
  });

  it("uses oracle.path when checking default scorer tests and solution", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON({
        ...validFiles({
          evalYaml: evalYaml({
            oraclePath: "custom-oracle",
            scorer: false
          }),
          omit: [
            "/repo/evals/smoke/oracle/tests/default.test.ts",
            "/repo/evals/smoke/oracle/solution/index.ts"
          ]
        }),
        "/repo/evals/smoke/custom-oracle/tests/default.test.ts": "import { it } from 'vitest';\n",
        "/repo/evals/smoke/custom-oracle/solution/index.ts": "export const ok = true;\n"
      }),
      "/"
    ).promises;

    await expect(lint()).resolves.toEqual({
      evalId: "smoke",
      issues: []
    });
  });

  it("reports W002 when starter/ is present but empty", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON({
        ...validFiles(),
        "/repo/evals/smoke/starter": null
      }),
      "/"
    ).promises;

    await expectIssueCodes(["W002"]);
  });

  it("reports W003 when budget.wall_clock_ms is below 60000", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        validFiles({
          evalYaml: evalYaml({ wallClockMs: 1000 })
        }),
        "/"
      )
    ).promises;

    await expectIssueCodes(["W003"]);
  });

  it("reports W004 when target.ref looks like an unpinned branch", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        validFiles({
          evalYaml: evalYaml({ ref: "main" })
        }),
        "/"
      )
    ).promises;

    await expectIssueCodes(["W004"]);
  });

  it("reports W004 when target.ref is a non-SHA branch path", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        validFiles({
          evalYaml: evalYaml({ ref: "feature/lint-command" })
        }),
        "/"
      )
    ).promises;

    await expectIssueCodes(["W004"]);
  });

  it("returns all issues from independent checks", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        {
          ...validFiles({
            evalYaml: evalYaml({
              scorer: false,
              ref: "main",
              wallClockMs: 1000
            }),
            plan: ["---", "kind: unsupported", "---", "Run the task."].join("\n"),
            omit: [
              "/repo/evals/smoke/oracle/tests/default.test.ts",
              "/repo/evals/smoke/oracle/solution/index.ts"
            ]
          }),
          "/repo/evals/smoke/oracle": null
        },
        "/"
      )
    ).promises;

    const result = await lint();

    expect(
      result.issues.map((issue) => ({
        severity: issue.severity,
        code: issue.code
      }))
    ).toEqual([
      { severity: "error", code: "E003" },
      { severity: "error", code: "E005" },
      { severity: "warning", code: "W001" },
      { severity: "warning", code: "W003" },
      { severity: "warning", code: "W004" }
    ]);
  });
});

async function lint() {
  return evalLint({ sourceDir: "/repo/evals", evalId: "smoke" });
}

async function expectIssueCodes(codes: readonly string[]): Promise<void> {
  const result = await lint();
  expect(result.issues.map((issue) => issue.code)).toEqual(codes);
}

function validFiles(
  options: {
    evalYaml?: string;
    plan?: string;
    omit?: readonly string[];
  } = {}
): Record<string, string | null> {
  const files: Record<string, string | null> = {
    "/repo/evals/smoke/eval.yaml": options.evalYaml ?? evalYaml(),
    "/repo/evals/smoke/plan.md":
      options.plan ?? ["---", "kind: plan", "---", "Run the task."].join("\n"),
    "/repo/evals/smoke/oracle/tests/default.test.ts": "import { it } from 'vitest';\n",
    "/repo/evals/smoke/oracle/solution/index.ts": "export const ok = true;\n"
  };

  for (const path of options.omit ?? []) {
    delete files[path];
  }

  return files;
}

function evalYaml(
  options: {
    scorer?: boolean;
    oraclePath?: string;
    ref?: string;
    wallClockMs?: number;
  } = {}
): string {
  const includeScorer = options.scorer ?? true;
  const lines = [
    "id: smoke",
    "title: Smoke eval",
    "target:",
    "  repo: https://example.com/repo.git",
    `  ref: ${options.ref ?? "0123456789abcdef0123456789abcdef01234567"}`
  ];

  if (includeScorer) {
    lines.push("scorer:", "  command: npm test", "  result_path: score.json", "  timeout_ms: 1000");
  }

  lines.push(
    "oracle:",
    `  path: ${options.oraclePath ?? "oracle"}`,
    "budget:",
    "  max_iterations: 10",
    "  max_tokens: 1000",
    `  wall_clock_ms: ${options.wallClockMs ?? 60000}`,
    "judge:",
    "  agent: codex",
    "  model: gpt-5",
    "  rubric:",
    "    - completeness",
    "weights:",
    "  tests: 0.7",
    "  judge: 0.3"
  );

  return lines.join("\n");
}
