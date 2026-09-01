import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { resolveProjectConfigPath } from "@poe-code/poe-code-config/core";
import {
  registerExecutionEnvFactory,
  type ExecutionEnvFactory,
  type JobHandle,
  type OpenedEnv
} from "@poe-code/agent-harness-tools";
import { buildDockerRuntimeTemplate } from "@poe-code/process-runner";
import { createCliContainer } from "../container.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerRuntimeCommand } from "./runtime/index.js";

const designSystemMocks = vi.hoisted(() => ({
  confirmOrCancel: vi.fn()
}));

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    confirmOrCancel: designSystemMocks.confirmOrCancel
  };
});

vi.mock("@poe-code/process-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/process-runner")>();
  return {
    ...actual,
    buildDockerRuntimeTemplate: vi.fn(async () => ({
      backend: "docker",
      hash: "mock-hash",
      image: "poe-code/local:mock-hash",
      cached: false
    }))
  };
});

const cwd = "/repo";
const homeDir = "/home/test";
const projectConfigPath = resolveProjectConfigPath(cwd);
const dockerfilePath = path.join(cwd, ".poe-code", "Dockerfile");
const statePath = path.join(homeDir, ".poe-code", "state", "templates.json");
const jobsDir = path.join(homeDir, ".poe-code", "state", "jobs");
const buildDockerRuntimeTemplateMock = vi.mocked(buildDockerRuntimeTemplate);

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

async function replaceWithSymlink(
  fs: Pick<FileSystem, "symlink" | "unlink">,
  filePath: string,
  target: string
): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (!hasOwnErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  await fs.symlink(target, filePath);
}

function createContainer(
  fs: FileSystem,
  logs: string[] = [],
  prompts = vi.fn().mockResolvedValue({})
) {
  return createCliContainer({
    fs,
    prompts,
    env: {
      cwd,
      homeDir,
      variables: {}
    },
    logger: (message) => logs.push(message)
  });
}

function stripAnsi(input: string): string {
  let result = "";
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (char === "\u001b" && input[index + 1] === "[") {
      index += 2;
      while (index < input.length && input[index] !== "m") {
        index += 1;
      }
      index += 1;
      continue;
    }
    result += char;
    index += 1;
  }

  return result;
}

function createJobEntry(overrides: {
  id: string;
  env_id: string;
  status: "pending" | "running" | "exited" | "killed" | "lost";
  started_at?: string;
  reattach_context?: Record<string, unknown>;
}) {
  return {
    id: overrides.id,
    env_id: overrides.env_id,
    env_kind: "docker",
    tool: "codex",
    argv: ["codex", "hello"],
    cwd,
    started_at: overrides.started_at ?? "2026-05-03T12:00:00.000Z",
    status: overrides.status,
    ...(overrides.reattach_context === undefined ? {} : { reattach_context: overrides.reattach_context })
  };
}

function createJobHandle(input: {
  status: Awaited<ReturnType<JobHandle["status"]>>;
  chunks?: string[];
  stream?: JobHandle["stream"];
  wait?: () => Promise<{ exitCode: number }>;
  kill?: (signal?: NodeJS.Signals) => Promise<void>;
}): JobHandle {
  return {
    id: "job",
    envId: "env",
    tool: "codex",
    argv: ["codex", "hello"],
    async status() {
      return input.status;
    },
    stream(options) {
      if (input.stream !== undefined) {
        return input.stream(options);
      }
      return createChunkStream(input.chunks ?? []);
    },
    async wait() {
      if (input.wait) {
        return await input.wait();
      }
      return { exitCode: 0 };
    },
    async kill(signal) {
      await input.kill?.(signal);
    }
  };
}

async function* createChunkStream(chunks: string[]): AsyncIterable<{
  byteOffset: number;
  data: string;
}> {
  for (const [index, chunk] of chunks.entries()) {
    yield { byteOffset: index, data: chunk };
  }
}

interface RuntimeFactoryEvents {
  attached: Array<{ envId: string; context: unknown }>;
  downloads: Array<{ envId: string; conflictPolicy: "refuse" | "overwrite" }>;
  downloadConflicts: Map<string, Array<{ path: string; reason: "local_modified" }>>;
  closed: string[];
}

function createTestRuntimeFactory(
  handles: Map<string, JobHandle>,
  events: RuntimeFactoryEvents
): ExecutionEnvFactory {
  return {
    type: "docker",
    supportsDetach: true,
    async open() {
      throw new Error("open is not used by runtime jobs tests");
    },
    async attach(envId, context) {
      const handle = handles.get(envId);
      if (!handle) {
        throw new Error(`missing sandbox ${envId}`);
      }
      events.attached.push({ envId, context });
      return {
        id: envId,
        job: handle,
        async uploadWorkspace() {
          return { files: 0, bytes: 0, skipped: [] };
        },
        async downloadWorkspace(options) {
          events.downloads.push({ envId, conflictPolicy: options.conflictPolicy });
          return {
            files: 0,
            bytes: 0,
            conflicts: events.downloadConflicts.get(envId) ?? []
          };
        },
        exec() {
          throw new Error("exec is not used by runtime jobs tests");
        },
        async detach() {
          return handle;
        },
        shell() {
          return {
            pid: 123,
            stdin: null,
            stdout: null,
            stderr: null,
            result: Promise.resolve({ exitCode: 0 }),
            kill() {}
          };
        },
        async close() {
          events.closed.push(envId);
        }
      } as OpenedEnv;
    }
  };
}

