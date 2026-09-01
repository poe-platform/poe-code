import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { isUserError } from "@poe-code/user-error";
import { resolveRunLogDir } from "@poe-code/agent-harness-tools";
import { loadPipelineConfig, loadResolvedSteps } from "./config/loader.js";
import { resolvePlanDirectory, resolvePlanPath, resolvePlanPaths } from "./plan/discovery.js";
import { parsePlan, pipelineDocumentSchema, pipelineDocumentSchemaId } from "./plan/parser.js";
import { readPlanFile, writeTaskStatus } from "./plan/writer.js";
import {
  buildExecutionPrompt,
  resolveFileIncludes,
  selectNextExecution,
  type ExecutionSelection
} from "./run/runner.js";
import { interpolatePipelineVars } from "./vars/interpolate.js";
import { resolvePipelineVars } from "./vars/resolve.js";
import { runPipeline } from "./run/pipeline.js";
import { createPipelineSimulation, failTurn, successTurn } from "./testing/simulation.js";
import type {
  AgentRunUsage,
  AgentRunInput,
  AgentRunResult,
  PipelineFileSystem,
  PipelineMetrics,
  PipelinePlan,
  PipelineRunOptions,
  PipelineRunResult,
  PipelineTask,
  ResolvedStepDefinitions,
  StepDefinition
} from "@poe-code/pipeline";

type TestFs = ReturnType<typeof createFsFromVolume>["promises"];

function createFs(files: Record<string, string> = {}): TestFs {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises;
}

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

function createPipelineTestFs(rawFs: TestFs): PipelineFileSystem {
  return {
    readFile: (filePath, encoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
    writeFile: (filePath, data, options) =>
      rawFs.writeFile(filePath, data, options) as Promise<void>,
    readdir: (filePath) => rawFs.readdir(filePath) as Promise<string[]>,
    stat: async (filePath) => {
      const stat = await rawFs.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: Number(stat.mtimeMs)
      };
    },
    lstat: async (filePath) => {
      const stat = await rawFs.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    mkdir: (filePath, options) => rawFs.mkdir(filePath, options) as Promise<void>,
    realpath: (filePath: string) => rawFs.realpath(filePath) as Promise<string>,
    rmdir: (filePath) => rawFs.rmdir(filePath) as Promise<void>,
    rename: (oldPath, newPath) => rawFs.rename(oldPath, newPath) as Promise<void>,
    unlink: (filePath) => rawFs.unlink(filePath) as Promise<void>
  } as PipelineFileSystem;
}

const PIPELINE_MD_EMPTY = ["---", "kind: pipeline", "version: 1", "tasks: []", "---", ""].join(
  "\n"
);

function pipelinePlanYaml(lines: string[]): string {
  return ["kind: pipeline", "version: 1", ...lines].join("\n");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("@poe-code/pipeline public exports", () => {
  it("re-exports the document schema from the package entrypoint", async () => {
    const pkg = await import("./index.js");
    const parser = await import("./plan/parser.js");

    expect(pkg.pipelineDocumentSchema).toBe(parser.pipelineDocumentSchema);
    expect(pkg.pipelineDocumentSchemaId).toBe(parser.pipelineDocumentSchemaId);
    expect(pkg.PIPELINE_STEP_MODES).toEqual(["yolo", "auto", "edit", "read"]);
  });

  it("exports SDK types", () => {
    const step: StepDefinition = {
      mode: "yolo",
      prompt: "Implement {{id}}"
    };
    const steps: ResolvedStepDefinitions = {
      implement: step
    };
    const task: PipelineTask = {
      id: "task-1",
      title: "Task one",
      prompt: "Fix it",
      status: "open"
    };
    const plan: PipelinePlan = {
      tasks: [task]
    };
    const input: AgentRunInput = {
      agent: "codex",
      prompt: "Fix it",
      mode: "yolo",
      cwd: "/repo"
    };
    const result: AgentRunResult = {
      stdout: "",
      stderr: "",
      exitCode: 0,
      usage: {
        inputTokens: 10,
        outputTokens: 5
      }
    };
    const metrics: PipelineMetrics = {
      totalInputTokens: 10,
      totalOutputTokens: 5,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 0
    };
    const usage: AgentRunUsage = {
      inputTokens: 10,
      outputTokens: 5
    };
    const options: PipelineRunOptions = {
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test"
    };
    const runResult = null as unknown as PipelineRunResult;

    expect(step.mode).toBe("yolo");
    expect(Object.keys(steps)).toEqual(["implement"]);
    expect(plan.tasks).toHaveLength(1);
    expect(pipelineDocumentSchemaId).toBe(
      "https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json"
    );
    expect(pipelineDocumentSchema).toMatchObject({
      $id: pipelineDocumentSchemaId,
      type: "object",
      properties: {
        kind: { const: "pipeline" },
        version: { type: "integer" },
        tasks: { type: "array" }
      },
      required: ["kind", "version", "tasks"]
    });

    void input;
    void result;
    void options;
    void runResult;
    void metrics;
    void usage;
  });
});

describe("loadResolvedSteps", () => {
  it("uses the default named config when a plan omits extends", async () => {
    const plan = parsePlan(pipelinePlanYaml(["tasks: []", ""])) as PipelinePlan & {
      extends?: string;
      stepOverrides?: Record<string, unknown>;
    };

    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  implement:",
          "    prompt: Implement {{id}}",
          ""
        ].join("\n")
      }),
      name: plan.extends,
      stepOverrides: plan.stepOverrides
    } as Parameters<typeof loadResolvedSteps>[0]);

    expect(plan.extends).toBe("default");
    expect(config.steps).toEqual({
      implement: {
        prompt: "Implement {{id}}"
      }
    });
  });

  it("loads a named step config selected by plan extends", async () => {
    const plan = parsePlan(pipelinePlanYaml(["extends: fast", "tasks: []", ""])) as PipelinePlan & {
      extends?: string;
      stepOverrides?: Record<string, unknown>;
    };

    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  implement:",
          "    prompt: Default implement",
          ""
        ].join("\n"),
        "/repo/.poe-code/pipeline/steps/fast.yaml": [
          "steps:",
          "  implement:",
          "    mode: read",
          "    prompt: Fast implement",
          ""
        ].join("\n")
      }),
      name: plan.extends,
      stepOverrides: plan.stepOverrides
    } as Parameters<typeof loadResolvedSteps>[0]);

    expect(config.steps).toEqual({
      implement: {
        mode: "read",
        prompt: "Fast implement"
      }
    });
  });

  it("deep merges inline plan step overrides with the named base config", async () => {
    const plan = parsePlan(
      [
        "kind: pipeline",
        "version: 1",
        "extends: default",
        "steps:",
        "  implement:",
        "    prompt: Project implement",
        "tasks: []",
        ""
      ].join("\n")
    ) as PipelinePlan & {
      extends?: string;
      stepOverrides?: Record<string, unknown>;
    };

    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  implement:",
          "    mode: read",
          "    prompt: Base implement",
          "    agent: codex",
          "    model: o3",
          ""
        ].join("\n")
      }),
      name: plan.extends,
      stepOverrides: plan.stepOverrides
    } as Parameters<typeof loadResolvedSteps>[0]);

    expect(config.steps).toEqual({
      implement: {
        mode: "read",
        prompt: "Project implement",
        agent: "codex",
        model: "o3"
      }
    });
  });

  it("resolves an inline step override named __proto__", async () => {
    const plan = parsePlan(
      pipelinePlanYaml(["steps:", "  __proto__:", "    prompt: Override prompt", "tasks: []", ""])
    );
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs(),
      stepOverrides: plan.stepOverrides
    });

    expect(Object.hasOwn(plan.stepOverrides ?? {}, "__proto__")).toBe(true);
    expect(Object.hasOwn(config.steps, "__proto__")).toBe(true);
    expect(config.steps.__proto__).toEqual({ prompt: "Override prompt" });
  });

  it("loads a named step definition named __proto__", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  __proto__:",
          "    prompt: Execute custom step",
          ""
        ].join("\n")
      })
    });

    expect(Object.hasOwn(config.steps, "__proto__")).toBe(true);
    expect(config.steps.__proto__).toEqual({ prompt: "Execute custom step" });
    expect(Object.getPrototypeOf(config.steps)).toBe(Object.prototype);
  });

  it("ignores inherited step config sections", async () => {
    await withObjectPrototypeProperties(
      {
        steps: { implement: { prompt: "Polluted step" } },
        setup: { prompt: "Polluted setup" },
        teardown: { prompt: "Polluted teardown" }
      },
      async () => {
        const config = await loadResolvedSteps({
          cwd: "/repo",
          homeDir: "/home/test",
          fs: createFs({
            "/repo/.poe-code/pipeline/steps/default.yaml": "{}\n"
          })
        });

        expect(config).toEqual({ steps: {} });
      }
    );
  });

  it("rejects traversal in named step configuration names", async () => {
    await expect(
      loadResolvedSteps({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/pipeline/steps/placeholder.yaml": "steps: {}\n",
          "/repo/.poe-code/pipeline/outside.yaml": "steps:\n  implement:\n    prompt: Escaped instructions\n"
        }),
        name: "../outside"
      })
    ).rejects.toThrow(/invalid pipeline step config name/i);
  });

  it.each([
    ["project steps file", "/repo/.poe-code/pipeline/steps.yaml", "/outside/steps.yaml"],
    ["global pipeline directory", "/home/test/.poe-code/pipeline", "/outside"],
    ["global steps directory", "/home/test/.poe-code/pipeline/steps", "/outside/steps"],
    ["project steps directory", "/repo/.poe-code/pipeline/steps", "/outside/steps"]
  ])("rejects a symlinked %s", async (_label, linkPath, targetPath) => {
    const volume = Volume.fromJSON({
      "/outside/steps.yaml": "steps:\n  review:\n    prompt: External step\n",
      "/outside/steps/default.yaml": "steps:\n  review:\n    prompt: External step\n"
    });
    volume.mkdirSync(path.dirname(linkPath), { recursive: true });
    volume.symlinkSync(targetPath, linkPath);
    const fs = createFsFromVolume(volume).promises;

    await expect(
      loadResolvedSteps({ cwd: "/repo", homeDir: "/home/test", fs, name: "default" })
    ).rejects.toThrow(/symbolic link/i);
  });

  it("throws a clear error when plan extends an unknown named config", async () => {
    await expect(
      loadResolvedSteps({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/pipeline/steps/default.yaml": [
            "steps:",
            "  implement:",
            "    prompt: Default implement",
            ""
          ].join("\n")
        }),
        name: "fast"
      } as Parameters<typeof loadResolvedSteps>[0])
    ).rejects.toThrow(/unknown.*step config.*fast/i);
  });

  it("returns empty config when no step config files exist", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs()
    });

    expect(config).toEqual({ steps: {} });
  });

  it("returns empty steps for a comment-only default step config", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "# This is all comments",
          "# No actual steps defined",
          ""
        ].join("\n")
      })
    });

    expect(config).toEqual({ steps: {} });
  });

  it("loads global steps when only the home config exists", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  implement:",
          "    prompt: |",
          "      Implement {{id}}",
          ""
        ].join("\n")
      })
    });

    expect(config.steps).toEqual({
      implement: {
        prompt: "Implement {{id}}\n"
      }
    });
  });

  it("prefers the project steps directory over the global directory", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  implement:",
          "    mode: read",
          "    prompt: Global instruction",
          "    agent: codex",
          "    model: o3",
          "  test:",
          "    prompt: Run tests",
          ""
        ].join("\n"),
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  implement:",
          "    prompt: Project instruction",
          "  commit:",
          "    prompt: Commit changes",
          ""
        ].join("\n")
      })
    });

    expect(config.steps).toEqual({
      implement: {
        prompt: "Project instruction"
      },
      commit: {
        prompt: "Commit changes"
      }
    });
  });

  it("loads a named config from the global directory when no project directory exists", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      name: "fast",
      fs: createFs({
        "/home/test/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  implement:",
          "    prompt: Global instruction",
          ""
        ].join("\n"),
        "/home/test/.poe-code/pipeline/steps/fast.yaml": [
          "steps:",
          "  implement:",
          "    mode: read",
          "    prompt: Fast instruction",
          ""
        ].join("\n")
      })
    });

    expect(config.steps).toEqual({
      implement: {
        mode: "read",
        prompt: "Fast instruction"
      }
    });
  });

  it("throws when the selected named config does not exist in the project directory", async () => {
    await expect(
      loadResolvedSteps({
        cwd: "/repo",
        homeDir: "/home/test",
        name: "fast",
        fs: createFs({
          "/home/test/.poe-code/pipeline/steps/fast.yaml": [
            "steps:",
            "  implement:",
            "    prompt: Global fast",
            ""
          ].join("\n"),
          "/repo/.poe-code/pipeline/steps/default.yaml": [
            "steps:",
            "  implement:",
            "    prompt: Project default",
            ""
          ].join("\n")
        })
      })
    ).rejects.toThrow(/unknown.*step config.*fast/i);
  });

  it("loads a specific named config from the project directory", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      name: "fast",
      fs: createFs({
        "/home/test/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  implement:",
          "    prompt: Global default",
          ""
        ].join("\n"),
        "/repo/.poe-code/pipeline/steps/fast.yaml": [
          "steps:",
          "  implement:",
          "    mode: read",
          "    prompt: Project fast",
          ""
        ].join("\n")
      })
    });

    expect(config.steps).toEqual({
      implement: {
        mode: "read",
        prompt: "Project fast"
      }
    });
  });

  it("throws for invalid yaml", async () => {
    await expect(
      loadResolvedSteps({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/pipeline/steps/default.yaml": "steps: ["
        })
      })
    ).rejects.toThrow(/invalid pipeline step config yaml/i);
  });

  it("leaves missing mode unset and still requires instruction", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  implement:",
          "    prompt: Implement",
          "  review:",
          "    mode: read",
          "    prompt: Review",
          ""
        ].join("\n")
      })
    });

    expect(config.steps).toEqual({
      implement: {
        prompt: "Implement"
      },
      review: {
        mode: "read",
        prompt: "Review"
      }
    });

    await expect(
      loadResolvedSteps({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/pipeline/steps/default.yaml": [
            "steps:",
            "  implement:",
            "    mode: read",
            "  test:",
            "    prompt: Run tests",
            ""
          ].join("\n")
        })
      })
    ).rejects.toThrow(/missing prompt/i);
  });

  it("accepts auto as an explicit step mode", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  implement:",
          "    mode: auto",
          "    prompt: Implement",
          ""
        ].join("\n")
      })
    });

    expect(config.steps.implement?.mode).toBe("auto");
  });

  it("does not accept inherited step definition fields", async () => {
    await withObjectPrototypeProperties(
      {
        prompt: "Polluted prompt",
        agent: "polluted-agent",
        model: "polluted-model",
        mode: "read",
        skills: ["polluted"],
        hooks: { from: "polluted" }
      },
      async () => {
        await expect(
          loadResolvedSteps({
            cwd: "/repo",
            homeDir: "/home/test",
            fs: createFs({
              "/repo/.poe-code/pipeline/steps/default.yaml": [
                "steps:",
                "  implement: {}",
                ""
              ].join("\n")
            })
          })
        ).rejects.toThrow(/missing prompt for step "implement"/i);

        const config = await loadResolvedSteps({
          cwd: "/repo",
          homeDir: "/home/test",
          fs: createFs({
            "/repo/.poe-code/pipeline/steps/default.yaml": [
              "steps:",
              "  implement:",
              "    prompt: Implement",
              ""
            ].join("\n")
          })
        });

        expect(config.steps).toEqual({
          implement: {
            prompt: "Implement"
          }
        });
      }
    );
  });

  it("does not accept inherited step hook fields", async () => {
    await withObjectPrototypeProperties({ from: "polluted" }, async () => {
      await expect(
        loadResolvedSteps({
          cwd: "/repo",
          homeDir: "/home/test",
          fs: createFs({
            "/repo/.poe-code/pipeline/steps/default.yaml": [
              "steps:",
              "  implement:",
              "    prompt: Implement",
              "    hooks: {}",
              ""
            ].join("\n")
          })
        })
      ).rejects.toThrow(/invalid hooks from for step "implement"/i);
    });
  });

  it("parses per-step agent and model overrides", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  implement:",
          "    prompt: Implement",
          "    agent: codex",
          "    model: o3",
          "  review:",
          "    prompt: Review",
          "    agent: claude-code",
          "  commit:",
          "    prompt: Commit",
          ""
        ].join("\n")
      })
    });

    expect(config.steps).toEqual({
      implement: {
        prompt: "Implement",
        agent: "codex",
        model: "o3"
      },
      review: {
        prompt: "Review",
        agent: "claude-code"
      },
      commit: {
        prompt: "Commit"
      }
    });
  });

  it("parses per-step skills and leaves steps without skills unchanged", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  implement:",
          "    prompt: Implement",
          "    skills: [foo, claude/bar]",
          "  review:",
          "    prompt: Review",
          ""
        ].join("\n")
      })
    });

    expect(config.steps).toEqual({
      implement: {
        prompt: "Implement",
        skills: ["foo", "claude/bar"]
      },
      review: {
        prompt: "Review"
      }
    });
  });

  it("parses minimal and full per-step hooks while leaving absent hooks unchanged", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "steps:",
          "  minimal:",
          "    prompt: Minimal hooks",
          "    hooks:",
          "      from: claude",
          "  full:",
          "    prompt: Full hooks",
          "    hooks:",
          "      from: claude",
          "      strategy: transform",
          "      scope: merged",
          "  plain:",
          "    prompt: No hooks",
          ""
        ].join("\n")
      })
    });

    expect(config.steps).toEqual({
      minimal: {
        prompt: "Minimal hooks",
        hooks: { from: "claude" }
      },
      full: {
        prompt: "Full hooks",
        hooks: { from: "claude", strategy: "transform", scope: "merged" }
      },
      plain: {
        prompt: "No hooks"
      }
    });
  });

  it("rejects an invalid per-step hooks strategy with a precise error", async () => {
    await expect(
      loadResolvedSteps({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/pipeline/steps/default.yaml": [
            "steps:",
            "  implement:",
            "    prompt: Implement",
            "    hooks:",
            "      from: claude",
            "      strategy: copy",
            ""
          ].join("\n")
        })
      })
    ).rejects.toThrow(
      'Invalid hooks strategy for step "implement" in "/repo/.poe-code/pipeline/steps/default.yaml": expected "auto", "symlink", or "transform".'
    );
  });

  it("rejects malformed per-step skills", async () => {
    await expect(
      loadResolvedSteps({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/pipeline/steps/default.yaml": [
            "steps:",
            "  implement:",
            "    prompt: Implement",
            "    skills: [foo/bar/baz]",
            ""
          ].join("\n")
        })
      })
    ).rejects.toThrow(/expected skill references/i);

    await expect(
      loadResolvedSteps({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/pipeline/steps/default.yaml": [
            "steps:",
            "  implement:",
            "    prompt: Implement",
            "    skills: foo",
            ""
          ].join("\n")
        })
      })
    ).rejects.toThrow(/expected an array of strings/i);
  });

  it("parses setup and teardown from the default step config", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "setup:",
          "  prompt: Prepare the workspace",
          "teardown:",
          "  mode: read",
          "  prompt: Verify and clean up",
          "steps:",
          "  commit:",
          "    prompt: Commit changes",
          ""
        ].join("\n")
      })
    });

    expect(config.setup).toEqual({ prompt: "Prepare the workspace" });
    expect(config.teardown).toEqual({ mode: "read", prompt: "Verify and clean up" });
    expect(config.steps).toEqual({ commit: { prompt: "Commit changes" } });
  });

  it("uses only project setup and teardown when the project steps directory exists", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/steps/default.yaml": [
          "setup:",
          "  mode: read",
          "  prompt: Global setup",
          "  agent: codex",
          "  model: o3",
          "teardown:",
          "  prompt: Global teardown",
          ""
        ].join("\n"),
        "/repo/.poe-code/pipeline/steps/default.yaml": [
          "setup:",
          "  prompt: Project setup",
          ""
        ].join("\n")
      })
    });

    expect(config.setup).toEqual({ prompt: "Project setup" });
    expect(config.teardown).toBeUndefined();
  });

  it("ignores inherited inline step override fields", async () => {
    await withObjectPrototypeProperties(
      {
        prompt: "Polluted prompt",
        agent: "polluted-agent",
        model: "polluted-model",
        mode: "read",
        skills: ["polluted"],
        hooks: { from: "polluted" }
      },
      async () => {
        const config = await loadResolvedSteps({
          cwd: "/repo",
          homeDir: "/home/test",
          fs: createFs({
            "/repo/.poe-code/pipeline/steps/default.yaml": [
              "steps:",
              "  implement:",
              "    mode: edit",
              "    prompt: Base implement",
              "    agent: codex",
              "    model: o3",
              ""
            ].join("\n")
          }),
          stepOverrides: {
            implement: {}
          } as Parameters<typeof loadResolvedSteps>[0]["stepOverrides"]
        });

        expect(config.steps).toEqual({
          implement: {
            mode: "edit",
            prompt: "Base implement",
            agent: "codex",
            model: "o3"
          }
        });
      }
    );
  });

  it("requires instruction for setup and teardown", async () => {
    await expect(
      loadResolvedSteps({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/pipeline/steps/default.yaml": "setup:\n  mode: read\n"
        })
      })
    ).rejects.toThrow(/missing prompt for setup/i);
  });
});

