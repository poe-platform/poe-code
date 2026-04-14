import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { RunAgentInput } from "./hooks.js";
import {
  runDocumentWorkflow,
  type DocumentWorkflowOptions,
  type IterationResult,
  type WorkflowFileSystem
} from "./runner.js";

type Frontmatter = {
  participants?: Record<string, unknown>;
  setup?: Record<string, unknown>;
  teardown?: Record<string, unknown>;
  stages?: Array<Record<string, unknown>>;
  max_iterations?: number;
};

function createFs(files: Record<string, string> = {}): {
  fs: WorkflowFileSystem;
  volume: Volume;
} {
  const volume = Volume.fromJSON(files, "/");
  const fs = createFsFromVolume(volume).promises as unknown as WorkflowFileSystem;
  return { fs, volume };
}

function createOptions(options: {
  frontmatter?: Frontmatter;
  fs?: WorkflowFileSystem;
  runAgent?: DocumentWorkflowOptions["runAgent"];
  readConfig?: DocumentWorkflowOptions["readConfig"];
  signal?: AbortSignal;
  onIterationStart?: (iteration: number) => void;
  onIterationEnd?: (iteration: number, result: IterationResult) => void;
} = {}): DocumentWorkflowOptions {
  const { fs = createFs({ "/repo/workflow.md": "# workflow" }).fs } = options;

  return {
    cwd: "/repo",
    homeDir: "/home/test",
    docPath: "/repo/workflow.md",
    fs,
    runAgent:
      options.runAgent ??
      vi.fn(async (_input: RunAgentInput) => ({
        exitCode: 0
      })),
    readConfig:
      options.readConfig ??
      vi.fn((_content: string) => ({
        frontmatter:
          options.frontmatter ?? {
            participants: {
              default: {
                agent: "claude",
                mode: "edit"
              }
            },
            stages: [
              {
                id: "draft",
                participant: "default",
                prompt: "Draft the document"
              }
            ],
            max_iterations: 1
          },
        body: "Body"
      })),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onIterationStart ? { onIterationStart: options.onIterationStart } : {}),
    ...(options.onIterationEnd ? { onIterationEnd: options.onIterationEnd } : {})
  };
}

