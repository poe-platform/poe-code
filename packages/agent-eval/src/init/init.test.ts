import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { validateEvalYaml } from "../schema.js";
import { loadEval } from "../source/registry.js";

const mocks = vi.hoisted(() => ({
  fs: undefined as unknown as ReturnType<typeof createFsFromVolume>["promises"],
  failedLstatTarget: undefined as string | undefined,
  failedMkdirTarget: undefined as string | undefined,
  failedWriteSuffix: undefined as string | undefined,
  racedWriteSuffix: undefined as string | undefined
}));

vi.mock("node:fs/promises", () => {
  const lstat = (...args: unknown[]) => {
    const [target] = args as Parameters<typeof mocks.fs.lstat>;
    if (String(target) === mocks.failedLstatTarget) {
      throw new Error("source lstat denied");
    }

    return mocks.fs.lstat(...(args as Parameters<typeof mocks.fs.lstat>));
  };

  const mkdir = (...args: unknown[]) => {
    const [target] = args as Parameters<typeof mocks.fs.mkdir>;
    if (String(target) === mocks.failedMkdirTarget) {
      throw new Error("mkdir denied");
    }

    return mocks.fs.mkdir(...(args as Parameters<typeof mocks.fs.mkdir>));
  };

  const writeFile = async (...args: unknown[]) => {
    const [filePath] = args as Parameters<typeof mocks.fs.writeFile>;
    if (mocks.racedWriteSuffix !== undefined && String(filePath).endsWith(mocks.racedWriteSuffix)) {
      mocks.racedWriteSuffix = undefined;
      await mocks.fs.symlink("/outside/secret.txt", filePath);
    }
    if (mocks.failedWriteSuffix !== undefined && String(filePath).endsWith(mocks.failedWriteSuffix)) {
      throw new Error("scaffold write failed");
    }
    await mocks.fs.writeFile(...(args as Parameters<typeof mocks.fs.writeFile>));
  };

  return {
    default: {
      lstat,
      mkdir,
      writeFile
    },
    lstat,
    mkdir,
    rm: (...args: unknown[]) => mocks.fs.rm(...(args as Parameters<typeof mocks.fs.rm>)),
    writeFile
  };
});

const { evalInit, validateInitName } = await import("./init.js");

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