describe("loadPipelineConfig", () => {
  it("deep merges project config with global config", async () => {
    const config = await loadPipelineConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/config.yaml": [
          "defaults:",
          "  agent: codex",
          "  execution:",
          "    mode: read",
          "    retries: 1",
          ""
        ].join("\n"),
        "/repo/.poe-code/pipeline/config.yaml": [
          "defaults:",
          "  execution:",
          "    retries: 3",
          ""
        ].join("\n")
      })
    });

    expect(config).toEqual({
      defaults: {
        agent: "codex",
        execution: {
          mode: "read",
          retries: 3
        }
      }
    });
  });

  it("ignores inherited plan_directory values", async () => {
    await withObjectPrototypeProperties({ plan_directory: 123 }, async () => {
      const config = await loadPipelineConfig({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/pipeline/config.yaml": "{}\n"
        })
      });

      expect(config).toEqual({});
    });
  });

  it("rejects a symlinked global pipeline configuration directory", async () => {
    const volume = Volume.fromJSON({
      "/repo/.poe-code/pipeline/config.yaml": "extends: true\n",
      "/outside/config.yaml": "plan_directory: external/plans\n"
    });
    volume.mkdirSync("/home/test/.poe-code", { recursive: true });
    volume.symlinkSync("/outside", "/home/test/.poe-code/pipeline");

    await expect(
      loadPipelineConfig({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFsFromVolume(volume).promises
      })
    ).rejects.toThrow(/symbolic link/i);
  });

  it("does not auto-extend when the project config sets extends to false", async () => {
    const config = await loadPipelineConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/config.yaml": ["defaults:", "  agent: codex", ""].join("\n"),
        "/repo/.poe-code/pipeline/config.yaml": ["extends: false", ""].join("\n")
      })
    });

    expect(config).toEqual({});
  });
});

