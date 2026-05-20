import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { validateEvalYaml } from "../schema.js";
import { loadEval } from "../source/registry.js";

const mocks = vi.hoisted(() => ({
  fs: undefined as unknown as ReturnType<typeof createFsFromVolume>["promises"]
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: (...args: unknown[]) => mocks.fs.mkdir(...(args as Parameters<typeof mocks.fs.mkdir>)),
    writeFile: (...args: unknown[]) =>
      mocks.fs.writeFile(...(args as Parameters<typeof mocks.fs.writeFile>))
  },
  mkdir: (...args: unknown[]) => mocks.fs.mkdir(...(args as Parameters<typeof mocks.fs.mkdir>)),
  writeFile: (...args: unknown[]) =>
    mocks.fs.writeFile(...(args as Parameters<typeof mocks.fs.writeFile>))
}));

const { evalInit, validateInitName } = await import("./init.js");

describe("evalInit", () => {
  beforeEach(() => {
    mocks.fs = createFsFromVolume(Volume.fromJSON({ "/repo/evals/.keep": "" }, "/")).promises;
  });

  it("scaffolds the expected file set", async () => {
    const result = await evalInit({
      sourceDir: "/repo/evals",
      name: "smoke-task",
      kind: "pipeline",
      targetRepo: "https://example.com/target.git",
      targetRef: "feature/init"
    });

    expect(result).toEqual({
      evalDir: "/repo/evals/smoke-task",
      files: [
        "eval.yaml",
        "plan.md",
        "oracle/tests/example.test.ts",
        "oracle/solution/OUTPUT.md",
        "starter/.gitkeep"
      ]
    });
    await expect(read("smoke-task/eval.yaml")).resolves.toContain("id: smoke-task");
    await expect(read("smoke-task/oracle/tests/example.test.ts")).resolves.toContain(
      'import { describe, expect, it } from "vitest";'
    );
    await expect(read("smoke-task/oracle/solution/OUTPUT.md")).resolves.toBe("ok\n");
    await expect(read("smoke-task/starter/.gitkeep")).resolves.toBe("");
  });

  it("writes eval.yaml that passes schema validation without a scorer block", async () => {
    await evalInit({
      sourceDir: "/repo/evals",
      name: "schema-task",
      kind: "plan"
    });

    const parsed = parseYaml(await read("schema-task/eval.yaml")) as Record<string, unknown>;
    const evalYaml = validateEvalYaml(parsed, "/repo/evals/schema-task/eval.yaml");

    expect(parsed.scorer).toBeUndefined();
    expect(evalYaml).toMatchObject({
      id: "schema-task",
      title: "Schema Task",
      target: {
        repo: "git+https://github.com/poe-platform/poe-code.git",
        ref: "main",
        plan_dest: "docs/plans/eval-task.md"
      },
      oracle: {
        path: "oracle"
      },
      budget: {
        max_iterations: 60,
        max_tokens: 400000,
        wall_clock_ms: 600000
      },
      judge: {
        agent: "claude-code",
        model: "anthropic/claude-opus-4.7",
        rubric: ["completeness", "spec_adherence", "code_quality"]
      },
      weights: {
        tests: 0.7,
        judge: 0.3
      }
    });
  });

  it("writes plan.md frontmatter with the selected kind", async () => {
    await evalInit({
      sourceDir: "/repo/evals",
      name: "super-task",
      kind: "superintendent"
    });

    await expect(
      loadEval({ rootDir: "/repo/evals" }, "super-task", mocks.fs)
    ).resolves.toMatchObject({
      plan: {
        kind: "superintendent",
        frontmatter: {
          kind: "superintendent",
          version: 1
        },
        body: "Replace this with the task prompt the agent will see.\n"
      }
    });
  });

  it("refuses to overwrite an existing folder", async () => {
    await mocks.fs.mkdir("/repo/evals/existing-task", { recursive: true });

    await expect(
      evalInit({
        sourceDir: "/repo/evals",
        name: "existing-task",
        kind: "plan"
      })
    ).rejects.toThrow("Eval folder already exists: /repo/evals/existing-task");
  });
});

describe("validateInitName", () => {
  it.each(["smoke", "smoke-task", "task2", "a-1"])("accepts %s", (name) => {
    expect(() => validateInitName(name)).not.toThrow();
  });

  it.each(["", "Smoke", "2task", "task_name", "task--name", "task-", "-task"])(
    "rejects %s",
    (name) => {
      expect(() => validateInitName(name)).toThrow(
        "Eval name must be kebab-case: lowercase letters, digits, and dashes; start with a letter."
      );
    }
  );
});

async function read(relativePath: string): Promise<string> {
  return mocks.fs.readFile(path.join("/repo/evals", relativePath), "utf8");
}
