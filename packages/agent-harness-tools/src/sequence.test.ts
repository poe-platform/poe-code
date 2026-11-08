import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { RunAgentInput } from "./hooks.js";
import {
  runDocumentWorkflowSequence,
  type DocumentWorkflowSequenceOptions
} from "./sequence.js";
import type { WorkflowFileSystem } from "./runner.js";

function createFs(files: Record<string, string> = {}): {
  fs: WorkflowFileSystem;
  volume: Volume;
} {
  const volume = Volume.fromJSON(files, "/");
  const fs = createFsFromVolume(volume).promises as unknown as WorkflowFileSystem;
  return { fs, volume };
}

function createWorkflowDocument(data: Record<string, unknown>): string {
  return JSON.stringify({
    participants: {
      default: {
        agent: "claude",
        mode: "edit"
      }
    },
    max_iterations: 1,
    ...data
  });
}

function createOptions(options: {
  docPaths: string[];
  fs: WorkflowFileSystem;
  runAgent?: DocumentWorkflowSequenceOptions["runAgent"];
  stopOnFailure?: boolean;
  onSequenceProgress?: DocumentWorkflowSequenceOptions["onSequenceProgress"];
  onIterationEnd?: DocumentWorkflowSequenceOptions["onIterationEnd"];
}): DocumentWorkflowSequenceOptions {
  return {
    cwd: "/repo",
    homeDir: "/home/test",
    docPaths: options.docPaths,
    fs: options.fs,
    runAgent:
      options.runAgent ??
      vi.fn(async (_input: RunAgentInput) => ({
        exitCode: 0
      })),
    readConfig: (content: string) => ({
      frontmatter: JSON.parse(content),
      body: ""
    }),
    ...(options.stopOnFailure === undefined
      ? {}
      : { stopOnFailure: options.stopOnFailure }),
    ...(options.onSequenceProgress ? { onSequenceProgress: options.onSequenceProgress } : {}),
    ...(options.onIterationEnd ? { onIterationEnd: options.onIterationEnd } : {})
  };
}