describe("resolvePlanPath", () => {
  it("reports a missing explicit --plan as a user error naming the path and a recovery", async () => {
    const error = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({}),
      plan: "missing.md"
    }).catch((thrown: unknown) => thrown);

    expect(isUserError(error)).toBe(true);
    expect((error as Error).message).toContain('Plan not found at "missing.md".');
    expect((error as Error).message).toContain("pipeline show-plan-path");
  });

  it("reports a directory passed as --plan as a user error", async () => {
    const fs = createFs({});
    await fs.mkdir("/repo/docs/plans", { recursive: true });

    const error = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      plan: "docs/plans"
    }).catch((thrown: unknown) => thrown);

    expect(isUserError(error)).toBe(true);
    expect((error as Error).message).toContain('Plan not found at "docs/plans".');
  });

  it("returns the explicit --plan path without discovery", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/custom.yaml": "tasks: []\n"
      }),
      plan: "custom.yaml"
    });

    expect(result).toBe("custom.yaml");
  });

  it("accepts a home-relative explicit --plan path", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/docs/plans/feature.md": PIPELINE_MD_EMPTY
      }),
      plan: "~/.poe-code/docs/plans/feature.md"
    });

    expect(result).toBe("~/.poe-code/docs/plans/feature.md");
  });

  it("ignores config planPath when discovering plans", async () => {
    const selectPlan = vi.fn().mockResolvedValue("docs/plans/plan-demo.md");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "docs/plans",
      fs: createFs({
        "/repo/.poe-code/pipeline/config.yaml": "planPath: local-plan.yaml\n",
        "/repo/local-plan.yaml": "tasks: []\n",
        "/repo/docs/plans/plan-demo.md": PIPELINE_MD_EMPTY
      }),
      selectPlan
    });

    expect(selectPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [{ label: "docs/plans/plan-demo.md (0/0)", value: "docs/plans/plan-demo.md" }]
      })
    );
    expect(result).toBe("docs/plans/plan-demo.md");
  });

  it("prompts for selection even with a single discovered plan", async () => {
    const select = vi.fn().mockResolvedValue("docs/plans/plan-demo.md");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/docs/plans/plan-demo.md": PIPELINE_MD_EMPTY
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          {
            label: "docs/plans/plan-demo.md (0/0)",
            value: "docs/plans/plan-demo.md"
          }
        ]
      })
    );
    expect(result).toBe("docs/plans/plan-demo.md");
  });

  it("returns null with a single plan when no selectPlan callback is provided", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/docs/plans/plan-demo.md": PIPELINE_MD_EMPTY
      })
    });

    expect(result).toBeNull();
  });

  it("requires an explicit --plan with --yes even when a single plan is discovered", async () => {
    await expect(
      resolvePlanPath({
        cwd: "/repo",
        homeDir: "/home/test",
        assumeYes: true,
        fs: createFs({
          "/repo/docs/plans/plan-demo.md": PIPELINE_MD_EMPTY
        })
      })
    ).rejects.toThrow(/--plan[\s\S]*docs\/plans\/plan-demo\.md/);
  });

  it("lists every candidate instead of autopicking the first plan with --yes", async () => {
    await expect(
      resolvePlanPath({
        cwd: "/repo",
        homeDir: "/home/test",
        assumeYes: true,
        fs: createFs({
          "/repo/docs/plans/plan-beta.md": PIPELINE_MD_EMPTY,
          "/repo/docs/plans/plan-alpha.md": PIPELINE_MD_EMPTY
        })
      })
    ).rejects.toThrow(/docs\/plans\/plan-alpha\.md[\s\S]*docs\/plans\/plan-beta\.md/);
  });

  it("prompts when multiple plans exist", async () => {
    const select = vi.fn().mockResolvedValue("docs/plans/plan-beta.md");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/docs/plans/plan-beta.md": [
          "---",
          "kind: pipeline",
          "version: 1",
          "tasks:",
          "  - id: one",
          "    title: One",
          "    prompt: One",
          "    status: open",
          "---",
          ""
        ].join("\n"),
        "/repo/docs/plans/plan-alpha.md": [
          "---",
          "kind: pipeline",
          "version: 1",
          "tasks:",
          "  - id: one",
          "    title: One",
          "    prompt: One",
          "    status: done",
          "  - id: two",
          "    title: Two",
          "    prompt: Two",
          "    status: open",
          "---",
          ""
        ].join("\n")
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          {
            label: "docs/plans/plan-alpha.md (1/2)",
            value: "docs/plans/plan-alpha.md"
          },
          {
            label: "docs/plans/plan-beta.md (0/1)",
            value: "docs/plans/plan-beta.md"
          }
        ]
      })
    );
    expect(result).toBe("docs/plans/plan-beta.md");
  });

  it("lists ready pipeline plans by newest modification time before drafts", async () => {
    const readyOlder = PIPELINE_MD_EMPTY.replace("kind: pipeline", "kind: pipeline\nreadiness: ready");
    const readyNewer = PIPELINE_MD_EMPTY.replace("kind: pipeline", "kind: pipeline\nreadiness: ready");
    const fs = createFs({
      "/repo/docs/plans/ready-older.md": readyOlder,
      "/repo/docs/plans/ready-newer.md": readyNewer,
      "/repo/docs/plans/draft.md": PIPELINE_MD_EMPTY
    });
    await fs.utimes("/repo/docs/plans/ready-older.md", 1, 1);
    await fs.utimes("/repo/docs/plans/ready-newer.md", 3, 3);
    await fs.utimes("/repo/docs/plans/draft.md", 4, 4);
    const select = vi.fn().mockResolvedValue("docs/plans/ready-newer.md");

    await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      selectPlan: select
    });

    expect(select.mock.calls[0]?.[0].options.map((option: { value: string }) => option.value)).toEqual([
      "docs/plans/ready-newer.md",
      "docs/plans/ready-older.md",
      "docs/plans/draft.md"
    ]);
  });

  it("returns null when no plans exist and interactive mode can prompt for a path", async () => {
    const promptForPath = vi.fn().mockResolvedValue("manual-plan.yaml");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs(),
      promptForPath
    });

    expect(promptForPath).toHaveBeenCalled();
    expect(result).toBe("manual-plan.yaml");
  });

  it("throws when no plans exist and --yes is set", async () => {
    await expect(
      resolvePlanPath({
        cwd: "/repo",
        homeDir: "/home/test",
        assumeYes: true,
        fs: createFs()
      })
    ).rejects.toThrow(/no plan found/i);
  });

  it("scans only the custom planDirectory when provided", async () => {
    const select = vi.fn().mockResolvedValue("custom-plans/plan-custom.md");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "custom-plans",
      fs: createFs({
        "/repo/custom-plans/plan-custom.md": PIPELINE_MD_EMPTY,
        "/repo/.poe-code/pipeline/plans/plan-default.md": PIPELINE_MD_EMPTY
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: "custom-plans/plan-custom.md (0/0)", value: "custom-plans/plan-custom.md" }
        ]
      })
    );
    expect(result).toBe("custom-plans/plan-custom.md");
  });

  it("lists candidates from a custom planDirectory instead of autopicking with --yes", async () => {
    await expect(
      resolvePlanPath({
        cwd: "/repo",
        homeDir: "/home/test",
        planDirectory: "/abs/plans",
        assumeYes: true,
        fs: createFs({
          "/abs/plans/plan-one.md": PIPELINE_MD_EMPTY
        })
      })
    ).rejects.toThrow(/\/abs\/plans\/plan-one\.md/);
  });

  it("resolves tilde planDirectory paths", async () => {
    const selectPlan = vi.fn().mockResolvedValue("~/my-plans/plan-tilde.md");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "~/my-plans",
      fs: createFs({
        "/home/test/my-plans/plan-tilde.md": PIPELINE_MD_EMPTY
      }),
      selectPlan
    });

    expect(result).toBe("~/my-plans/plan-tilde.md");
  });

  it("ignores yaml and yml plans during discovery", async () => {
    const select = vi.fn().mockResolvedValue("docs/plans/plan-current.md");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/docs/plans/plan-current.md": PIPELINE_MD_EMPTY,
        "/repo/docs/plans/plan-legacy.yaml": "tasks: []\n",
        "/repo/docs/plans/plan-older.yml": "tasks: []\n"
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          {
            label: "docs/plans/plan-current.md (0/0)",
            value: "docs/plans/plan-current.md"
          }
        ]
      })
    );
    expect(result).toBe("docs/plans/plan-current.md");
  });
});

describe("resolvePlanPaths", () => {
  it("returns explicit plans in the provided order", async () => {
    const result = await resolvePlanPaths({
      cwd: "/repo",
      homeDir: "/home/test",
      plans: ["plan-b.yaml", "plan-a.yaml"],
      fs: createFs({
        "/repo/plan-a.yaml": "tasks: []\n",
        "/repo/plan-b.yaml": "tasks: []\n"
      })
    });

    expect(result).toEqual(["plan-b.yaml", "plan-a.yaml"]);
  });

  it("prompts for multiselect when discovered plans exist", async () => {
    const selectPlans = vi
      .fn()
      .mockResolvedValue(["docs/plans/plan-alpha.md", "docs/plans/plan-beta.md"]);

    const result = await resolvePlanPaths({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/docs/plans/plan-beta.md": PIPELINE_MD_EMPTY,
        "/repo/docs/plans/plan-alpha.md": PIPELINE_MD_EMPTY
      }),
      selectPlans
    });

    expect(selectPlans).toHaveBeenCalledWith(
      expect.objectContaining({
        required: true,
        options: [
          {
            label: "docs/plans/plan-alpha.md (0/0)",
            value: "docs/plans/plan-alpha.md"
          },
          {
            label: "docs/plans/plan-beta.md (0/0)",
            value: "docs/plans/plan-beta.md"
          }
        ]
      })
    );
    expect(result).toEqual(["docs/plans/plan-alpha.md", "docs/plans/plan-beta.md"]);
  });

  it("refuses to autopick discovered plans with --yes", async () => {
    const selectPlans = vi.fn();

    await expect(
      resolvePlanPaths({
        cwd: "/repo",
        homeDir: "/home/test",
        assumeYes: true,
        fs: createFs({
          "/repo/docs/plans/plan-beta.md": PIPELINE_MD_EMPTY,
          "/repo/docs/plans/plan-alpha.md": PIPELINE_MD_EMPTY
        }),
        selectPlans
      })
    ).rejects.toThrow(/--plan/);
    expect(selectPlans).not.toHaveBeenCalled();
  });

  it("rejects a discovered plan with an empty step status map", async () => {
    await expect(resolvePlanPaths({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/docs/plans/plan.md": [
          "---",
          "kind: pipeline",
          "version: 1",
          "tasks:",
          "  - id: implement",
          "    title: Implement feature",
          "    prompt: Ship it",
          "    status: {}",
          "---",
          ""
        ].join("\n")
      }),
    })).rejects.toThrow(/status.*at least one step/i);
  });
});

describe("resolvePlanDirectory", () => {
  it("returns docs/plans relative to cwd when no planDirectory is set", () => {
    const result = resolvePlanDirectory({
      cwd: "/repo",
      homeDir: "/home/test"
    });

    expect(result).toBe("/repo/docs/plans");
  });

  it("uses custom planDirectory when provided", () => {
    const result = resolvePlanDirectory({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "custom-plans"
    });

    expect(result).toBe("/repo/custom-plans");
  });

  it("resolves tilde in custom planDirectory", () => {
    const result = resolvePlanDirectory({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "~/my-plans"
    });

    expect(result).toBe("/home/test/my-plans");
  });

  it("uses absolute custom planDirectory as-is", () => {
    const result = resolvePlanDirectory({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "/abs/plans"
    });

    expect(result).toBe("/abs/plans");
  });
});

