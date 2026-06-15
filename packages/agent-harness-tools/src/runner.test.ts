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

function createOptions(
  options: {
    frontmatter?: Frontmatter;
    fs?: WorkflowFileSystem;
    runAgent?: DocumentWorkflowOptions["runAgent"];
    readConfig?: DocumentWorkflowOptions["readConfig"];
    signal?: AbortSignal;
    onIterationStart?: (iteration: number) => void;
    onIterationEnd?: (iteration: number, result: IterationResult) => void;
  } = {}
): DocumentWorkflowOptions {
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
        frontmatter: options.frontmatter ?? {
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
  it("ignores inherited workflow document fields", async () => {
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });
    const runAgent = vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 }));
    const iterationEnds: Array<[number, IterationResult]> = [];

    await withObjectPrototypeProperties(
      {
        participants: {
          default: {
            agent: "claude",
            mode: "edit"
          }
        },
        setup: {
          prompt: "Polluted setup"
        },
        stages: [
          {
            id: "polluted",
            participant: "default",
            prompt: "Polluted stage"
          }
        ],
        max_iterations: 1
      },
      async () => {
        await runDocumentWorkflow(
          createOptions({
            fs,
            frontmatter: {},
            runAgent,
            onIterationEnd: (iteration, result) => {
              iterationEnds.push([iteration, result]);
            }
          })
        );
      }
    );

    expect(runAgent).not.toHaveBeenCalled();
    expect(iterationEnds).toEqual([[0, "nothing_to_run"]]);
  });

  it("does not accept inherited setup fields", async () => {
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });

    await withObjectPrototypeProperties({ prompt: "Polluted setup" }, async () => {
      await expect(
        runDocumentWorkflow(
          createOptions({
            fs,
            frontmatter: {
              participants: {
                default: {
                  agent: "claude",
                  mode: "edit"
                }
              },
              setup: {}
            }
          })
        )
      ).rejects.toThrow('Workflow "setup" must define a non-empty prompt.');
    });
  });

  it("does not accept inherited stage fields", async () => {
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });

    await withObjectPrototypeProperties(
      {
        id: "polluted",
        participant: "default",
        prompt: "Polluted stage",
        mode: "edit"
      },
      async () => {
        await expect(
          runDocumentWorkflow(
            createOptions({
              fs,
              frontmatter: {
                participants: {
                  default: {
                    agent: "claude",
                    mode: "edit"
                  }
                },
                stages: [{}]
              }
            })
          )
        ).rejects.toThrow("Workflow stage at index 0 must define a non-empty id.");
      }
    );
  });

  it("does not accept inherited stage hook fields", async () => {
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });

    await withObjectPrototypeProperties({ from: "polluted" }, async () => {
      await expect(
        runDocumentWorkflow(
          createOptions({
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
                  id: "implement",
                  participant: "default",
                  prompt: "Implement",
                  hooks: {}
                }
              ]
            }
          })
        )
      ).rejects.toThrow('Workflow stage "implement" hooks from must be a non-empty string.');
    });
  });

  it("rejects whitespace-only participant ids before running stages", async () => {
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });
    const runAgent = vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 }));

    await expect(
      runDocumentWorkflow(
        createOptions({
          fs,
          runAgent,
          frontmatter: {
            participants: {
              "   ": {
                agent: "claude",
                mode: "edit"
              }
            },
            stages: [
              {
                id: "draft",
                participant: "   ",
                prompt: "Draft changes"
              }
            ]
          }
        })
      )
    ).rejects.toThrow("Workflow participant id must be a non-empty string.");
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only stage participants before running stages", async () => {
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });
    const runAgent = vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 }));

    await expect(
      runDocumentWorkflow(
        createOptions({
          fs,
          runAgent,
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
                participant: "   ",
                prompt: "Draft changes"
              }
            ]
          }
        })
      )
    ).rejects.toThrow('Workflow stage "draft" must define a non-empty participant.');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only stage prompts before running stages", async () => {
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });
    const runAgent = vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 }));

    await expect(
      runDocumentWorkflow(
        createOptions({
          fs,
          runAgent,
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
                prompt: "   "
              }
            ]
          }
        })
      )
    ).rejects.toThrow('Workflow stage "draft" prompt must be a non-empty string when provided.');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only stage hook sources before running stages", async () => {
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });
    const runAgent = vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 }));

    await expect(
      runDocumentWorkflow(
        createOptions({
          fs,
          runAgent,
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
                prompt: "Draft changes",
                hooks: { from: "   " }
              }
            ]
          }
        })
      )
    ).rejects.toThrow('Workflow stage "draft" hooks from must be a non-empty string.');
    expect(runAgent).not.toHaveBeenCalled();
  });

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

    expect(prompts).toEqual(["Setup workspace", "Draft changes", "Review changes", "Clean up"]);
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

  it("runs setup, stages, and teardown in execution order", async () => {
    const operations: string[] = [];
    const baseFs = createFs({ "/repo/workflow.md": "# workflow" }).fs;
    const fs = {
      readFile: async (filePath, encoding) => {
        operations.push(`readFile:${filePath}`);
        return baseFs.readFile(filePath, encoding);
      },
      mkdir: async (filePath, options) => baseFs.mkdir(filePath, options),
      rmdir: async (filePath) => baseFs.rmdir(filePath),
      stat: async (filePath) => baseFs.stat(filePath)
    } as WorkflowFileSystem;
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
      "run:Setup workspace",
      "run:Draft changes",
      "run:Clean up"
    ]);
  });

  it("throws when execution fails", async () => {
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
  });

  it("runs teardown while propagating execution cancellation", async () => {
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

    await expect(runDocumentWorkflow(options)).rejects.toThrow("cancelled");

    expect(prompts).toEqual(["Setup workspace", "Abort during stage", "Clean up"]);
  });

  it("does not pass an already aborted execution signal to teardown", async () => {
    const controller = new AbortController();
    const cancelled = new Error("cancelled");
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
        stages: [
          {
            id: "draft",
            participant: "default",
            prompt: "Abort during stage"
          }
        ],
        teardown: {
          prompt: "Clean up"
        },
        max_iterations: 1
      },
      runAgent: vi.fn(async (input: RunAgentInput) => {
        if (input.signal?.aborted) {
          throw input.signal.reason;
        }

        prompts.push(input.prompt);
        if (input.prompt === "Abort during stage") {
          controller.abort(cancelled);
          throw cancelled;
        }

        return { exitCode: 0 };
      })
    });

    await expect(runDocumentWorkflow(options)).rejects.toBe(cancelled);

    expect(prompts).toEqual(["Abort during stage", "Clean up"]);
  });

  it("rejects when the final stage aborts during otherwise successful execution", async () => {
    const controller = new AbortController();
    const cancelled = new Error("cancelled");
    const iterationEnds: Array<[number, IterationResult]> = [];
    const options = createOptions({
      signal: controller.signal,
      frontmatter: {
        participants: {
          default: {
            agent: "claude",
            mode: "edit"
          }
        },
        stages: [{ id: "draft", participant: "default", prompt: "Draft changes" }],
        max_iterations: 1
      },
      runAgent: vi.fn(async () => {
        controller.abort(cancelled);
        return { exitCode: 0 };
      }),
      onIterationEnd: (iteration, result) => {
        iterationEnds.push([iteration, result]);
      }
    });

    await expect(runDocumentWorkflow(options)).rejects.toBe(cancelled);

    expect(iterationEnds).toEqual([]);
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

  it("reports reloaded iterations without stages as nothing to run", async () => {
    let reads = 0;
    const iterationEnds: Array<[number, IterationResult]> = [];
    const runAgent = vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 }));
    const options = createOptions({
      readConfig: async () => {
        reads += 1;
        return {
          frontmatter: {
            participants: {
              default: {
                agent: "claude",
                mode: "edit"
              }
            },
            stages:
              reads === 1 ? [{ id: "draft", participant: "default", prompt: "Draft changes" }] : [],
            max_iterations: 2
          },
          body: "Body"
        };
      },
      runAgent,
      onIterationEnd: (iteration, result) => {
        iterationEnds.push([iteration, result]);
      }
    });

    await runDocumentWorkflow(options);

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(iterationEnds).toEqual([
      [0, "completed"],
      [1, "nothing_to_run"]
    ]);
  });

  it("honors a lower iteration limit from a reloaded workflow", async () => {
    let reads = 0;
    const runAgent = vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 }));
    const options = createOptions({
      readConfig: async () => {
        reads += 1;
        return {
          frontmatter: {
            participants: {
              default: {
                agent: "claude",
                mode: "edit"
              }
            },
            stages: [{ id: "draft", participant: "default", prompt: "Draft changes" }],
            max_iterations: reads === 1 ? 3 : 1
          },
          body: "Body"
        };
      },
      runAgent
    });

    await runDocumentWorkflow(options);

    expect(reads).toBe(2);
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("awaits async iteration callbacks before continuing", async () => {
    const events: string[] = [];
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
        max_iterations: 1
      },
      runAgent: vi.fn(async () => {
        events.push("run");
        return { exitCode: 0 };
      }),
      onIterationStart: ((iteration: number) =>
        Promise.resolve().then(() => {
          events.push(`start:${iteration}`);
        })) as unknown as (iteration: number) => void,
      onIterationEnd: ((iteration: number, result: IterationResult) =>
        Promise.resolve().then(() => {
          events.push(`end:${iteration}:${result}`);
        })) as unknown as (iteration: number, result: IterationResult) => void
    });

    await runDocumentWorkflow(options);

    expect(events).toEqual(["start:0", "run", "end:0:completed"]);
  });

  it("parses stage skills from workflow frontmatter and leaves stages without skills unchanged", async () => {
    const runAgent = vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 }));
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
            id: "implement",
            participant: "default",
            prompt: "Implement",
            skills: ["foo", "claude/bar"]
          },
          {
            id: "review",
            participant: "default",
            prompt: "Review"
          }
        ],
        max_iterations: 1
      },
      runAgent
    });

    await runDocumentWorkflow(options);

    expect(runAgent.mock.calls.map(([input]) => input)).toEqual([
      {
        agent: "claude-code",
        prompt: "Implement",
        mode: "edit",
        cwd: "/repo",
        skills: ["foo", "claude/bar"]
      },
      {
        agent: "claude-code",
        prompt: "Review",
        mode: "edit",
        cwd: "/repo"
      }
    ]);
    expect(Object.hasOwn(runAgent.mock.calls[1]![0], "skills")).toBe(false);
  });

  it("parses stage hooks from workflow frontmatter and leaves absent hooks unchanged", async () => {
    const runAgent = vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 }));
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
            id: "implement",
            participant: "default",
            prompt: "Implement",
            hooks: { from: "claude" }
          },
          {
            id: "review",
            participant: "default",
            prompt: "Review"
          }
        ],
        max_iterations: 1
      },
      runAgent
    });

    await runDocumentWorkflow(options);

    expect(runAgent.mock.calls[0]![0]).toMatchObject({ hooks: { from: "claude" } });
    expect(Object.hasOwn(runAgent.mock.calls[1]![0], "hooks")).toBe(false);
  });

  it("rejects an empty setup participant instead of using the default", async () => {
    await expect(
      runDocumentWorkflow(
        createOptions({
          frontmatter: {
            participants: {
              default: {
                agent: "claude",
                mode: "edit"
              }
            },
            setup: {
              participant: "",
              prompt: "Prepare workspace"
            }
          }
        })
      )
    ).rejects.toThrow('Workflow "setup" participant must define a non-empty string.');
  });

  it("rejects an empty teardown participant instead of using the default", async () => {
    await expect(
      runDocumentWorkflow(
        createOptions({
          frontmatter: {
            participants: {
              default: {
                agent: "claude",
                mode: "edit"
              }
            },
            teardown: {
              participant: "",
              prompt: "Clean workspace"
            }
          }
        })
      )
    ).rejects.toThrow('Workflow "teardown" participant must define a non-empty string.');
  });

  it("preserves a prototype-named participant for implicit setup selection", async () => {
    const runAgent = vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 }));

    await runDocumentWorkflow(
      createOptions({
        frontmatter: JSON.parse(
          '{"participants":{"__proto__":{"agent":"codex","mode":"read"}},"setup":{"prompt":"Prepare workspace"}}'
        ) as Frontmatter,
        runAgent
      })
    );

    expect(runAgent.mock.calls[0]![0]).toMatchObject({
      agent: "codex",
      mode: "read",
      prompt: "Prepare workspace"
    });
  });

  it("rejects malformed stage skills", async () => {
    await expect(
      runDocumentWorkflow(
        createOptions({
          frontmatter: {
            participants: {
              default: {
                agent: "claude",
                mode: "edit"
              }
            },
            stages: [
              {
                id: "implement",
                participant: "default",
                prompt: "Implement",
                skills: ["foo/bar/baz"]
              }
            ]
          }
        })
      )
    ).rejects.toThrow(/skills must contain skill references/i);

    await expect(
      runDocumentWorkflow(
        createOptions({
          frontmatter: {
            participants: {
              default: {
                agent: "claude",
                mode: "edit"
              }
            },
            stages: [
              {
                id: "implement",
                participant: "default",
                prompt: "Implement",
                skills: "foo"
              }
            ]
          }
        })
      )
    ).rejects.toThrow(/skills must be an array of strings/i);
  });
});