describe("runDocumentWorkflowSequence", () => {
  it("runs docs in order", async () => {
    const prompts: string[] = [];
    const { fs } = createFs({
      "/repo/one.md": createWorkflowDocument({
        stages: [{ id: "one", participant: "default", prompt: "Doc 1" }]
      }),
      "/repo/two.md": createWorkflowDocument({
        stages: [{ id: "two", participant: "default", prompt: "Doc 2" }]
      })
    });

    await runDocumentWorkflowSequence(
      createOptions({
        fs,
        docPaths: ["/repo/one.md", "/repo/two.md"],
        runAgent: vi.fn(async (input: RunAgentInput) => {
          prompts.push(input.prompt);
          return { exitCode: 0 };
        })
      })
    );

    expect(prompts).toEqual(["Doc 1", "Doc 2"]);
  });

  it("stops the sequence on the first failed doc by default", async () => {
    const prompts: string[] = [];
    const progress = vi.fn();
    const { fs } = createFs({
      "/repo/one.md": createWorkflowDocument({
        stages: [{ id: "one", participant: "default", prompt: "Doc 1" }]
      }),
      "/repo/two.md": createWorkflowDocument({
        stages: [
          {
            id: "two",
            participant: "default",
            prompt: "Fail",
            onFailure: "stop"
          }
        ]
      }),
      "/repo/three.md": createWorkflowDocument({
        stages: [{ id: "three", participant: "default", prompt: "Doc 3" }]
      })
    });

    await runDocumentWorkflowSequence(
      createOptions({
        fs,
        docPaths: ["/repo/one.md", "/repo/two.md", "/repo/three.md"],
        onSequenceProgress: progress,
        runAgent: vi.fn(async (input: RunAgentInput) => {
          prompts.push(input.prompt);
          if (input.prompt === "Fail") {
            throw new Error("failed");
          }
          return { exitCode: 0 };
        })
      })
    );

    expect(prompts).toEqual(["Doc 1", "Fail"]);
    expect(progress).toHaveBeenNthCalledWith(1, 0, 3, "/repo/one.md");
    expect(progress).toHaveBeenNthCalledWith(2, 1, 3, "/repo/two.md");
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it("continues past failures when stopOnFailure is false", async () => {
    const prompts: string[] = [];
    const { fs } = createFs({
      "/repo/one.md": createWorkflowDocument({
        stages: [{ id: "one", participant: "default", prompt: "Doc 1" }]
      }),
      "/repo/two.md": createWorkflowDocument({
        stages: [
          {
            id: "two",
            participant: "default",
            prompt: "Fail",
            onFailure: "stop"
          }
        ]
      }),
      "/repo/three.md": createWorkflowDocument({
        stages: [{ id: "three", participant: "default", prompt: "Doc 3" }]
      })
    });

    await runDocumentWorkflowSequence(
      createOptions({
        fs,
        docPaths: ["/repo/one.md", "/repo/two.md", "/repo/three.md"],
        stopOnFailure: false,
        runAgent: vi.fn(async (input: RunAgentInput) => {
          prompts.push(input.prompt);
          if (input.prompt === "Fail") {
            throw new Error("failed");
          }
          return { exitCode: 0 };
        })
      })
    );

    expect(prompts).toEqual(["Doc 1", "Fail", "Doc 3"]);
  });

  it("rejects parse failures that occur before any iteration result", async () => {
    const { fs } = createFs({
      "/repo/invalid.md": "not valid json",
      "/repo/two.md": createWorkflowDocument({
        stages: [{ id: "two", participant: "default", prompt: "Doc 2" }]
      })
    });
    const runAgent = vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 }));

    await expect(
      runDocumentWorkflowSequence(
        createOptions({
          fs,
          docPaths: ["/repo/invalid.md", "/repo/two.md"],
          runAgent
        })
      )
    ).rejects.toThrow();

    expect(runAgent).not.toHaveBeenCalled();
  });

  it("treats continued stage failures as sequence failures", async () => {
    const prompts: string[] = [];
    const { fs } = createFs({
      "/repo/one.md": createWorkflowDocument({
        stages: [
          {
            id: "one",
            participant: "default",
            prompt: "Recoverable failure",
            onFailure: "continue"
          }
        ]
      }),
      "/repo/two.md": createWorkflowDocument({
        stages: [{ id: "two", participant: "default", prompt: "Doc 2" }]
      })
    });

    await runDocumentWorkflowSequence(
      createOptions({
        fs,
        docPaths: ["/repo/one.md", "/repo/two.md"],
        runAgent: vi.fn(async (input: RunAgentInput) => {
          prompts.push(input.prompt);
          if (input.prompt === "Recoverable failure") {
            throw new Error("failed");
          }
          return { exitCode: 0 };
        })
      })
    );

    expect(prompts).toEqual(["Recoverable failure"]);
  });

  it("continues to the next doc when a workflow has nothing to run", async () => {
    const prompts: string[] = [];
    const { fs } = createFs({
      "/repo/one.md": createWorkflowDocument({
        stages: [{ id: "one", participant: "default", prompt: "Doc 1" }]
      }),
      "/repo/two.md": createWorkflowDocument({
        stages: []
      }),
      "/repo/three.md": createWorkflowDocument({
        stages: [{ id: "three", participant: "default", prompt: "Doc 3" }]
      })
    });

    await runDocumentWorkflowSequence(
      createOptions({
        fs,
        docPaths: ["/repo/one.md", "/repo/two.md", "/repo/three.md"],
        runAgent: vi.fn(async (input: RunAgentInput) => {
          prompts.push(input.prompt);
          return { exitCode: 0 };
        })
      })
    );

    expect(prompts).toEqual(["Doc 1", "Doc 3"]);
  });

  it("calls onSequenceProgress before each doc", async () => {
    const progressCalls: Array<[number, number, string]> = [];
    const { fs } = createFs({
      "/repo/one.md": createWorkflowDocument({
        stages: [{ id: "one", participant: "default", prompt: "Doc 1" }]
      }),
      "/repo/two.md": createWorkflowDocument({
        stages: [{ id: "two", participant: "default", prompt: "Doc 2" }]
      }),
      "/repo/three.md": createWorkflowDocument({
        stages: [{ id: "three", participant: "default", prompt: "Doc 3" }]
      })
    });

    await runDocumentWorkflowSequence(
      createOptions({
        fs,
        docPaths: ["/repo/one.md", "/repo/two.md", "/repo/three.md"],
        onSequenceProgress: (index, total, docPath) => {
          progressCalls.push([index, total, docPath]);
        }
      })
    );

    expect(progressCalls).toEqual([
      [0, 3, "/repo/one.md"],
      [1, 3, "/repo/two.md"],
      [2, 3, "/repo/three.md"]
    ]);
  });

  it("awaits asynchronous iteration callbacks before running the next document", async () => {
    const events: string[] = [];
    let releaseCallback: (() => void) | undefined;
    const { fs } = createFs({
      "/repo/one.md": createWorkflowDocument({
        stages: [{ id: "one", participant: "default", prompt: "Doc 1" }]
      }),
      "/repo/two.md": createWorkflowDocument({
        stages: [{ id: "two", participant: "default", prompt: "Doc 2" }]
      })
    });

    const sequence = runDocumentWorkflowSequence(
      createOptions({
        fs,
        docPaths: ["/repo/one.md", "/repo/two.md"],
        runAgent: vi.fn(async (input: RunAgentInput) => {
          events.push(`run:${input.prompt}`);
          return { exitCode: 0 };
        }),
        onIterationEnd: async () => {
          if (events.includes("run:Doc 1") && !events.includes("run:Doc 2")) {
            events.push("callback:start");
            await new Promise<void>((resolve) => {
              releaseCallback = resolve;
            });
            events.push("callback:end");
          }
        }
      })
    );

    await vi.waitFor(() => expect(events).toContain("callback:start"));
    expect(events).toEqual(["run:Doc 1", "callback:start"]);
    releaseCallback?.();
    await sequence;
    expect(events).toEqual(["run:Doc 1", "callback:start", "callback:end", "run:Doc 2"]);
  });
});