describe("parsePlan", () => {
  it("parses markdown frontmatter and ignores the body", () => {
    const plan = parsePlan(
      [
        "---",
        "kind: pipeline",
        "version: 1",
        "vars:",
        "  plan_doc: docs/plans/my-feature.md",
        "tasks:",
        "  - id: task-1",
        "    title: Fix timeout",
        "    prompt: Fix the timeout regression",
        "    status: open",
        "---",
        "# Context",
        "",
        "The markdown body is for humans and agents.",
        ""
      ].join("\n")
    );

    expect(plan).toEqual({
      extends: "default",
      vars: {
        plan_doc: "docs/plans/my-feature.md"
      },
      tasks: [
        {
          id: "task-1",
          title: "Fix timeout",
          prompt: "Fix the timeout regression",
          status: "open"
        }
      ]
    });
  });

  it("allows arbitrary top-level metadata keys", () => {
    const plan = parsePlan(
      pipelinePlanYaml([
        "saved_for_later:",
        "  reason: Revisit when auth lands",
        "custom_owner: platform",
        "tasks: []",
        ""
      ])
    );

    expect(plan).toEqual({
      extends: "default",
      tasks: []
    });
  });

  it("rejects markdown frontmatter without a closing delimiter", () => {
    expect(() =>
      parsePlan(
        [
          "---",
          "kind: pipeline",
          "version: 1",
          "tasks:",
          "  - id: task-1",
          "    title: Fix timeout",
          "    prompt: Fix the timeout regression",
          "    status: open",
          "",
          "# Context",
          "Missing the closing frontmatter delimiter.",
          ""
        ].join("\n")
      )
    ).toThrow(/closing frontmatter delimiter/i);
  });

  it.each([
    ["kind", ["kind: ralph", "version: 1", "tasks: []", ""], /kind.*pipeline/i],
    ["version", ["kind: pipeline", "version: 2", "tasks: []", ""], /version.*1/i]
  ])("rejects an explicit incompatible %s", (_field, lines, expected) => {
    expect(() => parsePlan(lines.join("\n"))).toThrow(expected);
  });

  it.each([
    ["kind", ["version: 1", "tasks: []", ""], /missing required "kind"/i],
    ["version", ["kind: pipeline", "tasks: []", ""], /missing required "version"/i]
  ])("rejects plans missing required %s", (_field, lines, expected) => {
    expect(() => parsePlan(lines.join("\n"))).toThrow(expected);
  });

  it("parses a stepless task plan", () => {
    const plan = parsePlan(
      pipelinePlanYaml([
        "tasks:",
        "  - id: task-1",
        "    title: Fix timeout",
        "    prompt: Fix the timeout regression",
        "    status: open",
        ""
      ])
    );

    expect(plan).toEqual({
      extends: "default",
      tasks: [
        {
          id: "task-1",
          title: "Fix timeout",
          prompt: "Fix the timeout regression",
          status: "open"
        }
      ]
    });
  });

  it("parses a stepped task plan and preserves step order", () => {
    const plan = parsePlan(
      pipelinePlanYaml([
        "tasks:",
        "  - id: task-1",
        "    title: Harden auth",
        "    prompt: Improve auth validation",
        "    status:",
        "      implement: done",
        "      test: open",
        "      commit: open",
        ""
      ]),
      {
        availableSteps: {
          implement: { mode: "edit", prompt: "Implement" },
          test: { mode: "edit", prompt: "Test" },
          commit: { mode: "edit", prompt: "Commit" }
        }
      }
    );

    expect(plan.tasks[0]?.status).toEqual({
      implement: "done",
      test: "open",
      commit: "open"
    });
  });

  it("parses inline step skills and leaves inline steps without skills unchanged", () => {
    const plan = parsePlan(
      pipelinePlanYaml([
        "steps:",
        "  implement:",
        "    prompt: Implement",
        "    skills: [foo, claude/bar]",
        "  review:",
        "    prompt: Review",
        "tasks: []",
        ""
      ])
    );

    expect(plan.stepOverrides).toEqual({
      implement: {
        prompt: "Implement",
        skills: ["foo", "claude/bar"]
      },
      review: {
        prompt: "Review"
      }
    });
  });

  it("parses hooks from inline step definitions", () => {
    const plan = parsePlan(
      pipelinePlanYaml([
        "steps:",
        "  implement:",
        "    hooks:",
        "      from: claude",
        "      strategy: symlink",
        "      scope: project",
        "tasks: []",
        ""
      ])
    );

    expect(plan.stepOverrides).toEqual({
      implement: {
        hooks: { from: "claude", strategy: "symlink", scope: "project" }
      }
    });
  });

  it("rejects an invalid inline hooks strategy", () => {
    expect(() =>
      parsePlan(
        pipelinePlanYaml([
          "steps:",
          "  implement:",
          "    hooks:",
          "      from: claude",
          "      strategy: copy",
          "tasks: []",
          ""
        ])
      )
    ).toThrow(
      'Invalid plan YAML: "steps.implement.hooks.strategy" must be "auto", "symlink", or "transform".'
    );
  });

  it("rejects malformed inline step skills", () => {
    expect(() =>
      parsePlan(
        pipelinePlanYaml([
          "steps:",
          "  implement:",
          "    prompt: Implement",
          "    skills: [foo/bar/baz]",
          "tasks: []",
          ""
        ])
      )
    ).toThrow(/must contain skill references/i);

    expect(() =>
      parsePlan(
        pipelinePlanYaml([
          "steps:",
          "  implement:",
          "    prompt: Implement",
          "    skills: foo",
          "tasks: []",
          ""
        ])
      )
    ).toThrow(/must be an array of strings/i);
  });

  it.each([
    ["setup field", ["setup:", "  prompt: Prepare", "  agnet: codex", "tasks: []", ""], "setup.agnet"],
    ["setup model", ["setup:", "  prompt: Prepare", "  modle: o3", "tasks: []", ""], "setup.modle"],
    ["setup skills", ["setup:", "  prompt: Prepare", "  skils: [audit]", "tasks: []", ""], "setup.skils"],
    [
      "hook scope",
      ["setup:", "  prompt: Prepare", "  hooks:", "    from: pack", "    scoep: user", "tasks: []", ""],
      "setup.hooks.scoep"
    ],
    [
      "hook strategy",
      [
        "setup:",
        "  prompt: Prepare",
        "  hooks:",
        "    from: pack",
        "    stratgey: transform",
        "tasks: []",
        ""
      ],
      "setup.hooks.stratgey"
    ],
    ["teardown field", ["teardown:", "  prompt: Clean", "  agnet: codex", "tasks: []", ""], "teardown.agnet"],
    ["mcp field", ["mcp:", "  server:", "    command: node", "    argz: [server.mjs]", "tasks: []", ""], "mcp.server.argz"]
  ])("rejects unknown %s keys", (_name, lines, field) => {
    expect(() => parsePlan(pipelinePlanYaml(lines))).toThrow(new RegExp(String(field)));
  });

  it("allows mixed scalar and stepped tasks", () => {
    const plan = parsePlan(
      pipelinePlanYaml([
        "tasks:",
        "  - id: one",
        "    title: One",
        "    prompt: First",
        "    status: done",
        "  - id: two",
        "    title: Two",
        "    prompt: Second",
        "    status:",
        "      implement: open",
        ""
      ]),
      {
        availableSteps: {
          implement: { mode: "edit", prompt: "Implement" }
        }
      }
    );

    expect(plan.tasks).toHaveLength(2);
  });

  it("rejects duplicate task ids", () => {
    expect(() =>
      parsePlan(
        pipelinePlanYaml([
          "tasks:",
          "  - id: dup",
          "    title: One",
          "    prompt: A",
          "    status: open",
          "  - id: dup",
          "    title: Two",
          "    prompt: B",
          "    status: done",
          ""
        ])
      )
    ).toThrow(/duplicate task id/i);
  });

  it("rejects unknown task properties", () => {
    expect(() =>
      parsePlan(
        pipelinePlanYaml([
          "tasks:",
          "  - id: task-1",
          "    title: Fix timeout",
          "    prompt: Fix the timeout regression",
          "    status: open",
          "    typo: should-fail",
          ""
        ])
      )
    ).toThrow(/tasks\[0\]\.typo/);
  });

  it("rejects invalid scalar task statuses", () => {
    expect(() =>
      parsePlan(
        pipelinePlanYaml([
          "tasks:",
          "  - id: task-1",
          "    title: Invalid",
          "    prompt: Invalid",
          "    status: maybe",
          ""
        ])
      )
    ).toThrow(/invalid task status/i);
  });

  it("rejects empty inline step names", () => {
    expect(() =>
      parsePlan(
        pipelinePlanYaml([
          "steps:",
          "  \"\":",
          "    prompt: Implement",
          "tasks: []",
          ""
        ])
      )
    ).toThrow(/step names must be non-empty/i);
  });

  it("rejects unknown steps referenced by task status maps", () => {
    expect(() =>
      parsePlan(
        pipelinePlanYaml([
          "tasks:",
          "  - id: task-1",
          "    title: Harden auth",
          "    prompt: Improve auth validation",
          "    status:",
          "      unknown_step: open",
          ""
        ]),
        {
          availableSteps: {
            implement: { mode: "edit", prompt: "Implement" }
          }
        }
      )
    ).toThrow(/unknown step "unknown_step"/i);
  });

  it("rejects empty task status step names", () => {
    expect(() =>
      parsePlan(
        pipelinePlanYaml([
          "tasks:",
          "  - id: task-1",
          "    title: Harden auth",
          "    prompt: Improve auth validation",
          "    status:",
          "      \"\": open",
          ""
        ])
      )
    ).toThrow(/step names must be non-empty/i);
  });

  it("rejects empty task step status maps", () => {
    expect(() =>
      parsePlan(
        pipelinePlanYaml([
          "tasks:",
          "  - id: task-1",
          "    title: Harden auth",
          "    prompt: Improve auth validation",
          "    status: {}",
          ""
        ])
      )
    ).toThrow(/status.*at least one step/i);
  });

  it("rejects inherited step names absent from available steps", () => {
    expect(() =>
      parsePlan(
        pipelinePlanYaml([
          "tasks:",
          "  - id: task-1",
          "    title: Harden auth",
          "    prompt: Improve auth validation",
          "    status:",
          "      constructor: open",
          ""
        ]),
        { availableSteps: {} }
      )
    ).toThrow(/unknown step "constructor"/i);
  });

  it("does not accept inherited top-level plan fields", async () => {
    await withObjectPrototypeProperties(
      {
        extends: "fast",
        tasks: []
      },
      () => {
        expect(() =>
          parsePlan(pipelinePlanYaml(["name: Missing tasks", ""]))
        ).toThrow(/expected "tasks" to be an array/i);

        const plan = parsePlan(pipelinePlanYaml(["tasks: []", ""]));
        expect(plan).toEqual({
          extends: "default",
          tasks: []
        });
      }
    );
  });

  it("does not accept inherited task fields", async () => {
    await withObjectPrototypeProperties(
      {
        id: "polluted",
        title: "Polluted",
        prompt: "Polluted",
        status: "open"
      },
      () => {
        expect(() => parsePlan(pipelinePlanYaml(["tasks:", "  - {}", ""]))).toThrow(
          /tasks\[0\]\.id/
        );
      }
    );
  });

  it("accepts an empty tasks array", () => {
    const plan = parsePlan(pipelinePlanYaml(["tasks: []", ""]));
    expect(plan.tasks).toEqual([]);
  });

  it("parses mcp block with command, args, and env", () => {
    const plan = parsePlan(
      pipelinePlanYaml([
        "mcp:",
        "  my-server:",
        "    command: npx",
        "    args:",
        "      - my-server",
        "    env:",
        "      FOO: bar",
        "tasks: []",
        ""
      ])
    );

    expect(plan.mcp).toEqual({
      "my-server": { command: "npx", args: ["my-server"], env: { FOO: "bar" } }
    });
  });

  it("parses mcp block with command only", () => {
    const plan = parsePlan(
      pipelinePlanYaml(["mcp:", "  minimal:", "    command: my-tool", "tasks: []", ""])
    );

    expect(plan.mcp).toEqual({ minimal: { command: "my-tool" } });
  });

  it("preserves an mcp server named __proto__", () => {
    const plan = parsePlan(
      pipelinePlanYaml(["mcp:", "  __proto__:", "    command: custom-server", "tasks: []", ""])
    );

    expect(Object.hasOwn(plan.mcp ?? {}, "__proto__")).toBe(true);
    expect(plan.mcp?.__proto__).toEqual({ command: "custom-server" });
    expect(Object.getPrototypeOf(plan.mcp ?? {})).toBe(Object.prototype);
  });

  it("omits mcp when not present", () => {
    const plan = parsePlan(pipelinePlanYaml(["tasks: []", ""]));
    expect(plan.mcp).toBeUndefined();
  });

  it("rejects mcp that is not an object", () => {
    expect(() => parsePlan(pipelinePlanYaml(["mcp: not-an-object", "tasks: []", ""]))).toThrow(
      /mcp.*must be an object/i
    );
  });

  it("rejects mcp server entry missing command", () => {
    expect(() =>
      parsePlan(pipelinePlanYaml(["mcp:", "  bad-server:", "    args: [foo]", "tasks: []", ""]))
    ).toThrow(/command.*non-empty string/i);
  });

  it("parses setup and teardown from plan", () => {
    const plan = parsePlan(
      pipelinePlanYaml([
        "setup:",
        "  prompt: Prepare workspace",
        "teardown:",
        "  mode: read",
        "  prompt: Run final checks",
        "tasks:",
        "  - id: task-1",
        "    title: Fix",
        "    prompt: Fix it",
        "    status: open",
        ""
      ])
    );

    expect(plan.setup).toEqual({ prompt: "Prepare workspace" });
    expect(plan.teardown).toEqual({ mode: "read", prompt: "Run final checks" });
  });

  it("accepts auto as an explicit plan phase mode", () => {
    const plan = parsePlan(
      pipelinePlanYaml([
        "setup:",
        "  mode: auto",
        "  prompt: Prepare workspace",
        "tasks: []",
        ""
      ])
    );

    expect(plan.setup).toEqual({ mode: "auto", prompt: "Prepare workspace" });
  });

  it("omits setup and teardown when not present", () => {
    const plan = parsePlan(pipelinePlanYaml(["tasks: []", ""]));
    expect(plan.setup).toBeUndefined();
    expect(plan.teardown).toBeUndefined();
  });

  it("rejects setup missing instruction", () => {
    expect(() => parsePlan(pipelinePlanYaml(["setup:", "  mode: read", "tasks: []", ""]))).toThrow(
      /setup.*missing a prompt/i
    );
  });

  it("maps setup: false to null (disabled)", () => {
    const plan = parsePlan(pipelinePlanYaml(["setup: false", "tasks: []", ""]));

    expect(plan.setup).toBeNull();
  });

  it("maps teardown: false to null (disabled)", () => {
    const plan = parsePlan(pipelinePlanYaml(["teardown: false", "tasks: []", ""]));

    expect(plan.teardown).toBeNull();
  });

  it("parses vars as a string record", () => {
    const plan = parsePlan(
      pipelinePlanYaml([
        "vars:",
        "  plan_doc: docs/plans/my-feature.md",
        "  env: production",
        "tasks: []",
        ""
      ])
    );

    expect(plan.vars).toEqual({
      plan_doc: "docs/plans/my-feature.md",
      env: "production"
    });
  });

  it("preserves and resolves a variable named __proto__", async () => {
    const plan = parsePlan(pipelinePlanYaml(["vars:", "  __proto__: production", "tasks: []", ""]));
    const vars = await resolvePipelineVars(plan.vars ?? {}, "/repo", async () => "");

    expect(Object.hasOwn(plan.vars ?? {}, "__proto__")).toBe(true);
    expect(Object.hasOwn(vars, "__proto__")).toBe(true);
    expect(interpolatePipelineVars("{{__proto__}}", vars)).toBe("production");
  });

  it("omits vars when not defined", () => {
    const plan = parsePlan(pipelinePlanYaml(["tasks: []", ""]));
    expect(plan.vars).toBeUndefined();
  });

  it("throws when vars is not an object", () => {
    expect(() => parsePlan(pipelinePlanYaml(["vars: just-a-string", "tasks: []", ""]))).toThrow(
      /"vars" must be an object/i
    );
  });

  it("throws when a var value is not a string", () => {
    expect(() => parsePlan(pipelinePlanYaml(["vars:", "  bad: 123", "tasks: []", ""]))).toThrow(
      /vars\["bad"\] must be a string/i
    );
  });
});