describe("runDocumentWorkflow", () => {
  it("runs setup, stages, and teardown in order", async () => {
    const prompts: string[] = [];
    const options = createOptions({
      frontmatter: {
        participants: {
          default: {
            agent: "claude",
            mode: "edit"
          },
          reviewer: {
            agent: "codex",
            mode: "read"
          }
        },
        setup: {
          prompt: "Setup workspace"
        },
        stages: [
          {
            id: "draft",
            participant: "default",
            prompt: "Draft changes"
          },
          {
            id: "review",
            participant: "reviewer",
            prompt: "Review changes"
          }
        ],
        teardown: {
          participant: "reviewer",
          prompt: "Clean up"
        },
        max_iterations: 1
      },
      runAgent: vi.fn(async (input: RunAgentInput) => {
        prompts.push(input.prompt);
        return { exitCode: 0 };
      })
    });

    await runDocumentWorkflow(options);

    expect(prompts).toEqual([
      "Setup workspace",
      "Draft changes",
      "Review changes",
      "Clean up"
    ]);
  });

  it("respects max_iterations", async () => {
    const prompts: string[] = [];
    const options = createOptions({
      frontmatter: {
        participants: {
          default: {
            agent: "claude",
            mode: "edit"
          }
        },
        stages: [
          {
            id: "draft",
            participant: "default",
            prompt: "Draft changes"
          }
        ],
        max_iterations: 2
      },
      runAgent: vi.fn(async (input: RunAgentInput) => {
        prompts.push(input.prompt);
        return { exitCode: 0 };
      })
    });

    await runDocumentWorkflow(options);

    expect(prompts).toEqual(["Draft changes", "Draft changes"]);
  });

  it("acquires the lock before execution and releases it after", async () => {
    const operations: string[] = [];
    const baseFs = createFs({ "/repo/workflow.md": "# workflow" }).fs;
    const fs: WorkflowFileSystem = {
      readFile: async (filePath, encoding) => {
        operations.push(`readFile:${filePath}`);
        return baseFs.readFile(filePath, encoding);
      },
      mkdir: async (filePath, options) => {
        operations.push(`mkdir:${filePath}`);
        await baseFs.mkdir(filePath, options);
      },
      rmdir: async (filePath) => {
        operations.push(`rmdir:${filePath}`);
        await baseFs.rmdir(filePath);
      },
      stat: async (filePath) => baseFs.stat(filePath)
    };
    const options = createOptions({
      fs,
      frontmatter: {
        participants: {
          default: {
            agent: "claude",
            mode: "edit"
          }
        },
        setup: {
          prompt: "Setup workspace"
        },
        stages: [
          {
            id: "draft",
            participant: "default",
            prompt: "Draft changes"
          }
        ],
        teardown: {
          prompt: "Clean up"
        },
        max_iterations: 1
      },
      runAgent: vi.fn(async (input: RunAgentInput) => {
        operations.push(`run:${input.prompt}`);
        return { exitCode: 0 };
      })
    });

    await runDocumentWorkflow(options);

    expect(operations).toEqual([
      "readFile:/repo/workflow.md",
      "mkdir:/repo/workflow.md.lock",
      "run:Setup workspace",
      "run:Draft changes",
      "run:Clean up",
      "rmdir:/repo/workflow.md.lock"
    ]);
  });

  it("releases the lock even when execution throws", async () => {
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });
    const options = createOptions({
      fs,
      frontmatter: {
        participants: {
          default: {
            agent: "claude",
            mode: "edit"
          }
        },
        stages: [
          {
            id: "draft",
            participant: "default",
            prompt: "Draft changes"
          }
        ],
        max_iterations: 1
      },
      runAgent: vi.fn(async () => {
        throw new Error("stage failed");
      })
    });

    await expect(runDocumentWorkflow(options)).rejects.toThrow("stage failed");
    await expect(fs.stat("/repo/workflow.md.lock")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it('breaks the loop when a stage with onFailure "stop" fails', async () => {
    const prompts: string[] = [];
    const onIterationEnd = vi.fn();
    const options = createOptions({
      frontmatter: {
        participants: {
          default: {
            agent: "claude",
            mode: "edit"
          }
        },
        stages: [
          {
            id: "draft",
            participant: "default",
            prompt: "Fail this iteration",
            onFailure: "stop"
          },
          {
            id: "after",
            participant: "default",
            prompt: "Should not run"
          }
        ],
        max_iterations: 3
      },
      runAgent: vi.fn(async (input: RunAgentInput) => {
        prompts.push(input.prompt);
        if (input.prompt === "Fail this iteration") {
          throw new Error("stage failed");
        }
        return { exitCode: 0 };
      }),
      onIterationEnd
    });

    await expect(runDocumentWorkflow(options)).resolves.toBeUndefined();

    expect(prompts).toEqual(["Fail this iteration"]);
    expect(onIterationEnd).toHaveBeenCalledTimes(1);
    expect(onIterationEnd).toHaveBeenCalledWith(0, "failed");
  });

  it("stops execution when the abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });
    const runAgent = vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 }));

    await expect(
      runDocumentWorkflow(
        createOptions({
          fs,
          signal: controller.signal,
          runAgent
        })
      )
    ).rejects.toThrow("cancelled");

    expect(runAgent).not.toHaveBeenCalled();
    await expect(fs.stat("/repo/workflow.md.lock")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("runs teardown even when execution is aborted", async () => {
    const controller = new AbortController();
    const prompts: string[] = [];
    const options = createOptions({
      signal: controller.signal,
      frontmatter: {
        participants: {
          default: {
            agent: "claude",
            mode: "edit"
          }
        },
        setup: {
          prompt: "Setup workspace"
        },
        stages: [
          {
            id: "draft",
            participant: "default",
            prompt: "Abort during stage",
            onFailure: "stop"
          }
        ],
        teardown: {
          prompt: "Clean up"
        },
        max_iterations: 1
      },
      runAgent: vi.fn(async (input: RunAgentInput) => {
        prompts.push(input.prompt);
        if (input.prompt === "Abort during stage") {
          controller.abort(new Error("cancelled"));
          throw new Error("cancelled");
        }
        return { exitCode: 0 };
      })
    });

    await expect(runDocumentWorkflow(options)).resolves.toBeUndefined();

    expect(prompts).toEqual(["Setup workspace", "Abort during stage", "Clean up"]);
  });

  it("calls onIterationStart and onIterationEnd for each iteration", async () => {
    const iterationStarts: number[] = [];
    const iterationEnds: Array<[number, IterationResult]> = [];
    const options = createOptions({
      frontmatter: {
        participants: {
          default: {
            agent: "claude",
            mode: "edit"
          }
        },
        stages: [
          {
            id: "draft",
            participant: "default",
            prompt: "Draft changes"
          }
        ],
        max_iterations: 2
      },
      onIterationStart: (iteration) => {
        iterationStarts.push(iteration);
      },
      onIterationEnd: (iteration, result) => {
        iterationEnds.push([iteration, result]);
      }
    });

    await runDocumentWorkflow(options);

    expect(iterationStarts).toEqual([0, 1]);
    expect(iterationEnds).toEqual([
      [0, "completed"],
      [1, "completed"]
    ]);
  });
});