describe("evalInit", () => {
  beforeEach(() => {
    mocks.fs = createFsFromVolume(Volume.fromJSON({ "/repo/evals/.keep": "" }, "/")).promises;
    mocks.failedLstatTarget = undefined;
    mocks.failedMkdirTarget = undefined;
    mocks.failedWriteSuffix = undefined;
    mocks.racedWriteSuffix = undefined;
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

  it("requires a target repo instead of scaffolding a default that cannot be cloned", async () => {
    await expect(
      evalInit({ sourceDir: "/repo/evals", name: "no-target-task", kind: "plan" })
    ).rejects.toThrow(
      "Target repository is required. Pass --target-repo <git-url>, for example --target-repo https://github.com/owner/repo.git."
    );
    await expect(mocks.fs.stat("/repo/evals/no-target-task")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects a target repo git cannot clone before scaffolding", async () => {
    await expect(
      evalInit({
        sourceDir: "/repo/evals",
        name: "bad-target-task",
        kind: "plan",
        targetRepo: "git+https://github.com/poe-platform/poe-code.git"
      })
    ).rejects.toThrow(
      'target.repo "git+https://github.com/poe-platform/poe-code.git" uses unsupported scheme "git+https".'
    );
    await expect(mocks.fs.stat("/repo/evals/bad-target-task")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("writes eval.yaml that passes schema validation without a scorer block", async () => {
    await evalInit({
      sourceDir: "/repo/evals",
      name: "schema-task",
      kind: "plan",
      targetRepo: "https://github.com/owner/repo.git"
    });

    const parsed = parseYaml(await read("schema-task/eval.yaml")) as Record<string, unknown>;
    const evalYaml = validateEvalYaml(parsed, "/repo/evals/schema-task/eval.yaml");

    expect(parsed.scorer).toBeUndefined();
    expect(evalYaml).toMatchObject({
      id: "schema-task",
      title: "Schema Task",
      target: {
        repo: "https://github.com/owner/repo.git",
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
        tests: 1,
        judge: 0
      },
      metrics: expect.arrayContaining([
        expect.objectContaining({ id: "task_completion", threshold: 1 }),
        expect.objectContaining({ id: "plan_adherence", evaluator: { kind: "judge" } }),
        expect.objectContaining({ id: "tool_correctness" }),
        expect.objectContaining({ id: "step_efficiency" })
      ])
    });
  });

  it("writes plan.md frontmatter with the selected kind", async () => {
    await evalInit({
      sourceDir: "/repo/evals",
      name: "super-task",
      kind: "superintendent",
      targetRepo: "https://github.com/owner/repo.git"
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
        kind: "plan",
        targetRepo: "https://github.com/owner/repo.git"
      })
    ).rejects.toThrow("Eval folder already exists: /repo/evals/existing-task");
  });

  it("does not treat inherited mkdir error codes as existing eval folders", async () => {
    mocks.failedMkdirTarget = "/repo/evals/blocked-task";

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(
        evalInit({
          sourceDir: "/repo/evals",
          name: "blocked-task",
          kind: "plan",
          targetRepo: "https://github.com/owner/repo.git"
        })
      ).rejects.toThrow("mkdir denied");
    });
  });

  it("removes an incomplete scaffold so initialization can be retried", async () => {
    mocks.failedWriteSuffix = "/plan.md";

    await expect(
      evalInit({
        sourceDir: "/repo/evals",
        name: "partial-task",
        kind: "plan",
        targetRepo: "https://github.com/owner/repo.git"
      })
    ).rejects.toThrow("scaffold write failed");
    await expect(mocks.fs.stat("/repo/evals/partial-task")).rejects.toMatchObject({ code: "ENOENT" });

    mocks.failedWriteSuffix = undefined;
    await expect(
      evalInit({
        sourceDir: "/repo/evals",
        name: "partial-task",
        kind: "plan",
        targetRepo: "https://github.com/owner/repo.git"
      })
    ).resolves.toMatchObject({ evalDir: "/repo/evals/partial-task" });
  });

  it("does not treat inherited lstat error codes as missing source directories", async () => {
    mocks.failedLstatTarget = "/repo/evals";

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        evalInit({
          sourceDir: "/repo/evals",
          name: "denied-task",
          kind: "plan",
          targetRepo: "https://github.com/owner/repo.git"
        })
      ).rejects.toThrow("source lstat denied");
    });

    await expect(mocks.fs.stat("/repo/evals/denied-task")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects a source directory symlink before writing scaffold files", async () => {
    mocks.fs = createFsFromVolume(Volume.fromJSON({ "/repo": null, "/outside": null }, "/")).promises;
    await mocks.fs.symlink("/outside", "/repo/evals");

    await expect(
      evalInit({
        sourceDir: "/repo/evals",
        name: "escaped-task",
        kind: "plan",
        targetRepo: "https://github.com/owner/repo.git"
      })
    ).rejects.toThrow("Eval source directory must not be a symbolic link.");
    await expect(mocks.fs.readFile("/outside/escaped-task/eval.yaml", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not overwrite a scaffold file symlink inserted before publish", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON({ "/repo/evals/.keep": "", "/outside/secret.txt": "keep\n" }, "/")
    ).promises;
    mocks.racedWriteSuffix = "/eval.yaml";

    await expect(
      evalInit({
        sourceDir: "/repo/evals",
        name: "raced-task",
        kind: "plan",
        targetRepo: "https://github.com/owner/repo.git"
      })
    ).rejects.toMatchObject({ code: "EEXIST" });
    await expect(mocks.fs.readFile("/outside/secret.txt", "utf8")).resolves.toBe("keep\n");
    await expect(mocks.fs.stat("/repo/evals/raced-task")).rejects.toMatchObject({ code: "ENOENT" });
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

  it("rejects an invalid name as a user error carrying an example name", () => {
    expect(() => validateInitName("task_name")).toThrow(
      expect.objectContaining({ name: "UserError" })
    );
    expect(() => validateInitName("task_name")).toThrow("my-eval");
  });

  it.each(["/tmp/ux-eval-test", "./evals/smoke", "evals/smoke", "C:\\evals\\smoke"])(
    "names %s as path-like instead of restating the kebab-case rule",
    (name) => {
      expect(() => validateInitName(name)).toThrow(
        expect.objectContaining({ name: "UserError" })
      );
      expect(() => validateInitName(name)).toThrow("looks like a path");
      expect(() => validateInitName(name)).toThrow("my-eval");
      expect(() => validateInitName(name)).not.toThrow("must be kebab-case");
    }
  );
});

async function read(relativePath: string): Promise<string> {
  return mocks.fs.readFile(path.join("/repo/evals", relativePath), "utf8");
}