describe("writeTaskStatus", () => {
  it("rejects a symlinked plan file", async () => {
    const volume = Volume.fromJSON({
      "/outside/plan.md": [
        "---",
        "tasks:",
        "  - id: first",
        "    title: First",
        "    prompt: Do first",
        "    status: open",
        "---",
        ""
      ].join("\n")
    });
    volume.mkdirSync("/repo/docs/plans", { recursive: true });
    volume.symlinkSync("/outside/plan.md", "/repo/docs/plans/linked.md");
    const fs = createFsFromVolume(volume).promises;

    await expect(
      writeTaskStatus({
        fs,
        planPath: "/repo/docs/plans/linked.md",
        taskId: "first",
        status: "done"
      })
    ).rejects.toThrow(/symbolic link/i);
    await expect(fs.readFile("/outside/plan.md", "utf8")).resolves.toContain("status: open");
  });

  it("preserves the prior plan when a staged status write fails", async () => {
    const initial = [
      "tasks:",
      "  - id: task-1",
      "    title: One",
      "    prompt: First",
      "    status: open",
      ""
    ].join("\n");
    const fs = createFs({ "/repo/plan.yaml": initial });
    let temporaryPath: string | undefined;
    const writeFile = vi.fn(fs.writeFile.bind(fs)).mockImplementation(async (filePath, data, options) => {
      if (filePath.startsWith("/repo/plan.yaml.") && filePath.endsWith(".tmp")) {
        temporaryPath = String(filePath);
        await fs.writeFile(filePath, "partial\n", options);
        throw new Error("status write failed");
      }
      return fs.writeFile(filePath, data, options);
    });

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(
        writeTaskStatus({
          fs: { ...fs, writeFile },
          planPath: "/repo/plan.yaml",
          taskId: "task-1",
          status: "done"
        })
      ).rejects.toThrow("status write failed");
    });

    await expect(fs.readFile("/repo/plan.yaml", "utf8")).resolves.toBe(initial);
    expect(temporaryPath).toBeDefined();
    await expect(fs.readFile(temporaryPath as string, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not follow a preexisting legacy temp path symlink", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_234);
    const initial = [
      "tasks:",
      "  - id: task-1",
      "    title: One",
      "    prompt: First",
      "    status: open",
      ""
    ].join("\n");
    const volume = Volume.fromJSON(
      {
        "/repo/plan.yaml": initial,
        "/outside/target.yaml": "outside stays unchanged\n"
      },
      "/"
    );
    const legacyTempPath = `/repo/plan.yaml.${process.pid}.1234.tmp`;
    volume.symlinkSync("/outside/target.yaml", legacyTempPath);
    const fs = createFsFromVolume(volume).promises;

    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      status: "done"
    });

    await expect(fs.readFile("/outside/target.yaml", "utf8")).resolves.toBe(
      "outside stays unchanged\n"
    );
    const planStat = await fs.lstat("/repo/plan.yaml");
    expect(planStat.isSymbolicLink()).toBe(false);
    await expect(fs.readFile("/repo/plan.yaml", "utf8")).resolves.toContain("status: done");
  });

  it("does not remove a colliding status temp symlink", async () => {
    const initial = [
      "tasks:",
      "  - id: task-1",
      "    title: One",
      "    prompt: First",
      "    status: open",
      ""
    ].join("\n");
    const volume = Volume.fromJSON(
      {
        "/repo/plan.yaml": initial,
        "/outside/target.yaml": "outside stays unchanged\n"
      },
      "/"
    );
    const baseFs = createFsFromVolume(volume).promises;
    let temporaryPath: string | undefined;
    const fs = {
      ...baseFs,
      async writeFile(
        filePath: string,
        data: Parameters<typeof baseFs.writeFile>[1],
        options?: Parameters<typeof baseFs.writeFile>[2]
      ) {
        if (
          temporaryPath === undefined &&
          filePath.startsWith(`/repo/plan.yaml.${process.pid}.`) &&
          filePath.endsWith(".tmp")
        ) {
          temporaryPath = filePath;
          volume.symlinkSync("/outside/target.yaml", filePath);
          expect(options).toEqual({ encoding: "utf8", flag: "wx" });
        }

        await baseFs.writeFile(filePath, data, options);
      }
    };

    await expect(
      writeTaskStatus({
        fs,
        planPath: "/repo/plan.yaml",
        taskId: "task-1",
        status: "done"
      })
    ).rejects.toThrow();

    expect(temporaryPath).toBeDefined();
    await expect(baseFs.readFile("/outside/target.yaml", "utf8")).resolves.toBe(
      "outside stays unchanged\n"
    );
    expect((await baseFs.lstat(temporaryPath as string)).isSymbolicLink()).toBe(true);
    await expect(baseFs.readFile("/repo/plan.yaml", "utf8")).resolves.toBe(initial);
  });

  it("updates a stepless task status to done", async () => {
    const fs = createFs({
      "/repo/plan.yaml": [
        "tasks:",
        "  - id: task-1",
        "    title: One",
        "    prompt: First",
        "    status: open",
        ""
      ].join("\n")
    });

    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      status: "done"
    });

    await expect(readPlanFile(fs, "/repo/plan.yaml")).resolves.toContain(
      [
        `$schema: ${pipelineDocumentSchemaId}`,
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: task-1",
        "    title: One",
        "    prompt: First",
        "    status: done"
      ].join("\n")
    );
  });

  it("updates only a single step status", async () => {
    const fs = createFs({
      "/repo/plan.yaml": [
        "tasks:",
        "  - id: task-1",
        "    title: One",
        "    prompt: First",
        "    status:",
        "      implement: done",
        "      test: open",
        "      commit: open",
        ""
      ].join("\n")
    });

    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      stepName: "test",
      status: "failed"
    });

    const contents = await readPlanFile(fs, "/repo/plan.yaml");
    expect(contents).toContain("implement: done");
    expect(contents).toContain("test: failed");
    expect(contents).toContain("commit: open");
  });

  it("preserves prior changes across multiple writes", async () => {
    const fs = createFs({
      "/repo/plan.yaml": [
        "tasks:",
        "  - id: task-1",
        "    title: One",
        "    prompt: First",
        "    status:",
        "      implement: open",
        "      test: open",
        ""
      ].join("\n")
    });

    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      stepName: "implement",
      status: "done"
    });
    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      stepName: "test",
      status: "done"
    });

    const contents = await readPlanFile(fs, "/repo/plan.yaml");
    expect(contents).toContain("implement: done");
    expect(contents).toContain("test: done");
  });

  it("updates markdown frontmatter and preserves the body verbatim", async () => {
    const body = [
      "# Context",
      "",
      "Keep this body exactly as written.",
      "",
      "---",
      "",
      "Even this thematic break stays in the markdown body.",
      ""
    ].join("\n");
    const fs = createFs({
      "/repo/plan.md": [
        "---",
        "planPath: docs/plans/legacy.md",
        "vars:",
        "  plan_doc: docs/plans/my-feature.md",
        "tasks:",
        "  - id: task-1",
        "    title: One",
        "    prompt: First",
        "    status: open",
        "---",
        body
      ].join("\n")
    });

    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.md",
      taskId: "task-1",
      status: "done"
    });

    const contents = await readPlanFile(fs, "/repo/plan.md");
    expect(contents).toContain(
      `---\n$schema: ${pipelineDocumentSchemaId}\nkind: pipeline\nversion: 1\n`
    );
    expect(contents).not.toContain("planPath:");
    expect(contents).toContain("status: done");
    expect(contents.endsWith(body)).toBe(true);
  });

  it("deletes legacy camelCase aliases when rewriting yaml plans", async () => {
    const fs = createFs({
      "/repo/plan.yaml": [
        "planPath: docs/plans/legacy.md",
        "maxExperiments: 4",
        "metricTimeout: 30",
        "tasks:",
        "  - id: task-1",
        "    title: One",
        "    prompt: First",
        "    status: open",
        ""
      ].join("\n")
    });

    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      status: "done"
    });

    const contents = await readPlanFile(fs, "/repo/plan.yaml");
    expect(contents).toContain(
      `$schema: ${pipelineDocumentSchemaId}\nkind: pipeline\nversion: 1\n`
    );
    expect(contents).not.toContain("planPath:");
    expect(contents).not.toContain("maxExperiments:");
    expect(contents).not.toContain("metricTimeout:");
    expect(contents).toContain("status: done");
  });
});

function getSelection(plan: PipelinePlan): ExecutionSelection {
  return selectNextExecution(plan);
}

describe("selectNextExecution", () => {
  it("selects the first open stepless task", () => {
    const selection = getSelection({
      tasks: [{ id: "one", title: "One", prompt: "One", status: "open" }]
    });

    expect(selection).toMatchObject({
      kind: "run",
      task: { id: "one" }
    });
  });

  it("skips completed tasks and selects the next open one", () => {
    const selection = getSelection({
      tasks: [
        { id: "one", title: "One", prompt: "One", status: "done" },
        { id: "two", title: "Two", prompt: "Two", status: "open" }
      ]
    });

    expect(selection).toMatchObject({
      kind: "run",
      task: { id: "two" }
    });
  });

  it("reruns a failed stepless task before later open tasks", () => {
    const selection = getSelection({
      tasks: [
        { id: "one", title: "One", prompt: "One", status: "failed" },
        { id: "two", title: "Two", prompt: "Two", status: "open" }
      ]
    });

    expect(selection).toEqual({
      kind: "run",
      task: { id: "one", title: "One", prompt: "One", status: "failed" }
    });
  });

  it("picks the first open step in a stepped task", () => {
    const selection = getSelection({
      tasks: [
        {
          id: "one",
          title: "One",
          prompt: "One",
          status: {
            implement: "done",
            test: "open",
            commit: "open"
          }
        }
      ]
    });

    expect(selection).toMatchObject({
      kind: "run",
      task: { id: "one" },
      stepName: "test"
    });
  });

  it("reruns the first failed step before later open steps", () => {
    const selection = getSelection({
      tasks: [
        {
          id: "one",
          title: "One",
          prompt: "One",
          status: {
            implement: "done",
            test: "failed",
            commit: "open"
          }
        }
      ]
    });

    expect(selection).toMatchObject({
      kind: "run",
      task: { id: "one" },
      stepName: "test"
    });
  });

  it("returns completed when all work is done", () => {
    const selection = getSelection({
      tasks: [
        { id: "one", title: "One", prompt: "One", status: "done" },
        {
          id: "two",
          title: "Two",
          prompt: "Two",
          status: {
            implement: "done"
          }
        }
      ]
    });

    expect(selection).toEqual({ kind: "completed" });
  });

  it("selects an empty step key as runnable instead of treating the task as complete", () => {
    const selection = getSelection({
      tasks: [
        {
          id: "one",
          title: "One",
          prompt: "One",
          status: {
            "": "open"
          }
        }
      ]
    });

    expect(selection).toEqual({
      kind: "run",
      task: {
        id: "one",
        title: "One",
        prompt: "One",
        status: {
          "": "open"
        }
      },
      stepName: ""
    });
  });
});