describe("runtime command", () => {
  const jobHandles = new Map<string, JobHandle>();
  const runtimeEvents: RuntimeFactoryEvents = {
    attached: [],
    downloads: [],
    downloadConflicts: new Map(),
    closed: []
  };

  beforeEach(() => {
    buildDockerRuntimeTemplateMock.mockClear();
    designSystemMocks.confirmOrCancel.mockReset().mockResolvedValue(true);
    jobHandles.clear();
    runtimeEvents.attached = [];
    runtimeEvents.downloads = [];
    runtimeEvents.downloadConflicts.clear();
    runtimeEvents.closed = [];
    registerExecutionEnvFactory(createTestRuntimeFactory(jobHandles, runtimeEvents));
  });

  it("initializes runtime config and default Dockerfile with --yes defaults", async () => {
    const fs = createMemFs();
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "runtime", "init"]);

    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toContain('"type": "docker"');
    await expect(fs.readFile(dockerfilePath, "utf8")).resolves.toContain(
      "npm i -g poe-code"
    );
  });

  it("does not follow a Dockerfile symlink inserted before default Dockerfile creation", async () => {
    const outsidePath = "/outside/Dockerfile";
    const fs = createMemFs({
      [outsidePath]: "outside-state\n"
    });
    const writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (filePath === dockerfilePath) {
        await replaceWithSymlink(fs, dockerfilePath, outsidePath);
      }
      await writeFile(filePath, data, options);
    });
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "--yes", "runtime", "init"])).rejects.toMatchObject({
      code: "EEXIST"
    });

    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside-state\n");
  });

  it("cleans a partial default Dockerfile when creation fails", async () => {
    const fs = createMemFs();
    const writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (filePath === dockerfilePath) {
        await writeFile(filePath, "partial Dockerfile\n", options);
        throw new Error("Dockerfile disk full");
      }

      await writeFile(filePath, data, options);
    });
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(
        program.parseAsync(["node", "cli", "--yes", "runtime", "init"])
      ).rejects.toThrow("Dockerfile disk full");
    });

    await expect(fs.readFile(dockerfilePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("deep-merges only runtime.type on an initialized project", async () => {
    const fs = createMemFs({
      [projectConfigPath]: `${JSON.stringify(
        {
          runtime: {
            type: "docker",
            build_args: { NODE_ENV: "test" },
            runner: { workspace: { exclude: ["coverage"] } }
          }
        },
        null,
        2
      )}\n`,
      [dockerfilePath]: "FROM custom\n"
    });
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "init", "--type", "host", "--yes"]);

    await expect(fs.readFile(dockerfilePath, "utf8")).resolves.toBe("FROM custom\n");
    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toMatchInlineSnapshot(`
      "{
        "runtime": {
          "type": "host",
          "build_args": {
            "NODE_ENV": "test"
          },
          "runner": {
            "workspace": {
              "exclude": [
                "coverage"
              ]
            }
          }
        }
      }
      "
    `);
  });

  it("snapshots runtime templates ls output grouped by backend", async () => {
    const fs = createMemFs({
      [statePath]: `${JSON.stringify(
        {
          docker: {
            abc123: {
              hash: "abc123",
              image: "poe-code/local:abc123",
              runtime_type: "docker",
              dockerfile_path: "/repo/.poe-code/Dockerfile",
              built_at: "2026-05-03T10:00:00.000Z"
            }
          }
        },
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "templates", "ls"]);

    expect(stripAnsi(logs.join("\n"))).toMatchSnapshot();
  });

  it("reports an empty state instead of placeholder rows when no templates are cached", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "templates", "ls"]);

    const output = stripAnsi(logs.join("\n"));
    expect(output).toContain("No local runtime template cache entries.");
    expect(output).toContain("poe-code runtime build");
    expect(output).not.toContain("(empty)");
    expect(output).not.toContain("Hash");
  });

  it("caps runtime templates list at --limit, keeping the newest builds", async () => {
    const fs = createMemFs({
      [statePath]: `${JSON.stringify(
        {
          docker: {
            stale: {
              hash: "stale",
              image: "poe-code/local:stale",
              runtime_type: "docker",
              dockerfile_path: "/repo/.poe-code/Dockerfile",
              built_at: "2026-05-03T10:00:00.000Z"
            },
            fresh: {
              hash: "fresh",
              image: "poe-code/local:fresh",
              runtime_type: "docker",
              dockerfile_path: "/repo/.poe-code/Dockerfile",
              built_at: "2026-07-14T10:00:00.000Z"
            }
          }
        },
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "templates", "list", "--limit", "1"]);

    const output = stripAnsi(logs.join("\n"));
    expect(output).toContain("fresh");
    expect(output).not.toContain("stale");
    expect(output).toContain("--all");
  });

  it("filters runtime templates list by --since and restores every build with --all", async () => {
    const fs = createMemFs({
      [statePath]: `${JSON.stringify(
        {
          docker: {
            stale: {
              hash: "stale",
              image: "poe-code/local:stale",
              runtime_type: "docker",
              dockerfile_path: "/repo/.poe-code/Dockerfile",
              built_at: "2026-05-03T10:00:00.000Z"
            }
          }
        },
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "templates", "list", "--since", "7d"]);
    expect(stripAnsi(logs.join("\n"))).not.toContain("stale");

    logs.length = 0;
    await program.parseAsync(["node", "cli", "runtime", "templates", "ls", "--all"]);
    expect(stripAnsi(logs.join("\n"))).toContain("stale");
  });

  it("snapshots runtime templates clear output and removes local template entries", async () => {
    const fs = createMemFs({
      [statePath]: `${JSON.stringify(
        {
          docker: {
            abc123: {
              hash: "abc123",
              image: "poe-code/local:abc123",
              runtime_type: "docker",
              dockerfile_path: "/repo/.poe-code/Dockerfile",
              built_at: "2026-05-03T10:00:00.000Z"
            }
          }
        },
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "runtime", "templates", "clear"]);

    expect(stripAnsi(logs.join("\n"))).toMatchSnapshot();
    await expect(fs.readFile(statePath, "utf8")).resolves.toMatchInlineSnapshot(`
      "{
        "docker": {}
      }
      "
    `);
  });

  it("previews runtime templates clear entries without prompting in dry-run mode", async () => {
    const stateJson = `${JSON.stringify(
      {
        docker: {
          abc123: {
            hash: "abc123",
            image: "poe-code/local:abc123",
            runtime_type: "docker",
            dockerfile_path: "/repo/.poe-code/Dockerfile",
            built_at: "2026-05-03T10:00:00.000Z"
          }
        }
      },
      null,
      2
    )}\n`;
    const fs = createMemFs({ [statePath]: stateJson });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    try {
      await program.parseAsync(["node", "cli", "--dry-run", "runtime", "templates", "clear"]);
    } finally {
      if (original === undefined) {
        delete (process.stdin as { isTTY?: boolean }).isTTY;
      } else {
        Object.defineProperty(process.stdin, "isTTY", original);
      }
    }

    expect(designSystemMocks.confirmOrCancel).not.toHaveBeenCalled();
    expect(stripAnsi(logs.join("\n"))).toContain("abc123");
    await expect(fs.readFile(statePath, "utf8")).resolves.toBe(stateJson);
  });

  it("snapshots runtime jobs ls output and marks missing running sandboxes as lost", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-running.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-running", env_id: "env-running", status: "running" }),
        null,
        2
      )}\n`,
      [path.join(jobsDir, "job-missing.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-missing", env_id: "env-missing", status: "running" }),
        null,
        2
      )}\n`
    });
    jobHandles.set("env-running", createJobHandle({ status: "running" }));
    jobHandles.set("env-missing", createJobHandle({ status: "lost" }));
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "jobs", "ls"]);

    expect(stripAnsi(logs.join("\n"))).toMatchSnapshot();
    await expect(fs.readFile(path.join(jobsDir, "job-missing.json"), "utf8")).resolves.toContain(
      '"status": "lost"'
    );
  });

  it("caps runtime jobs list at --limit, keeping the newest jobs", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-stale.json")]: `${JSON.stringify(
        createJobEntry({
          id: "job-stale",
          env_id: "env-stale",
          status: "exited",
          started_at: "2026-05-03T12:00:00.000Z"
        }),
        null,
        2
      )}\n`,
      [path.join(jobsDir, "job-fresh.json")]: `${JSON.stringify(
        createJobEntry({
          id: "job-fresh",
          env_id: "env-fresh",
          status: "exited",
          started_at: "2026-07-14T12:00:00.000Z"
        }),
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "jobs", "list", "--limit", "1"]);

    const output = stripAnsi(logs.join("\n"));
    expect(output).toContain("job-fresh");
    expect(output).not.toContain("job-stale");
    expect(output).toContain("--all");
  });

  it("filters runtime jobs list by --since and restores every job with --all", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-stale.json")]: `${JSON.stringify(
        createJobEntry({
          id: "job-stale",
          env_id: "env-stale",
          status: "exited",
          started_at: "2026-05-03T12:00:00.000Z"
        }),
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "jobs", "list", "--since", "7d"]);
    expect(stripAnsi(logs.join("\n"))).not.toContain("job-stale");

    logs.length = 0;
    await program.parseAsync(["node", "cli", "runtime", "jobs", "ls", "--all"]);
    expect(stripAnsi(logs.join("\n"))).toContain("job-stale");
  });

  it("keeps a running job when status inspection cannot reach its sandbox", async () => {
    const jobPath = path.join(jobsDir, "job-unreachable.json");
    const fs = createMemFs({
      [jobPath]: `${JSON.stringify(
        createJobEntry({ id: "job-unreachable", env_id: "env-unreachable", status: "running" }),
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "jobs", "ls"]);

    expect(stripAnsi(logs.join("\n"))).toContain("running");
    await expect(fs.readFile(jobPath, "utf8")).resolves.toContain('"status": "running"');
  });

  it("previews runtime jobs ls without reconciling live sandbox status", async () => {
    const jobPath = path.join(jobsDir, "job-missing.json");
    const fs = createMemFs({
      [jobPath]: `${JSON.stringify(
        createJobEntry({ id: "job-missing", env_id: "env-missing", status: "running" }),
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "runtime", "jobs", "ls"]);

    expect(runtimeEvents.attached).toEqual([]);
    expect(logs.join("\n")).toContain("Dry run");
    await expect(fs.readFile(jobPath, "utf8")).resolves.toContain('"status": "running"');
  });

  it("snapshots runtime jobs show output for an explicitly selected job", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-exited.json")]: `${JSON.stringify(
        {
          ...createJobEntry({ id: "job-exited", env_id: "env-exited", status: "exited" }),
          exit_code: 0,
          exited_at: "2026-05-03T12:34:56.000Z",
          log_file: "/logs/job-exited.log"
        },
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "jobs", "show", "job-exited"]);

    expect(stripAnsi(logs.join("\n"))).toMatchSnapshot();
  });

  it("shows the newest job detail without acting on its sandbox when the job id is omitted", async () => {
    const jobPath = path.join(jobsDir, "job-newest.json");
    const fs = createMemFs({
      [path.join(jobsDir, "job-older.json")]: `${JSON.stringify(
        createJobEntry({
          id: "job-older",
          env_id: "env-older",
          status: "running",
          started_at: "2026-05-01T12:00:00.000Z"
        }),
        null,
        2
      )}\n`,
      [jobPath]: `${JSON.stringify(
        createJobEntry({
          id: "job-newest",
          env_id: "env-newest",
          status: "running",
          started_at: "2026-05-09T12:00:00.000Z"
        }),
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "jobs", "show"]);

    const output = stripAnsi(logs.join("\n"));
    expect(output).toContain("job-newest");
    expect(output).not.toContain("job-older");
    expect(runtimeEvents.attached).toEqual([]);
    await expect(fs.readFile(jobPath, "utf8")).resolves.toContain('"status": "running"');
  });

  it("snapshots runtime jobs logs output", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-logs.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-logs", env_id: "env-logs", status: "exited" }),
        null,
        2
      )}\n`
    });
    jobHandles.set(
      "env-logs",
      createJobHandle({
        status: "exited",
        chunks: ["first line\n", "second line\n"]
      })
    );
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "jobs", "logs"]);

    expect(stripAnsi(logs.join("\n"))).toMatchSnapshot();
  });

  it("preserves split lines and blank lines when dumping runtime job logs", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-logs.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-logs", env_id: "env-logs", status: "exited" }),
        null,
        2
      )}\n`
    });
    jobHandles.set(
      "env-logs",
      createJobHandle({
        status: "exited",
        chunks: ["part", "ial\n", "\n", "tail"]
      })
    );
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "jobs", "logs", "job-logs"]);

    expect(logs).toEqual(["partial", "", "tail"]);
    expect(stripAnsi(logs.join("\n"))).toBe("partial\n\ntail");
  });

  it.each([
    { command: "logs", failure: "reader" },
    { command: "logs", failure: "cleanup" },
    { command: "attach", failure: "reader" },
    { command: "attach", failure: "cleanup" },
    { command: "attach", failure: "status" }
  ] as const)(
    "preserves partial diagnostics when $command fails during $failure",
    async ({ command, failure }) => {
      vi.useFakeTimers();
      const jobPath = path.join(jobsDir, "job-error.json");
      const jobData = JSON.stringify(
        createJobEntry({ id: "job-error", env_id: "env-error", status: "running" })
      );
      const fs = createMemFs({ [jobPath]: jobData });
      const logs: string[] = [];
      const error = new Error(`${failure} failed`);
      const settled = vi.fn();
      const kill = vi.fn();
      const status = vi.fn<JobHandle["status"]>().mockRejectedValue(error);
      let release = () => {};
      jobHandles.set("env-error", {
        ...createJobHandle({ status: "running", kill }),
        status,
        stream(options) {
          const iterator = (async function* () {
            yield { byteOffset: 0, data: "complete line\npartial dia" };
            yield { byteOffset: 25, data: "gnostic" };
            if (failure === "reader") {
              throw error;
            }
            if (failure === "status") {
              await new Promise<void>((resolve, reject) => {
                release = resolve;
                options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
                  once: true
                });
              });
            }
          })();
          if (failure === "cleanup") {
            vi.spyOn(iterator, "return").mockRejectedValue(error);
          }
          return iterator;
        }
      });
      const program = createBaseProgram();
      registerRuntimeCommand(program, createContainer(fs, logs));
      const listeners = process.listenerCount("SIGINT");
      const parsing = program
        .parseAsync([
          "node",
          "cli",
          "runtime",
          "jobs",
          command,
          "job-error",
          ...(command === "attach" ? ["--sync-on-exit"] : [])
        ])
        .then(
          () => settled("done"),
          (reason: unknown) => settled(reason)
        );
      try {
        await vi.advanceTimersByTimeAsync(250);

        expect(settled).toHaveBeenCalledTimes(1);
        expect(settled.mock.calls[0]?.[0]).toBe(error);
        expect(status).toHaveBeenCalledTimes(failure === "status" ? 1 : 0);
        expect(kill).not.toHaveBeenCalled();
        expect(runtimeEvents.downloads).toEqual([]);
        expect(runtimeEvents.closed).toEqual([]);
        expect(process.listenerCount("SIGINT")).toBe(listeners);
        expect(vi.getTimerCount()).toBe(0);
        await expect(fs.readFile(jobPath, "utf8")).resolves.toBe(jobData);
        expect(logs).toEqual(["complete line", "partial diagnostic"]);
      } finally {
        release();
        await vi.advanceTimersByTimeAsync(1000);
        await parsing;
        vi.useRealTimers();
      }
    }
  );

  it("requests full replay when dumping runtime job logs without since", async () => {
    const streamOptions: Array<Parameters<JobHandle["stream"]>[0]> = [];
    const fs = createMemFs({
      [path.join(jobsDir, "job-logs.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-logs", env_id: "env-logs", status: "exited" }),
        null,
        2
      )}\n`
    });
    jobHandles.set(
      "env-logs",
      createJobHandle({
        status: "exited",
        stream(options) {
          streamOptions.push(options);
          return createChunkStream(["full replay\n"]);
        }
      })
    );
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "jobs", "logs", "job-logs"]);

    expect(streamOptions).toEqual([{ sinceByte: 0, follow: false, signal: expect.any(AbortSignal) }]);
    expect(stripAnsi(logs.join("\n"))).toContain("full replay");
  });

  it("omits the byte cursor when dumping runtime job logs with since", async () => {
    const streamOptions: Array<Parameters<JobHandle["stream"]>[0]> = [];
    const fs = createMemFs({
      [path.join(jobsDir, "job-logs.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-logs", env_id: "env-logs", status: "exited" }),
        null,
        2
      )}\n`
    });
    jobHandles.set(
      "env-logs",
      createJobHandle({
        status: "exited",
        stream(options) {
          streamOptions.push(options);
          return createChunkStream(["recent replay\n"]);
        }
      })
    );
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "runtime",
      "jobs",
      "logs",
      "job-logs",
      "--since",
      "5m"
    ]);

    expect(streamOptions).toHaveLength(1);
    expect(streamOptions[0]).toMatchObject({ follow: false, since: expect.any(Date) });
    expect(streamOptions[0]).not.toHaveProperty("sinceByte");
    expect(stripAnsi(logs.join("\n"))).toContain("recent replay");
  });

  it("omits the byte cursor when attaching to runtime job logs with since", async () => {
    const streamOptions: Array<Parameters<JobHandle["stream"]>[0]> = [];
    const fs = createMemFs({
      [path.join(jobsDir, "job-attach.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-attach", env_id: "env-attach", status: "running" }),
        null,
        2
      )}\n`
    });
    jobHandles.set(
      "env-attach",
      createJobHandle({
        status: "running",
        stream(options) {
          streamOptions.push(options);
          return createChunkStream(["recent attach\n"]);
        }
      })
    );
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "runtime",
      "jobs",
      "attach",
      "job-attach",
      "--since",
      "5m"
    ]);

    expect(streamOptions).toHaveLength(1);
    expect(streamOptions[0]).toMatchObject({ follow: true, since: expect.any(Date) });
    expect(streamOptions[0]).not.toHaveProperty("sinceByte");
    expect(stripAnsi(logs.join("\n"))).toContain("recent attach");
  });

  it.each([false, true])(
    "detaches a blocked attach without stopping or syncing the job (syncOnExit: %s)",
    async (syncOnExit) => {
      vi.useFakeTimers();
      const fs = createMemFs({
        [path.join(jobsDir, "job-attach.json")]: JSON.stringify(
          createJobEntry({ id: "job-attach", env_id: "env-attach", status: "running" })
        )
      });
      const logs: string[] = [];
      const closed = vi.fn();
      const settled = vi.fn();
      const status = vi.fn<JobHandle["status"]>().mockResolvedValue("exited");
      const kill = vi.fn();
      let release = () => {};
      jobHandles.set("env-attach", {
        ...createJobHandle({ status: "running", kill }),
        status,
        async *stream(options) {
          try {
            yield { byteOffset: 0, data: "partial" };
            await new Promise<void>((resolve, reject) => {
              release = resolve;
              options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
                once: true
              });
            });
          } finally {
            closed();
          }
        }
      });
      const program = createBaseProgram();
      registerRuntimeCommand(program, createContainer(fs, logs));
      const listeners = process.listenerCount("SIGINT");
      const parsing = program
        .parseAsync([
          "node",
          "cli",
          "runtime",
          "jobs",
          "attach",
          "job-attach",
          ...(syncOnExit ? ["--sync-on-exit"] : [])
        ])
        .then(
          () => settled("done"),
          (error: unknown) => settled(error)
        );
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(process.listenerCount("SIGINT")).toBe(listeners + 1);
        process.emit("SIGINT");
        await vi.advanceTimersByTimeAsync(0);

        expect(settled).toHaveBeenCalledExactlyOnceWith("done");
        expect(closed).toHaveBeenCalledTimes(1);
        expect(logs).toEqual(["partial", "detaching (job continues running)"]);
        expect(status).not.toHaveBeenCalled();
        expect(kill).not.toHaveBeenCalled();
        expect(runtimeEvents.downloads).toEqual([]);
        expect(runtimeEvents.closed).toEqual([]);
        expect(process.listenerCount("SIGINT")).toBe(listeners);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        release();
        await vi.advanceTimersByTimeAsync(1000);
        await parsing;
        vi.useRealTimers();
      }
    }
  );

  it("still syncs on natural attach completion", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-attach.json")]: JSON.stringify(
        createJobEntry({ id: "job-attach", env_id: "env-attach", status: "running" })
      )
    });
    jobHandles.set("env-attach", createJobHandle({ status: "exited", chunks: ["done\n"] }));
    const program = createBaseProgram();
    registerRuntimeCommand(program, createContainer(fs));
    await program.parseAsync([
      "node",
      "cli",
      "runtime",
      "jobs",
      "attach",
      "job-attach",
      "--sync-on-exit"
    ]);
    expect(runtimeEvents.downloads).toEqual([{ envId: "env-attach", conflictPolicy: "refuse" }]);
    expect(runtimeEvents.closed).toEqual([]);
  });

  it("preserves split lines and blank lines when attaching to runtime job logs", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-attach.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-attach", env_id: "env-attach", status: "running" }),
        null,
        2
      )}\n`
    });
    jobHandles.set(
      "env-attach",
      createJobHandle({
        status: "running",
        chunks: ["att", "ach\n", "\n", "done"]
      })
    );
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "jobs", "attach", "job-attach"]);

    expect(logs).toEqual(["attach", "", "done"]);
    expect(stripAnsi(logs.join("\n"))).toBe("attach\n\ndone");
  });

  it("waits for delayed log chunks from an exited runtime job", async () => {
    let markStreamStarted: () => void = () => {};
    const streamStarted = new Promise<void>((resolve) => {
      markStreamStarted = resolve;
    });
    let releaseLogChunk: () => void = () => {};
    const logChunkReady = new Promise<void>((resolve) => {
      releaseLogChunk = resolve;
    });
    const fs = createMemFs({
      [path.join(jobsDir, "job-logs.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-logs", env_id: "env-logs", status: "exited" }),
        null,
        2
      )}\n`
    });
    jobHandles.set("env-logs", {
      ...createJobHandle({ status: "exited" }),
      async *stream() {
        markStreamStarted();
        await logChunkReady;
        yield { byteOffset: 0, data: "late line\n" };
      }
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    const run = program.parseAsync(["node", "cli", "runtime", "jobs", "logs", "job-logs"]);
    await streamStarted;
    expect(stripAnsi(logs.join("\n"))).not.toContain("late line");
    releaseLogChunk();
    await run;

    expect(stripAnsi(logs.join("\n"))).toContain("late line");
  });

  it("previews runtime job logs without attaching to the sandbox", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-logs.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-logs", env_id: "env-logs", status: "exited" }),
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "runtime", "jobs", "logs", "job-logs"]);

    expect(runtimeEvents.attached).toEqual([]);
    expect(logs.join("\n")).toContain("Dry run");
  });

  it("rejects invalid since values before previewing runtime job logs", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-logs.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-logs", env_id: "env-logs", status: "exited" }),
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "--dry-run",
        "runtime",
        "jobs",
        "logs",
        "job-logs",
        "--since",
        "nope"
      ])
    ).rejects.toThrow('Invalid duration "nope".');

    expect(runtimeEvents.attached).toEqual([]);
    expect(logs.join("\n")).not.toContain("Dry run");
  });

  it("errors with candidate jobs when the omitted job id stays ambiguous", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-one.json")]: `${JSON.stringify(
        createJobEntry({
          id: "job-one",
          env_id: "env-one",
          status: "running",
          started_at: "2026-05-03T12:00:00.000Z"
        }),
        null,
        2
      )}\n`,
      [path.join(jobsDir, "job-two.json")]: `${JSON.stringify(
        createJobEntry({
          id: "job-two",
          env_id: "env-two",
          status: "running",
          started_at: "2026-05-03T12:00:00.000Z"
        }),
        null,
        2
      )}\n`
    });
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "runtime", "jobs", "logs"])).rejects.toThrow(
      [
        "More than one detached runtime job matches this command. Pass a job id.",
        "- job-one codex running 2026-05-03T12:00:00.000Z",
        "- job-two codex running 2026-05-03T12:00:00.000Z"
      ].join("\n")
    );
  });

  it("rejects attaching to an explicitly selected exited job", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-exited.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-exited", env_id: "env-exited", status: "exited" }),
        null,
        2
      )}\n`
    });
    jobHandles.set("env-exited", createJobHandle({ status: "exited" }));
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "runtime", "jobs", "attach", "job-exited"])
    ).rejects.toThrow('Runtime job "job-exited" is not available for this command.');

    expect(runtimeEvents.attached).toEqual([]);
  });

  it("previews attaching and sync-on-exit without attaching to the sandbox", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-attach.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-attach", env_id: "env-attach", status: "running" }),
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "runtime",
      "jobs",
      "attach",
      "job-attach",
      "--sync-on-exit",
      "--force-sync"
    ]);

    expect(runtimeEvents.attached).toEqual([]);
    expect(runtimeEvents.downloads).toEqual([]);
    expect(logs.join("\n")).toContain("Dry run");
  });

  it("rejects invalid since values before previewing runtime job attach", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-attach.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-attach", env_id: "env-attach", status: "running" }),
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "--dry-run",
        "runtime",
        "jobs",
        "attach",
        "job-attach",
        "--since",
        "nope"
      ])
    ).rejects.toThrow('Invalid duration "nope".');

    expect(runtimeEvents.attached).toEqual([]);
    expect(logs.join("\n")).not.toContain("Dry run");
  });

  it("syncs with overwrite policy and closes the sandbox when requested", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-sync.json")]: `${JSON.stringify(
        createJobEntry({
          id: "job-sync",
          env_id: "env-sync",
          status: "exited",
          reattach_context: { engine: "podman", context: null }
        }),
        null,
        2
      )}\n`
    });
    jobHandles.set("env-sync", createJobHandle({ status: "exited" }));
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "runtime",
      "jobs",
      "sync",
      "job-sync",
      "--force-sync",
      "--close"
    ]);

    expect(runtimeEvents.downloads).toEqual([
      { envId: "env-sync", conflictPolicy: "overwrite" }
    ]);
    expect(runtimeEvents.attached).toEqual([
      {
        envId: "env-sync",
        context: expect.objectContaining({ reattachContext: { engine: "podman", context: null } })
      }
    ]);
    expect(runtimeEvents.closed).toEqual(["env-sync"]);
    await expect(fs.readFile(path.join(jobsDir, "job-sync.json"), "utf8")).rejects.toThrow();
  });

  it("rejects refused local conflicts instead of reporting sync success", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-sync.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-sync", env_id: "env-sync", status: "exited" }),
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    runtimeEvents.downloadConflicts.set("env-sync", [
      { path: "src/index.ts", reason: "local_modified" }
    ]);
    jobHandles.set("env-sync", createJobHandle({ status: "exited" }));
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "runtime", "jobs", "sync", "job-sync"])
    ).rejects.toThrow("src/index.ts");

    expect(stripAnsi(logs.join("\n"))).not.toContain("Synced runtime job");
  });

  it("previews syncing a runtime job without downloading its workspace", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-sync.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-sync", env_id: "env-sync", status: "exited" }),
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "runtime",
      "jobs",
      "sync",
      "job-sync",
      "--force-sync",
      "--close"
    ]);

    expect(runtimeEvents.attached).toEqual([]);
    expect(runtimeEvents.downloads).toEqual([]);
    expect(runtimeEvents.closed).toEqual([]);
    expect(logs.join("\n")).toContain("Dry run");
  });

  it("rejects syncing an explicitly selected pending job before attachment", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-pending.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-pending", env_id: "", status: "pending" }),
        null,
        2
      )}\n`
    });
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "runtime", "jobs", "sync", "job-pending", "--force-sync"])
    ).rejects.toThrow('Runtime job "job-pending" is not available for this command.');

    expect(runtimeEvents.attached).toEqual([]);
    expect(runtimeEvents.downloads).toEqual([]);
  });

  it("stops a job, marks it killed, and syncs through the shared primitive", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-stop.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-stop", env_id: "env-stop", status: "running" }),
        null,
        2
      )}\n`
    });
    const signals: Array<NodeJS.Signals | undefined> = [];
    jobHandles.set(
      "env-stop",
      createJobHandle({
        status: "running",
        kill: async (signal) => {
          signals.push(signal);
        }
      })
    );
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "runtime",
      "jobs",
      "stop",
      "job-stop",
      "--sync",
      "--force-sync"
    ]);

    expect(signals).toEqual(["SIGTERM"]);
    await expect(fs.readFile(path.join(jobsDir, "job-stop.json"), "utf8")).resolves.toContain(
      '"status": "killed"'
    );
    await expect(fs.readFile(path.join(jobsDir, "job-stop.json"), "utf8")).resolves.toContain(
      '"exit_code": 130'
    );
    expect(runtimeEvents.downloads).toEqual([
      { envId: "env-stop", conflictPolicy: "overwrite" }
    ]);
  });

  it("escalates stopping a job when SIGTERM delivery stalls", async () => {
    vi.useFakeTimers();
    try {
      const fs = createMemFs({
        [path.join(jobsDir, "job-stop.json")]: `${JSON.stringify(
          createJobEntry({ id: "job-stop", env_id: "env-stop", status: "running" }),
          null,
          2
        )}\n`
      });
      const signals: Array<NodeJS.Signals | undefined> = [];
      let resolveStopped!: (value: { exitCode: number }) => void;
      const stopped = new Promise<{ exitCode: number }>((resolve) => {
        resolveStopped = resolve;
      });
      jobHandles.set(
        "env-stop",
        createJobHandle({
          status: "running",
          wait: async () => await stopped,
          kill: async (signal) => {
            signals.push(signal);
            if (signal === "SIGTERM") {
              return await new Promise<void>(() => {
                // Simulate a runtime API that never confirms graceful signal delivery.
              });
            }
            resolveStopped({ exitCode: 137 });
          }
        })
      );
      const container = createContainer(fs);
      const program = createBaseProgram();
      registerRuntimeCommand(program, container);

      const stop = program.parseAsync(["node", "cli", "runtime", "jobs", "stop", "job-stop"]);

      await vi.waitFor(() => expect(signals).toEqual(["SIGTERM"]));
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() => expect(signals).toEqual(["SIGTERM", "SIGKILL"]));
      await stop;

      await expect(fs.readFile(path.join(jobsDir, "job-stop.json"), "utf8")).resolves.toContain(
        '"status": "killed"'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("previews stopping a runtime job without killing or rewriting it", async () => {
    const jobPath = path.join(jobsDir, "job-stop.json");
    const fs = createMemFs({
      [jobPath]: `${JSON.stringify(
        createJobEntry({ id: "job-stop", env_id: "env-stop", status: "running" }),
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "runtime",
      "jobs",
      "stop",
      "job-stop",
      "--force-sync"
    ]);

    expect(runtimeEvents.attached).toEqual([]);
    expect(runtimeEvents.downloads).toEqual([]);
    expect(logs.join("\n")).toContain("Dry run");
    expect(logs.join("\n")).toContain("would stop runtime job job-stop.");
    expect(logs.join("\n")).not.toContain("sync its workspace");
    await expect(fs.readFile(jobPath, "utf8")).resolves.toContain('"status": "running"');
  });

  it("previews opening a runtime sandbox shell without attaching", async () => {
    const logs: string[] = [];
    const container = createContainer(createMemFs(), logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "runtime",
      "jobs",
      "sandbox",
      "env-sandbox"
    ]);

    expect(runtimeEvents.attached).toEqual([]);
    expect(logs.join("\n")).toContain("Dry run");
  });

  it("rejects unknown runtime backends before previewing a sandbox shell", async () => {
    const logs: string[] = [];
    const container = createContainer(createMemFs(), logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "--dry-run",
        "runtime",
        "jobs",
        "sandbox",
        "env-sandbox",
        "--runtime",
        "nope"
      ])
    ).rejects.toThrow('No execution environment factory registered for runtime type "nope".');

    expect(runtimeEvents.attached).toEqual([]);
    expect(logs.join("\n")).not.toContain("Dry run");
  });

  it("opens a runtime sandbox shell in its saved job working directory", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-sandbox.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-sandbox", env_id: "env-sandbox", status: "running" }),
        null,
        2
      )}\n`
    });
    jobHandles.set("env-sandbox", createJobHandle({ status: "running" }));
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "jobs", "sandbox", "env-sandbox"]);

    expect(runtimeEvents.attached).toEqual([
      { envId: "env-sandbox", context: expect.objectContaining({ cwd }) }
    ]);
  });

  it.each([false, true])("leaves no grace timer after public job stop (dryRun: %s)", async (dryRun) => {
    vi.useFakeTimers();
    try {
      const jobPath = path.join(jobsDir, "job-stop.json");
      const initialJob = `${JSON.stringify(
        createJobEntry({ id: "job-stop", env_id: "env-stop", status: "running" }), null, 2
      )}\n`;
      const fs = createMemFs({ [jobPath]: initialJob });
      const kill = vi.fn().mockResolvedValue(undefined);
      jobHandles.set("env-stop", createJobHandle({ status: "running", kill }));
      const logs: string[] = [];
      const program = createBaseProgram();
      registerRuntimeCommand(program, createContainer(fs, logs));

      await program.parseAsync([
        "node", "cli", ...(dryRun ? ["--dry-run"] : []),
        "runtime", "jobs", "stop", "job-stop"
      ]);

      if (dryRun) {
        expect(runtimeEvents.attached).toEqual([]);
        expect(kill).not.toHaveBeenCalled();
        await expect(fs.readFile(jobPath, "utf8")).resolves.toBe(initialJob);
        expect(logs.join("\n")).toContain("Dry run: would stop runtime job job-stop.");
        expect(logs.join("\n")).not.toContain("Stopped runtime job");
      } else {
        expect(runtimeEvents.attached).toHaveLength(1);
        expect(kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
        expect(JSON.parse(await fs.readFile(jobPath, "utf8"))).toMatchObject({
          status: "killed", exit_code: 130
        });
        expect(logs.join("\n")).toContain("Stopped runtime job job-stop.");
      }
      expect(runtimeEvents.downloads).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a job without syncing by default", async () => {
    const fs = createMemFs({
      [path.join(jobsDir, "job-stop.json")]: `${JSON.stringify(
        createJobEntry({ id: "job-stop", env_id: "env-stop", status: "running" }),
        null,
        2
      )}\n`
    });
    const signals: Array<NodeJS.Signals | undefined> = [];
    jobHandles.set(
      "env-stop",
      createJobHandle({
        status: "running",
        kill: async (signal) => {
          signals.push(signal);
        }
      })
    );
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "jobs", "stop", "job-stop"]);

    expect(signals).toEqual(["SIGTERM"]);
    expect(runtimeEvents.downloads).toEqual([]);
    await expect(fs.readFile(path.join(jobsDir, "job-stop.json"), "utf8")).resolves.toContain(
      '"status": "killed"'
    );
  });

  it("rejects stopping an explicitly selected exited job without replacing its result", async () => {
    const jobPath = path.join(jobsDir, "job-exited.json");
    const fs = createMemFs({
      [jobPath]: `${JSON.stringify(
        { ...createJobEntry({ id: "job-exited", env_id: "env-exited", status: "exited" }), exit_code: 7 },
        null,
        2
      )}\n`
    });
    jobHandles.set("env-exited", createJobHandle({ status: "exited" }));
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "runtime", "jobs", "stop", "job-exited"])
    ).rejects.toThrow('Runtime job "job-exited" is not available for this command.');

    expect(runtimeEvents.attached).toEqual([]);
    await expect(fs.readFile(jobPath, "utf8")).resolves.toContain('"exit_code": 7');
  });

  it("rejects stopping an explicitly selected pending job without updating state", async () => {
    const jobPath = path.join(jobsDir, "job-pending.json");
    const fs = createMemFs({
      [jobPath]: `${JSON.stringify(
        createJobEntry({ id: "job-pending", env_id: "", status: "pending" }),
        null,
        2
      )}\n`
    });
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "runtime", "jobs", "stop", "job-pending"])
    ).rejects.toThrow('Runtime job "job-pending" is not available for this command.');

    expect(runtimeEvents.attached).toEqual([]);
    await expect(fs.readFile(jobPath, "utf8")).resolves.toContain('"status": "pending"');
  });

  it("builds docker runtime templates through the exposed helper", async () => {
    const fs = createMemFs({
      [projectConfigPath]: `${JSON.stringify({ runtime: { type: "docker" } }, null, 2)}\n`,
      [dockerfilePath]: "FROM custom\n"
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "build", "--force"]);

    expect(buildDockerRuntimeTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd,
        runtime: expect.objectContaining({ type: "docker" }),
        force: true,
        state: expect.any(Object)
      })
    );
    expect(stripAnsi(logs.join("\n"))).toContain("Built Docker image poe-code/local:mock-hash");
  });

  it("rejects missing dockerfiles before previewing docker runtime builds", async () => {
    const fs = createMemFs({
      [projectConfigPath]: `${JSON.stringify({ runtime: { type: "docker" } }, null, 2)}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "runtime", "build"])
    ).rejects.toThrow("Docker runtime requires a Dockerfile at /repo/.poe-code/Dockerfile.");

    expect(buildDockerRuntimeTemplateMock).not.toHaveBeenCalled();
    expect(stripAnsi(logs.join("\n"))).not.toContain("would build docker runtime template");
  });

  it("rejects docker runtime builds with build contexts outside the project", async () => {
    const fs = createMemFs({
      [projectConfigPath]: `${JSON.stringify(
        { runtime: { type: "docker", dockerfile: "Dockerfile", build_context: ".." } },
        null,
        2
      )}\n`,
      [path.join(cwd, "Dockerfile")]: "FROM custom\n"
    });
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "runtime", "build"])).rejects.toThrow(
      "runtime.build_context must remain inside runtime cwd /repo."
    );
    expect(buildDockerRuntimeTemplateMock).not.toHaveBeenCalled();
  });

  it("does not build when a docker image is pinned in config", async () => {
    const fs = createMemFs({
      [projectConfigPath]: `${JSON.stringify(
        { runtime: { type: "docker", image: "ghcr.io/example/poe-runtime:1" } },
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "build"]);

    expect(buildDockerRuntimeTemplateMock).not.toHaveBeenCalled();
    expect(stripAnsi(logs.join("\n"))).toContain(
      "Docker runtime uses pinned image ghcr.io/example/poe-runtime:1."
    );
  });

  it("does not recover malformed project config while previewing a runtime build", async () => {
    const malformedConfig = "{ invalid json\n";
    const fs = createMemFs({ [projectConfigPath]: malformedConfig });
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "runtime", "build", "--runtime", "docker"])
    ).rejects.toThrow();

    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toBe(malformedConfig);
    await expect(fs.readdir(path.dirname(projectConfigPath))).resolves.toEqual(["config.json"]);
  });
});