describe("buildExecutionPrompt", () => {
  const steps: ResolvedStepDefinitions = {
    implement: {
      mode: "edit",
      prompt: "{{id}} {{title}}\n{{prompt}}\nPlan: {{plan_path}}"
    }
  };

  it("interpolates step placeholders", () => {
    const prompt = buildExecutionPrompt({
      selection: {
        kind: "run",
        task: {
          id: "auth-hardening",
          title: "Harden auth flow",
          prompt: "Improve auth validation",
          status: {
            implement: "open"
          }
        },
        stepName: "implement"
      },
      steps,
      planPath: ".poe-code/pipeline/plans/plan-auth.yaml"
    });

    expect(prompt).toBe(
      "auth-hardening Harden auth flow\nImprove auth validation\nPlan: .poe-code/pipeline/plans/plan-auth.yaml"
    );
  });

  it("uses the task prompt directly for stepless tasks", () => {
    const prompt = buildExecutionPrompt({
      selection: {
        kind: "run",
        task: {
          id: "quick-fix",
          title: "Quick fix",
          prompt: "Fix the timeout regression",
          status: "open"
        }
      },
      steps,
      planPath: "ignored.yaml"
    });

    expect(prompt).toBe("Fix the timeout regression");
  });

  it("interpolates vars into stepless task prompt", () => {
    const prompt = buildExecutionPrompt({
      selection: {
        kind: "run",
        task: {
          id: "task-1",
          title: "Task",
          prompt: "Context:\n{{plan_doc}}\nDo the work.",
          status: "open"
        }
      },
      steps,
      planPath: "ignored.yaml",
      vars: { plan_doc: "# Feature Plan\nSome content." }
    });

    expect(prompt).toBe("Context:\n# Feature Plan\nSome content.\nDo the work.");
  });

  it("interpolates vars into step prompt, built-ins take precedence", () => {
    const prompt = buildExecutionPrompt({
      selection: {
        kind: "run",
        task: {
          id: "auth-hardening",
          title: "Harden auth flow",
          prompt: "Improve auth validation",
          status: { implement: "open" }
        },
        stepName: "implement"
      },
      steps: {
        implement: {
          mode: "edit",
          prompt: "{{plan_doc}}\n{{id}}: {{title}}\n{{prompt}}"
        }
      },
      planPath: "plan.yaml",
      vars: { plan_doc: "# Context", id: "should-be-ignored" }
    });

    expect(prompt).toBe("# Context\nauth-hardening: Harden auth flow\nImprove auth validation");
  });

  it("interpolates vars inside {{prompt}} before injecting it into a step prompt", () => {
    const prompt = buildExecutionPrompt({
      selection: {
        kind: "run",
        task: {
          id: "deploy",
          title: "Deploy",
          prompt: "Deploy to {{env}}.",
          status: { implement: "open" }
        },
        stepName: "implement"
      },
      steps: {
        implement: {
          mode: "edit",
          prompt: "Instructions:\n{{prompt}}"
        }
      },
      planPath: "plan.yaml",
      vars: { env: "production" }
    });

    expect(prompt).toBe("Instructions:\nDeploy to production.");
  });

  it("throws when {{prompt}} includes a missing var", () => {
    expect(() =>
      buildExecutionPrompt({
        selection: {
          kind: "run",
          task: {
            id: "deploy",
            title: "Deploy",
            prompt: "Deploy to {{env}}.",
            status: { implement: "open" }
          },
          stepName: "implement"
        },
        steps: {
          implement: {
            mode: "edit",
            prompt: "Instructions:\n{{prompt}}"
          }
        },
        planPath: "plan.yaml"
      })
    ).toThrow('Missing pipeline variable "env" in task "deploy" step "implement".');
  });

  it("throws when a step prompt references a missing var", () => {
    expect(() =>
      buildExecutionPrompt({
        selection: {
          kind: "run",
          task: {
            id: "auth-hardening",
            title: "Harden auth flow",
            prompt: "Improve auth validation",
            status: { implement: "open" }
          },
          stepName: "implement"
        },
        steps: {
          implement: {
            mode: "edit",
            prompt: "Deploy to {{env}}."
          }
        },
        planPath: "plan.yaml"
      })
    ).toThrow('Missing pipeline variable "env" in task "auth-hardening" step "implement".');
  });
});

describe("interpolatePipelineVars", () => {
  it("replaces all occurrences of a placeholder", () => {
    expect(interpolatePipelineVars("{{x}} and {{x}}", { x: "hello" })).toBe("hello and hello");
  });

  it("throws when a placeholder value is missing", () => {
    expect(() =>
      interpolatePipelineVars("{{known}} {{unknown}}", { known: "yes" }, 'task "deploy"')
    ).toThrow('Missing pipeline variable "unknown" in task "deploy".');
  });

  it("treats backslash-escaped placeholders as literal text", () => {
    expect(interpolatePipelineVars("syntax is \\{{ var }}", {})).toBe("syntax is {{ var }}");
  });

  it("mixes escaped placeholders with real ones", () => {
    expect(interpolatePipelineVars("real={{x}}, literal=\\{{ x }}", { x: "yes" })).toBe(
      "real=yes, literal={{ x }}"
    );
  });

  it("does not require values for escaped placeholders", () => {
    expect(() =>
      interpolatePipelineVars("docs say \\{{ var }}", {}, 'task "prompt-render"')
    ).not.toThrow();
  });
});

describe("resolveFileIncludes", () => {
  const readFile = async (filePath: string): Promise<string> => {
    const files: Record<string, string> = {
      "/repo/docs/context.md": "# Context\nSome context here.",
      "/repo/notes.txt": "Important notes."
    };
    const content = files[filePath];
    if (content === undefined) throw new Error(`File not found: ${filePath}`);
    return content;
  };

  it("returns the template unchanged when there are no file includes", async () => {
    const result = await resolveFileIncludes("plain prompt text", "/repo", readFile);
    expect(result).toBe("plain prompt text");
  });

  it("replaces a single file include with file contents", async () => {
    const result = await resolveFileIncludes(
      "Preamble\n{{file 'docs/context.md'}}\nPostamble",
      "/repo",
      readFile
    );
    expect(result).toBe("Preamble\n# Context\nSome context here.\nPostamble");
  });

  it("supports double-quoted paths", async () => {
    const result = await resolveFileIncludes('{{file "notes.txt"}}', "/repo", readFile);
    expect(result).toBe("Important notes.");
  });

  it("resolves paths relative to cwd", async () => {
    const result = await resolveFileIncludes("{{file 'docs/context.md'}}", "/repo", readFile);
    expect(result).toBe("# Context\nSome context here.");
  });

  it("rejects includes that escape the project root", async () => {
    await expect(resolveFileIncludes("{{file '../secret.txt'}}", "/repo", readFile)).rejects.toThrow(
      /outside the project root/i
    );
  });

  it("throws when the referenced file does not exist", async () => {
    await expect(resolveFileIncludes("{{file 'missing.md'}}", "/repo", readFile)).rejects.toThrow(
      "File not found: /repo/missing.md"
    );
  });
});

describe("resolvePipelineVars", () => {
  it("resolves doc vars from paths inside the project root", async () => {
    const readFile = vi.fn(async (filePath: string): Promise<string> => {
      if (filePath === "/repo/docs/context.md") {
        return "Context from file.";
      }
      throw new Error(`File not found: ${filePath}`);
    });

    const result = await resolvePipelineVars({ plan_doc: "docs/context.md" }, "/repo", readFile);

    expect(result).toEqual({ plan_doc: "Context from file." });
    expect(readFile).toHaveBeenCalledWith("/repo/docs/context.md", "utf8");
  });

  it.each(["../secret.md", "/outside/secret.md"])(
    "rejects doc var paths outside the project root: %s",
    async (value) => {
      const readFile = vi.fn(async () => "");

      await expect(resolvePipelineVars({ plan_doc: value }, "/repo", readFile)).rejects.toThrow(
        /outside the project root/i
      );
      expect(readFile).not.toHaveBeenCalled();
    }
  );
});

describe("createPipelineSimulation", () => {
  it("rejects an empty stepped task before reporting completion", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: implement",
        "    title: Implement feature",
        "    prompt: Ship it",
        "    status: {}",
        "---",
        ""
      ].join("\n")
    });
    const onPlanResolved = vi.fn();
    const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await expect(
      runPipeline({
        agent: "codex",
        cwd: "/repo",
        homeDir: "/home/test",
        plan: "docs/plans/plan.md",
        fs,
        onPlanResolved,
        runAgent
      })
    ).rejects.toThrow(/status.*at least one step/i);

    expect(onPlanResolved).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("completes a stepless task in one run", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix the timeout regression",
            status: "open"
          }
        ]
      },
      turns: [successTurn()]
    });

    const { result, readPlan, prompts, runs } = await sim.run();
    const plan = await readPlan();

    expect(result.stopReason).toBe("completed");
    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });
    expect(prompts).toEqual(["Fix the timeout regression"]);
    expect(runs[0]).not.toHaveProperty("mode");
    expect(plan.tasks[0]?.status).toBe("done");
  });

  it("accumulates usage metrics for a single task run", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix the timeout regression",
            status: "open"
          }
        ]
      },
      turns: [
        {
          output: {
            stdout: "",
            exitCode: 0,
            usage: {
              inputTokens: 120,
              outputTokens: 45,
              cachedTokens: 30
            }
          }
        }
      ]
    });

    const { result } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 120,
      totalOutputTokens: 45,
      totalCachedTokens: 30,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });
  });

  it("treats missing exitCode as success while preserving usage totals", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix the timeout regression",
            status: "open"
          }
        ]
      },
      turns: [
        {
          output: {
            stdout: "",
            usage: {
              inputTokens: 3,
              outputTokens: 2,
              cachedTokens: 0
            }
          }
        }
      ]
    });

    const { result } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(result.metrics).toEqual({
      totalInputTokens: 3,
      totalOutputTokens: 2,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });
  });

  it("forwards usage to onTaskComplete when available", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix the timeout regression",
            status: "open"
          }
        ]
      },
      turns: [
        {
          output: {
            stdout: "",
            exitCode: 0,
            usage: {
              inputTokens: 9,
              outputTokens: 4
            }
          }
        }
      ]
    });

    const { result, taskCompletions } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 9,
      totalOutputTokens: 4,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });

    expect(taskCompletions).toHaveLength(1);
    expect(taskCompletions[0]?.usage).toEqual({
      inputTokens: 9,
      outputTokens: 4
    });
  });

  it("does not include usage in onTaskComplete when unavailable", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix the timeout regression",
            status: "open"
          }
        ]
      },
      turns: [successTurn()]
    });

    const { result, taskCompletions } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });

    expect(taskCompletions).toHaveLength(1);
    expect(taskCompletions[0]?.usage).toBeUndefined();
  });

  it("passes configured logDir to each agent run", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix the timeout regression",
            status: "open"
          },
          {
            id: "slow-fix",
            title: "Slow fix",
            prompt: "Fix another regression",
            status: "open"
          }
        ]
      },
      config: {
        logDir: "/repo/.poe-code/pipeline/plans/logs/quick-fix-yolo.jsonl"
      },
      turns: [successTurn(), successTurn()]
    });

    const { result, runs } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 2,
      tasksFailed: 0,
      stepsCompleted: 2
    });

    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.logDir)).toEqual([
      "/repo/.poe-code/pipeline/plans/logs/quick-fix-yolo.jsonl",
      "/repo/.poe-code/pipeline/plans/logs/quick-fix-yolo.jsonl"
    ]);
  });

  it("forwards an explicitly empty logDir value", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix the timeout regression",
            status: "open"
          }
        ]
      },
      config: {
        logDir: ""
      },
      turns: [successTurn()]
    });

    const { result, runs } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.logDir).toBe("");
  });

  it("defaults logDir to ~/.poe-code/logs/pipeline/<plan-slug> when not configured", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix the timeout regression",
            status: "open"
          }
        ]
      },
      turns: [successTurn()]
    });

    const { result, runs } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.logDir).toBe(
      resolveRunLogDir({
        planPath: "/repo/docs/plans/plan.md",
        runner: "pipeline",
        homeDir: "/home/test"
      })
    );
    expect(runs[0]?.logFileName).toMatch(/^\d{8}-\d{6}-\d{3}-quick-fix\.jsonl$/);
  });

  it("rejects a symlinked default log root before running an agent", async () => {
    const rawFs = createFs({
      ["/repo/docs/plans/plan.md"]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: quick-fix",
        "    title: Quick fix",
        "    prompt: Fix the timeout regression",
        "    status: open",
        "---",
        ""
      ].join("\n")
    });
    await rawFs.mkdir("/home/test/.poe-code", { recursive: true });
    await rawFs.mkdir("/outside", { recursive: true });
    await rawFs.symlink("/outside", "/home/test/.poe-code/logs");
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    await expect(
      runPipeline({
        agent: "codex",
        cwd: "/repo",
        homeDir: "/home/test",
        plan: "docs/plans/plan.md",
        fs: createPipelineTestFs(rawFs),
        runAgent
      })
    ).rejects.toThrow("Runner log directory resolves outside the poe-code state directory");

    expect(runAgent).not.toHaveBeenCalled();
    await expect(rawFs.readdir("/outside")).resolves.toEqual([]);
  });

  it("runs stepped tasks in order and marks each step done", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          mode: "yolo",
          prompt: "Implement {{id}}"
        },
        test: {
          mode: "read",
          prompt: "Test {{id}}"
        },
        commit: {
          mode: "yolo",
          prompt: "Commit {{id}}"
        }
      },
      plan: {
        tasks: [
          {
            id: "auth-hardening",
            title: "Harden auth",
            prompt: "Improve auth validation",
            status: {
              implement: "open",
              test: "open",
              commit: "open"
            }
          }
        ]
      },
      turns: [successTurn(), successTurn(), successTurn()]
    });

    const { result, readPlan, prompts, runs, taskCompletions } = await sim.run();
    const task = (await readPlan()).tasks[0];

    expect(result.stopReason).toBe("completed");
    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 3
    });
    expect(taskCompletions.map((completion) => completion.taskCompleted)).toEqual([
      false,
      false,
      true
    ]);
    expect(prompts).toEqual([
      "Implement auth-hardening",
      "Test auth-hardening",
      "Commit auth-hardening"
    ]);
    expect(runs.map((run) => run.mode)).toEqual(["yolo", "read", "yolo"]);
    expect(task?.status).toEqual({
      implement: "done",
      test: "done",
      commit: "done"
    });
  });

  it("counts each multi-step task once even when shared with another task", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: { mode: "yolo", prompt: "Implement {{id}}" },
        test: { mode: "read", prompt: "Test {{id}}" },
        commit: { mode: "yolo", prompt: "Commit {{id}}" }
      },
      plan: {
        tasks: [
          {
            id: "task-a",
            title: "Task A",
            prompt: "Do A",
            status: { implement: "open", test: "open", commit: "open" }
          },
          {
            id: "task-b",
            title: "Task B",
            prompt: "Do B",
            status: { implement: "open", test: "open", commit: "open" }
          }
        ]
      },
      turns: [
        successTurn(),
        successTurn(),
        successTurn(),
        successTurn(),
        successTurn(),
        successTurn()
      ]
    });

    const { result, taskCompletions } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(result.metrics).toMatchObject({
      tasksCompleted: 2,
      tasksFailed: 0,
      stepsCompleted: 6
    });
    expect(taskCompletions.map((c) => c.taskCompleted)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true
    ]);
  });

  it("does not count an in-progress multi-step task as completed when maxRuns stops before the final step", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: { mode: "yolo", prompt: "Implement {{id}}" },
        test: { mode: "read", prompt: "Test {{id}}" },
        commit: { mode: "yolo", prompt: "Commit {{id}}" }
      },
      plan: {
        tasks: [
          {
            id: "task-a",
            title: "Task A",
            prompt: "Do A",
            status: { implement: "open", test: "open", commit: "open" }
          }
        ]
      },
      config: {
        maxRuns: 2
      },
      turns: [successTurn(), successTurn()]
    });

    const { result, readPlan, taskCompletions } = await sim.run();

    expect(result.stopReason).toBe("max_runs");
    expect(result.metrics).toMatchObject({
      tasksCompleted: 0,
      tasksFailed: 0,
      stepsCompleted: 2
    });
    expect(taskCompletions.map((completion) => completion.taskCompleted)).toEqual([false, false]);
    expect((await readPlan()).tasks[0]?.status).toEqual({
      implement: "done",
      test: "done",
      commit: "open"
    });
  });

  it("aggregates usage across multi-step runs with missing usage entries", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          mode: "yolo",
          prompt: "Implement {{id}}"
        },
        test: {
          mode: "read",
          prompt: "Test {{id}}"
        },
        commit: {
          mode: "yolo",
          prompt: "Commit {{id}}"
        }
      },
      plan: {
        tasks: [
          {
            id: "auth-hardening",
            title: "Harden auth",
            prompt: "Improve auth validation",
            status: {
              implement: "open",
              test: "open",
              commit: "open"
            }
          }
        ]
      },
      turns: [
        {
          output: {
            stdout: "",
            exitCode: 0,
            usage: {
              inputTokens: 50,
              outputTokens: 20,
              cachedTokens: 7
            }
          }
        },
        {
          output: {
            stdout: "",
            exitCode: 0
          }
        },
        {
          output: {
            stdout: "",
            exitCode: 0,
            usage: {
              inputTokens: 15,
              outputTokens: 5
            }
          }
        }
      ]
    });

    const { result } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 65,
      totalOutputTokens: 25,
      totalCachedTokens: 7,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 3
    });
  });

  it("marks the current step failed and stops on non-zero exit", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          mode: "edit",
          prompt: "Implement {{id}}"
        },
        test: {
          mode: "read",
          prompt: "Test {{id}}"
        },
        commit: {
          mode: "edit",
          prompt: "Commit {{id}}"
        }
      },
      plan: {
        tasks: [
          {
            id: "auth-hardening",
            title: "Harden auth",
            prompt: "Improve auth validation",
            status: {
              implement: "open",
              test: "open",
              commit: "open"
            }
          }
        ]
      },
      turns: [successTurn(), failTurn("tests failed")]
    });

    const { result, readPlan, prompts, runs } = await sim.run();
    const task = (await readPlan()).tasks[0];

    expect(result.stopReason).toBe("failed");
    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 0,
      tasksFailed: 1,
      stepsCompleted: 2
    });
    expect(result.lastStepName).toBe("test");
    expect(runs).toHaveLength(2);
    expect(prompts).toEqual(["Implement auth-hardening", "Test auth-hardening"]);
    expect(task?.status).toEqual({
      implement: "done",
      test: "failed",
      commit: "open"
    });
  });

  it("counts usage and failed metrics for non-zero exits", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix the timeout regression",
            status: "open"
          }
        ]
      },
      turns: [
        {
          output: {
            stdout: "",
            stderr: "failed",
            exitCode: 1,
            usage: {
              inputTokens: 11,
              outputTokens: 6,
              cachedTokens: 2
            }
          }
        }
      ]
    });

    const { result, taskCompletions, readPlan } = await sim.run();

    expect(result.stopReason).toBe("failed");
    expect(result.metrics).toEqual({
      totalInputTokens: 11,
      totalOutputTokens: 6,
      totalCachedTokens: 2,
      tasksCompleted: 0,
      tasksFailed: 1,
      stepsCompleted: 1
    });
    expect(taskCompletions).toHaveLength(1);
    expect(taskCompletions[0]?.success).toBe(false);
    expect(taskCompletions[0]?.usage).toEqual({
      inputTokens: 11,
      outputTokens: 6,
      cachedTokens: 2
    });
    expect((await readPlan()).tasks[0]?.status).toBe("failed");
  });

  it("reruns a failed stepless task on the next pipeline run", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix the timeout regression",
            status: "failed"
          }
        ]
      },
      turns: [successTurn()]
    });

    const { result, readPlan, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Fix the timeout regression"]);
    expect((await readPlan()).tasks[0]?.status).toBe("done");
  });

  it("reruns a failed step on the next pipeline run", async () => {
    const sim = createPipelineSimulation({
      globalSteps: {
        implement: { mode: "edit", prompt: "Implement {{id}}" },
        test: { mode: "edit", prompt: "Test {{id}}" },
        commit: { mode: "edit", prompt: "Commit {{id}}" }
      },
      plan: {
        tasks: [
          {
            id: "auth",
            title: "Auth",
            prompt: "Auth work",
            status: {
              implement: "done",
              test: "failed",
              commit: "open"
            }
          }
        ]
      },
      turns: [successTurn(), successTurn()]
    });

    const { result, readPlan, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Test auth", "Commit auth"]);
    expect((await readPlan()).tasks[0]?.status).toEqual({
      implement: "done",
      test: "done",
      commit: "done"
    });
  });

  it("does not retry a failed task again within the same run", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix it",
            status: "failed"
          }
        ]
      },
      turns: [failTurn("still failing"), successTurn()]
    });

    const { result, prompts, readPlan } = await sim.run();

    expect(result.stopReason).toBe("failed");
    expect(prompts).toEqual(["Fix it"]);
    expect((await readPlan()).tasks[0]?.status).toBe("failed");
  });

  it("archives a flat plan file after all tasks complete without renaming remaining active files", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": [
        "---",
        `$schema: ${pipelineDocumentSchemaId}`,
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: quick-fix",
        "    title: Quick fix",
        "    prompt: Fix it",
        "    status: open",
        "---",
        ""
      ].join("\n"),
      "/repo/docs/plans/next.md": PIPELINE_MD_EMPTY
    });

    const result = await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/plan.md",
      planDirectory: "docs/plans",
      fs,
      runAgent: async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    });

    expect(result.stopReason).toBe("completed");

    const archiveEntries = await fs.readdir("/repo/docs/plans/archive");
    expect(archiveEntries).toEqual(["plan.md"]);

    const originalEntries = await fs.readdir("/repo/docs/plans");
    expect(originalEntries.sort()).toEqual(["archive", "next.md"]);
  });

  it("leaves the completed plan active when archive is disabled", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": [
        "---",
        `$schema: ${pipelineDocumentSchemaId}`,
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: quick-fix",
        "    title: Quick fix",
        "    prompt: Fix it",
        "    status: open",
        "---",
        ""
      ].join("\n")
    });

    const result = await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/plan.md",
      planDirectory: "docs/plans",
      archive: false,
      fs,
      runAgent: async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    });

    expect(result.stopReason).toBe("completed");
    await expect(fs.stat("/repo/docs/plans/plan.md")).resolves.toMatchObject({});
    await expect(fs.stat("/repo/docs/plans/archive/plan.md")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("archives a prefixed plan file by id without renumbering remaining active files", async () => {
    const fs = createFs({
      "/repo/docs/plans/01-plan.md": [
        "---",
        `$schema: ${pipelineDocumentSchemaId}`,
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: quick-fix",
        "    title: Quick fix",
        "    prompt: Fix it",
        "    status: open",
        "---",
        ""
      ].join("\n"),
      "/repo/docs/plans/02-next.md": PIPELINE_MD_EMPTY,
      "/repo/docs/plans/03-later.md": PIPELINE_MD_EMPTY
    });

    const result = await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/01-plan.md",
      planDirectory: "docs/plans",
      fs,
      runAgent: async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    });

    expect(result.stopReason).toBe("completed");

    const archiveEntries = await fs.readdir("/repo/docs/plans/archive");
    expect(archiveEntries.sort()).toEqual(["plan.md"]);

    const originalEntries = await fs.readdir("/repo/docs/plans");
    expect(originalEntries.sort()).toEqual(["02-next.md", "03-later.md", "archive"]);
  });

  it("does not archive when plan was already complete (nothing_to_run)", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "done-task",
            title: "Already done",
            prompt: "Nothing to do",
            status: "done"
          }
        ]
      },
      turns: []
    });

    const { result, fs } = await sim.run();

    expect(result.stopReason).toBe("nothing_to_run");

    const entries = await fs.readdir("/repo/docs/plans");
    expect(entries).toContain("plan.md");
  });

  it("does not run setup when every task is already complete", async () => {
    const sim = createPipelineSimulation({
      plan: {
        setup: { mode: "yolo", prompt: "Prepare workspace" },
        tasks: [{ id: "done", title: "Done", prompt: "Nothing", status: "done" }]
      },
      turns: []
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("nothing_to_run");
    expect(prompts).toEqual([]);
    expect(result.metrics.stepsCompleted).toBe(0);
  });

  it("uses per-step agent and model overrides", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          mode: "yolo",
          prompt: "Implement {{id}}",
          agent: "codex",
          model: "o3"
        },
        review: {
          mode: "read",
          prompt: "Review {{id}}",
          agent: "claude-code"
        }
      },
      plan: {
        tasks: [
          {
            id: "feat",
            title: "Feature",
            prompt: "Add feature",
            status: {
              implement: "open",
              review: "open"
            }
          }
        ]
      },
      turns: [successTurn(), successTurn()]
    });

    const { runs } = await sim.run();

    expect(runs[0]?.agent).toBe("codex");
    expect(runs[0]?.model).toBe("o3");
    expect(runs[1]?.agent).toBe("claude-code");
    expect(runs[1]?.model).toBeUndefined();
  });

  it("passes per-step skills to the agent runner", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          mode: "yolo",
          prompt: "Implement {{id}}",
          skills: ["foo", "claude/bar"]
        }
      },
      plan: {
        tasks: [
          {
            id: "feat",
            title: "Feature",
            prompt: "Add feature",
            status: {
              implement: "open"
            }
          }
        ]
      },
      turns: [successTurn()]
    });

    const { runs } = await sim.run();

    expect(runs[0]?.skills).toEqual(["foo", "claude/bar"]);
  });

  it("omits skills from agent runner input when a step has no skills field", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          mode: "yolo",
          prompt: "Implement {{id}}"
        }
      },
      plan: {
        tasks: [
          {
            id: "feat",
            title: "Feature",
            prompt: "Add feature",
            status: {
              implement: "open"
            }
          }
        ]
      },
      turns: [successTurn()]
    });

    const { runs } = await sim.run();

    expect(Object.hasOwn(runs[0]!, "skills")).toBe(false);
  });

  it("passes per-step hooks to the agent runner", async () => {
    const fs = createFs({
      "/repo/.poe-code/pipeline/steps/default.yaml": [
        "steps:",
        "  implement:",
        "    prompt: Implement {{id}}",
        "    hooks:",
        "      from: claude",
        "      strategy: transform",
        "      scope: merged",
        ""
      ].join("\n"),
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: feat",
        "    title: Feature",
        "    prompt: Add feature",
        "    status:",
        "      implement: open",
        "---",
        ""
      ].join("\n")
    });
    const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/plan.md",
      fs,
      runAgent
    });

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        hooks: { from: "claude", strategy: "transform", scope: "merged" }
      })
    );
  });

  it("omits hooks from agent runner input when a step has no hooks field", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          mode: "yolo",
          prompt: "Implement {{id}}"
        }
      },
      plan: {
        tasks: [
          {
            id: "feat",
            title: "Feature",
            prompt: "Add feature",
            status: { implement: "open" }
          }
        ]
      },
      turns: [successTurn()]
    });

    const { runs } = await sim.run();

    expect(Object.hasOwn(runs[0]!, "hooks")).toBe(false);
  });

  it("passes setup and teardown skills to the agent runner", async () => {
    const sim = createPipelineSimulation({
      projectStepsSetup: {
        mode: "yolo",
        prompt: "Setup",
        skills: ["foo"]
      },
      projectSteps: {
        implement: {
          mode: "yolo",
          prompt: "Implement"
        }
      },
      projectStepsTeardown: {
        mode: "yolo",
        prompt: "Teardown",
        skills: ["claude/bar"]
      },
      plan: {
        tasks: [
          {
            id: "feat",
            title: "Feature",
            prompt: "Add feature",
            status: {
              implement: "open"
            }
          }
        ]
      },
      turns: [successTurn(), successTurn(), successTurn()]
    });

    const { runs } = await sim.run();

    expect(runs.map((run) => run.skills)).toEqual([["foo"], undefined, ["claude/bar"]]);
  });

  it("honors maxRuns and leaves remaining tasks open", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          { id: "one", title: "One", prompt: "One", status: "open" },
          { id: "two", title: "Two", prompt: "Two", status: "open" },
          { id: "three", title: "Three", prompt: "Three", status: "open" }
        ]
      },
      config: {
        maxRuns: 2
      },
      turns: [successTurn(), successTurn()]
    });

    const { result, readPlan } = await sim.run();
    const plan = await readPlan();

    expect(result.stopReason).toBe("max_runs");
    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 2,
      tasksFailed: 0,
      stepsCompleted: 2
    });
    expect(plan.tasks.map((task) => task.status)).toEqual(["done", "done", "open"]);
  });

  it("continues with last good plan when steps.yaml is corrupted mid-run", async () => {
    const onReloadError = vi.fn();

    const sim = createPipelineSimulation({
      projectSteps: {
        implement: { mode: "yolo", prompt: "Implement {{id}}" }
      },
      plan: {
        tasks: [
          { id: "one", title: "One", prompt: "One", status: { implement: "open" } },
          { id: "two", title: "Two", prompt: "Two", status: { implement: "open" } }
        ]
      },
      onPlanReloadError: onReloadError,
      turns: [
        {
          output: { stdout: "", exitCode: 0 },
          fileChanges: {
            ".poe-code/pipeline/steps/default.yaml": "this is: [invalid yaml"
          }
        },
        successTurn()
      ]
    });

    const { result } = await sim.run();

    expect(onReloadError).toHaveBeenCalled();
    expect(result.stopReason).toBe("completed");
    expect(result.runsCompleted).toBe(2);
  });

  it("runs setup before tasks and teardown after all tasks complete", async () => {
    const sim = createPipelineSimulation({
      plan: {
        setup: { mode: "yolo", prompt: "Prepare the workspace" },
        teardown: { mode: "yolo", prompt: "Clean up" },
        tasks: [{ id: "task-1", title: "Task 1", prompt: "Do task 1", status: "open" }]
      },
      turns: [successTurn(), successTurn(), successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Prepare the workspace", "Do task 1", "Clean up"]);
    expect(result.metrics.stepsCompleted).toBe(3);
    expect(result.metrics.tasksCompleted).toBe(1);
  });

  it("does not run setup when the request is already aborted", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "setup:",
        "  prompt: Prepare workspace",
        "tasks:",
        "  - id: work",
        "    title: Work",
        "    prompt: Do work",
        "    status: open",
        "---",
        ""
      ].join("\n")
    });
    const controller = new AbortController();
    controller.abort();
    const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await expect(
      runPipeline({
        agent: "codex",
        cwd: "/repo",
        homeDir: "/home/test",
        plan: "docs/plans/plan.md",
        fs,
        signal: controller.signal,
        runAgent
      })
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(runAgent).not.toHaveBeenCalled();
  });

  it("reports cancelled task completion after an in-flight abort", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: task-1",
        "    title: Task 1",
        "    prompt: Do task 1",
        "    status: open",
        "---",
        ""
      ].join("\n")
    });
    const controller = new AbortController();
    const onTaskComplete = vi.fn();
    const result = await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/plan.md",
      fs,
      signal: controller.signal,
      onTaskComplete,
      runAgent: async () => {
        controller.abort();
        const error = new Error("cancelled");
        error.name = "AbortError";
        throw error;
      }
    });

    expect(result.stopReason).toBe("cancelled");
    expect(onTaskComplete).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", success: false })
    );
  });

  it("returns cancelled without persisting a final task that aborts while succeeding", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: final",
        "    title: Final",
        "    prompt: Finish",
        "    status: open",
        "---",
        ""
      ].join("\n")
    });
    const controller = new AbortController();

    const result = await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/plan.md",
      fs,
      signal: controller.signal,
      runAgent: async () => {
        controller.abort();
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    expect(result.stopReason).toBe("cancelled");
    expect(await fs.readFile("/repo/docs/plans/plan.md", "utf8")).toContain("status: open");
  });

  it("stops before tasks when setup fails", async () => {
    const sim = createPipelineSimulation({
      plan: {
        setup: { mode: "yolo", prompt: "Setup" },
        tasks: [{ id: "task-1", title: "Task 1", prompt: "Do task 1", status: "open" }]
      },
      turns: [failTurn("setup failed")]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("failed");
    expect(result.runsCompleted).toBe(0);
    expect(prompts).toEqual(["Setup"]);
  });

  it("disables steps.yaml setup when plan sets setup: null", async () => {
    const sim = createPipelineSimulation({
      projectStepsSetup: { mode: "yolo", prompt: "Setup from steps.yaml" },
      plan: {
        setup: null,
        tasks: [{ id: "task-1", title: "Task 1", prompt: "Do task 1", status: "open" }]
      },
      turns: [successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Do task 1"]);
  });

  it("overrides steps.yaml setup when plan defines its own setup", async () => {
    const sim = createPipelineSimulation({
      projectStepsSetup: { mode: "yolo", prompt: "Setup from steps.yaml" },
      plan: {
        setup: { mode: "yolo", prompt: "Custom setup from plan" },
        tasks: [{ id: "task-1", title: "Task 1", prompt: "Do task 1", status: "open" }]
      },
      turns: [successTurn(), successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Custom setup from plan", "Do task 1"]);
  });

  it("returns failed when teardown fails after all tasks complete", async () => {
    const sim = createPipelineSimulation({
      plan: {
        teardown: { mode: "yolo", prompt: "Teardown" },
        tasks: [{ id: "task-1", title: "Task 1", prompt: "Do task 1", status: "open" }]
      },
      turns: [successTurn(), failTurn("teardown failed")]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("failed");
    expect(result.runsCompleted).toBe(1);
    expect(prompts).toEqual(["Do task 1", "Teardown"]);
  });

  it("does not archive a completed plan when teardown fails", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "teardown:",
        "  prompt: Clean up",
        "tasks:",
        "  - id: work",
        "    title: Work",
        "    prompt: Do work",
        "    status: open",
        "---",
        ""
      ].join("\n")
    });
    const runAgent = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "failed", exitCode: 1 });

    const result = await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/plan.md",
      planDirectory: "docs/plans",
      fs,
      runAgent
    });

    expect(result.stopReason).toBe("failed");
    await expect(fs.readFile("/repo/docs/plans/plan.md", "utf8")).resolves.toContain("status: done");
    await expect(fs.stat("/repo/docs/plans/archive/plan.md")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns cancelled when teardown aborts while resolving successfully", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "teardown:",
        "  prompt: Clean up",
        "tasks:",
        "  - id: task-1",
        "    title: Task 1",
        "    prompt: Do task 1",
        "    status: open",
        "---",
        ""
      ].join("\n")
    });
    const controller = new AbortController();
    const runAgent = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockImplementationOnce(async () => {
        controller.abort();
        return { stdout: "", stderr: "", exitCode: 0 };
      });

    const result = await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/plan.md",
      fs,
      signal: controller.signal,
      runAgent
    });

    expect(result.stopReason).toBe("cancelled");
  });

  it("expands {{file '...'}} in task prompts", async () => {
    const sim = createPipelineSimulation({
      files: {
        "docs/context.md": "# Context\nUse this context."
      },
      plan: {
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            prompt: "Preamble\n{{file 'docs/context.md'}}\nDo the work.",
            status: "open"
          }
        ]
      },
      turns: [successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Preamble\n# Context\nUse this context.\nDo the work."]);
  });

  it("interpolates vars into task prompt", async () => {
    const sim = createPipelineSimulation({
      plan: {
        vars: { env: "production" },
        tasks: [
          {
            id: "task-1",
            title: "Deploy",
            prompt: "Deploy to {{env}}.",
            status: "open"
          }
        ]
      },
      turns: [successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Deploy to production."]);
  });

  it("throws before spawning an agent when a prompt references a missing var", async () => {
    const fs = createFs({
      "/repo/.poe-code/pipeline/steps/default.yaml": [
        "steps:",
        "  implement:",
        "    prompt: Deploy to {{env}}.",
        ""
      ].join("\n"),
      "/repo/.poe-code/pipeline/plans/plan.yaml": [
        `$schema: ${pipelineDocumentSchemaId}`,
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: deploy",
        "    title: Deploy",
        "    prompt: Ship it",
        "    status:",
        "      implement: open",
        ""
      ].join("\n")
    });
    const runAgent = vi.fn();

    await expect(
      runPipeline({
        agent: "codex",
        cwd: "/repo",
        homeDir: "/home/test",
        plan: ".poe-code/pipeline/plans/plan.yaml",
        fs,
        runAgent
      })
    ).rejects.toThrow('Missing pipeline variable "env" in task "deploy" step "implement".');

    expect(runAgent).not.toHaveBeenCalled();
  });

  it("throws before spawning any agent when a later task references a missing var", async () => {
    const fs = createFs({
      "/repo/.poe-code/pipeline/steps/default.yaml": [
        "steps:",
        "  implement:",
        "    prompt: '{{prompt}}'",
        ""
      ].join("\n"),
      "/repo/.poe-code/pipeline/plans/plan.yaml": [
        `$schema: ${pipelineDocumentSchemaId}`,
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: first",
        "    title: First",
        "    prompt: Safe prompt",
        "    status:",
        "      implement: open",
        "  - id: second",
        "    title: Second",
        "    prompt: Deploy to {{env}}.",
        "    status:",
        "      implement: open",
        ""
      ].join("\n")
    });
    const runAgent = vi.fn();

    await expect(
      runPipeline({
        agent: "codex",
        cwd: "/repo",
        homeDir: "/home/test",
        plan: ".poe-code/pipeline/plans/plan.yaml",
        fs,
        runAgent
      })
    ).rejects.toThrow('Missing pipeline variable "env" in task "second" step "implement".');

    expect(runAgent).not.toHaveBeenCalled();
  });

  it("resolves a file-backed var and interpolates it into task prompt", async () => {
    const sim = createPipelineSimulation({
      files: {
        "docs/context/my-feature.md": "# My Feature\nBuild the thing."
      },
      plan: {
        vars: { plan_doc: "{{file 'docs/context/my-feature.md'}}" },
        tasks: [
          {
            id: "task-1",
            title: "Implement",
            prompt: "{{plan_doc}}\n\nDo the implementation.",
            status: "open"
          }
        ]
      },
      turns: [successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["# My Feature\nBuild the thing.\n\nDo the implementation."]);
  });

  it("expands {{file '...'}} in setup/teardown prompts", async () => {
    const sim = createPipelineSimulation({
      files: {
        "docs/setup-instructions.md": "Install dependencies."
      },
      plan: {
        setup: { mode: "yolo", prompt: "{{file 'docs/setup-instructions.md'}}" },
        tasks: [{ id: "task-1", title: "Task 1", prompt: "Do task 1", status: "open" }]
      },
      turns: [successTurn(), successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Install dependencies.", "Do task 1"]);
  });
});
