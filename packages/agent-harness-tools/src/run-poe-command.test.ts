import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import {
  createStateManager,
  type RuntimeConfig,
  type StateFileSystem,
  type StateManager
} from "@poe-code/poe-code-config/core";
import {
  hostExecutionEnvFactory,
  type RunHandle,
  type RunResult,
  type RunSpec
} from "@poe-code/process-runner";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type {
  DownloadResult,
  ExecutionEnvFactory,
  OpenedEnv,
  OpenSpec,
  UploadResult
} from "./execution-env.js";
import { hasOwnErrorCode } from "./error-codes.js";
import type { LogStreamFs } from "./log-stream.js";
import { createPoeCommandSession, runPoeCommand } from "./run-poe-command.js";

interface RecordingState {
  state: StateManager;
  statuses: string[];
}

interface MockEnv extends OpenedEnv {
  closed: boolean;
  detached: boolean;
  detachedJobContext: { id: string; tool: string; argv: string[] } | null;
  downloads: { conflictPolicy: "refuse" | "overwrite" }[];
  execSpecs: RunSpec[];
  fs: LogStreamFs;
  setDetachedJobContext(context: { id: string; tool: string; argv: string[] }): void;
  uploads: number;
  reattachContext?: Record<string, unknown>;
}

function createRecordingState(): RecordingState {
  const fs = createFsFromVolume(new Volume()).promises as unknown as StateFileSystem;
  const state = createStateManager("/home/tester", fs);
  const jobs = state.jobs;
  const statuses: string[] = [];

  return {
    statuses,
    state: {
      ...state,
      jobs: {
        ...jobs,
        async put(entry) {
          statuses.push(entry.status);
          await jobs.put(entry);
        },
        async update(id, patch) {
          if (patch.status !== undefined) {
            statuses.push(patch.status);
          }
          return jobs.update(id, patch);
        }
      }
    }
  };
}

function createOpenSpec(overrides: Partial<OpenSpec> = {}): OpenSpec {
  return {
    cwd: "/repo",
    runtime: {
      type: "host",
      build_args: {},
      mounts: []
    } satisfies RuntimeConfig,
    runner: {
      detach: false,
      upload_max_file_mb: 100,
      download_conflict: "refuse"
    },
    env: { NODE_ENV: "test" },
    uploadIgnoreFiles: [],
    jobLabel: { tool: "poe-code", argv: ["poe-code", "--help"] },
    ...overrides
  };
}

function createMockEnv(
  opts: {
    result?: Promise<RunResult>;
    commandExitCode?: number;
    download?: DownloadResult;
  } = {}
): MockEnv {
  const result = opts.result ?? Promise.resolve({ exitCode: 0 });
  const commandExitCode = opts.commandExitCode ?? 0;
  const download = opts.download ?? { files: 0, bytes: 0, conflicts: [] };
  const rawFs = createFsFromVolume(new Volume());
  const env: MockEnv = {
    id: "env-1",
    job: null,
    closed: false,
    detached: false,
    detachedJobContext: null,
    downloads: [],
    execSpecs: [],
    fs: rawFs as unknown as LogStreamFs,
    uploads: 0,
    async uploadWorkspace(): Promise<UploadResult> {
      env.uploads += 1;
      return { files: 1, bytes: 12, skipped: [] };
    },
    async downloadWorkspace(call): Promise<DownloadResult> {
      env.downloads.push(call);
      return download;
    },
    exec(spec): RunHandle {
      env.execSpecs.push(spec);
      if (spec.command === "sh" && spec.args?.[0] === "-c") {
        void writeExitFile(rawFs.promises, spec, commandExitCode);
      }
      return {
        pid: 123,
        stdout: null,
        stderr: null,
        stdin: null,
        result,
        kill() {}
      };
    },
    async detach() {
      env.detached = true;
      return {
        id: env.detachedJobContext?.id ?? "job",
        envId: env.id,
        tool: env.detachedJobContext?.tool ?? "poe-code",
        argv: env.detachedJobContext?.argv ?? [],
        async status() {
          return "running" as const;
        },
        async *stream() {},
        async wait() {
          return { exitCode: 0 };
        },
        async kill() {}
      };
    },
    setDetachedJobContext(context) {
      env.detachedJobContext = context;
    },
    shell(): RunHandle {
      throw new Error("shell is not used by runPoeCommand");
    },
    async close(): Promise<void> {
      env.closed = true;
    }
  };
  return env;
}

async function writeExitFile(
  fs: {
    mkdir(path: string, opts: { recursive: boolean }): Promise<unknown>;
    writeFile(path: string, data: string, encoding: BufferEncoding): Promise<unknown>;
  },
  spec: RunSpec,
  exitCode: number
): Promise<void> {
  const jobId = extractJobId(spec);
  await fs.mkdir("/tmp/poe-jobs", { recursive: true });
  await fs.writeFile(`/tmp/poe-jobs/${jobId}.exit`, `${exitCode}\n`, "utf8");
}

function extractJobId(spec: RunSpec): string {
  const script = spec.args?.[1] ?? "";
  const prefix = "/tmp/poe-jobs/";
  const suffix = ".exit.tmp";
  const end = script.indexOf(suffix);
  const start = script.lastIndexOf(prefix, end);
  if (start === -1 || end === -1) {
    throw new Error("Expected wrapped command to include an exit file.");
  }
  return script.slice(start + prefix.length, end);
}

function createFactory(env: OpenedEnv): ExecutionEnvFactory {
  return {
    type: "host",
    async open() {
      return env;
    },
    async attach() {
      return env;
    }
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function processEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  return !isProcessAlive(pid);
}

async function waitForFileText(filePath: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (!hasOwnErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return readFile(filePath, "utf8");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasOwnErrorCode(error, "ESRCH");
  }
}

describe("runPoeCommand", () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid activity timeout %s before opening an environment",
    async (activityTimeoutMs) => {
      const { state } = createRecordingState();
      const open = vi.fn(() => createMockEnv());
      const factory: ExecutionEnvFactory = { type: "host", open };

      await expect(
        runPoeCommand({
          factory,
          openSpec: createOpenSpec({ execution: { wrapForLogTee: false, activityTimeoutMs } }),
          detach: false,
          state
        })
      ).rejects.toThrow("activityTimeoutMs must be a finite positive number");
      expect(open).not.toHaveBeenCalled();
    }
  );

  it("records pending, running, and exited statuses for a sync run", async () => {
    const { state, statuses } = createRecordingState();
    const env = createMockEnv();

    const result = await runPoeCommand({
      factory: createFactory(env),
      openSpec: createOpenSpec(),
      detach: false,
      state
    });

    const [job] = await state.jobs.list();
    expect(result).toEqual({
      kind: "sync",
      exitCode: 0,
      download: { files: 0, bytes: 0, conflicts: [] }
    });
    expect(statuses).toEqual(["pending", "running", "exited"]);
    expect(job).toMatchObject({
      env_id: "env-1",
      env_kind: "host",
      tool: "poe-code",
      argv: ["poe-code", "--help"],
      cwd: "/repo",
      status: "exited",
      exit_code: 0
    });
    expect(env.uploads).toBe(1);
    expect(env.closed).toBe(true);
    expect(env.execSpecs[0]).toMatchObject({
      command: "sh",
      args: ["-c", expect.stringContaining("'poe-code' '--help'")],
      cwd: "/repo",
      env: { NODE_ENV: "test" },
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
      killProcessGroup: true
    });
  });

  it("waits for captured wrapped stdio to drain after the exit marker", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv();

    env.exec = (spec): RunHandle => {
      env.execSpecs.push(spec);
      if (spec.command !== "sh" || spec.args?.[0] !== "-c") {
        throw new Error("Expected wrapped shell command");
      }

      const stdout = new PassThrough();
      const stderr = new PassThrough();
      void writeExitFile(env.fs.promises, spec, 0).then(() => {
        setImmediate(() => {
          stdout.write("late stdout\n");
          stderr.write("late stderr\n");
          stdout.end();
          stderr.end();
        });
      });

      return {
        pid: 123,
        stdout,
        stderr,
        stdin: null,
        result: Promise.resolve({ exitCode: 0 }),
        kill() {}
      };
    };

    await expect(
      runPoeCommand({
        factory: createFactory(env),
        openSpec: createOpenSpec({ execution: { captureOutput: true } }),
        detach: false,
        state
      })
    ).resolves.toMatchObject({
      kind: "sync",
      exitCode: 0,
      stdout: "late stdout\n",
      stderr: "late stderr\n"
    });
  });

  it("persists display argv while executing the original argv", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv();

    await runPoeCommand({
      factory: createFactory(env),
      openSpec: createOpenSpec({
        jobLabel: {
          tool: "claude-code",
          argv: ["claude", "-p", "prompt with sk-secret"],
          displayArgv: ["claude", "-p", "[prompt redacted]"]
        },
        execution: { wrapForLogTee: false }
      }),
      detach: false,
      state
    });

    const [job] = await state.jobs.list();
    expect(job.argv).toEqual(["claude", "-p", "[prompt redacted]"]);
    expect(JSON.stringify(job)).not.toContain("sk-secret");
    expect(env.execSpecs[0]).toMatchObject({
      command: "claude",
      args: ["-p", "prompt with sk-secret"]
    });
  });

  it("records completed status when environment cleanup fails after a sync run", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv();
    env.close = async () => {
      throw new Error("environment close denied");
    };

    await expect(
      runPoeCommand({
        factory: createFactory(env),
        openSpec: createOpenSpec(),
        detach: false,
        state
      })
    ).resolves.toMatchObject({ kind: "sync", exitCode: 0 });

    await expect(state.jobs.list()).resolves.toEqual([
      expect.objectContaining({ status: "exited", exit_code: 0, env_id: "env-1" })
    ]);
  });

  it("removes a pending job when environment opening fails", async () => {
    const { state } = createRecordingState();
    const factory: ExecutionEnvFactory = {
      type: "host",
      async open() {
        throw new Error("open failed");
      }
    };

    await expect(
      runPoeCommand({ factory, openSpec: createOpenSpec(), detach: false, state })
    ).rejects.toThrow("open failed");
    await expect(state.jobs.list()).resolves.toEqual([]);
  });

  it("removes a pending job when initial workspace upload fails", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv();
    env.uploadWorkspace = async () => {
      throw new Error("upload failed");
    };

    await expect(
      runPoeCommand({
        factory: createFactory(env),
        openSpec: createOpenSpec(),
        detach: false,
        state
      })
    ).rejects.toThrow("upload failed");

    await expect(state.jobs.list()).resolves.toEqual([]);
    expect(env.closed).toBe(true);
  });

  it("marks a detached launch lost when detaching fails", async () => {
    const { state, statuses } = createRecordingState();
    const env = createMockEnv({ result: new Promise(() => {}) });
    env.detach = async () => {
      throw new Error("detach failed");
    };

    await expect(
      runPoeCommand({
        factory: createFactory(env),
        openSpec: createOpenSpec(),
        detach: true,
        state
      })
    ).rejects.toThrow("detach failed");

    await expect(state.jobs.list()).resolves.toEqual([
      expect.objectContaining({ status: "lost", env_id: "env-1" })
    ]);
    expect(statuses).toEqual(["pending", "running", "lost"]);
    expect(env.closed).toBe(true);
  });

  it("marks a synchronous launch lost when post-launch download fails", async () => {
    const { state, statuses } = createRecordingState();
    const env = createMockEnv();
    env.downloadWorkspace = async () => {
      throw new Error("download failed");
    };

    await expect(
      runPoeCommand({
        factory: createFactory(env),
        openSpec: createOpenSpec(),
        detach: false,
        state
      })
    ).rejects.toThrow("download failed");

    await expect(state.jobs.list()).resolves.toEqual([
      expect.objectContaining({ status: "lost", env_id: "env-1" })
    ]);
    expect(statuses).toEqual(["pending", "running", "lost"]);
    expect(env.closed).toBe(true);
  });

  it("leaves the environment open in detach mode", async () => {
    const { state, statuses } = createRecordingState();
    const runResult = deferred<RunResult>();
    const env = createMockEnv({ result: runResult.promise });
    env.reattachContext = { engine: "podman", context: null };

    const result = await runPoeCommand({
      factory: createFactory(env),
      openSpec: createOpenSpec(),
      detach: true,
      state
    });

    if (result.kind !== "detached") {
      throw new Error("Expected detached result.");
    }
    expect(result).toMatchObject({ kind: "detached", envId: "env-1" });
    expect(result.jobId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(statuses).toEqual(["pending", "running"]);
    expect(env.closed).toBe(false);
    expect(env.detached).toBe(true);
    expect(env.detachedJobContext).toEqual({
      id: result.jobId,
      tool: "poe-code",
      argv: ["poe-code", "--help"]
    });
    expect(env.downloads).toEqual([]);
    await expect(state.jobs.get(result.jobId)).resolves.toMatchObject({
      reattach_context: { engine: "podman", context: null }
    });
  });

  it("uses display argv in detached job context", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv();
    const result = await runPoeCommand({
      factory: createFactory(env),
      openSpec: createOpenSpec({
        jobLabel: {
          tool: "codex",
          argv: ["codex", "exec", "prompt with bearer-token"],
          displayArgv: ["codex", "exec", "[prompt redacted]"]
        },
        execution: { wrapForLogTee: false }
      }),
      detach: true,
      state
    });

    if (result.kind !== "detached") {
      throw new Error("Expected detached result.");
    }

    expect(env.detachedJobContext).toEqual({
      id: result.jobId,
      tool: "codex",
      argv: ["codex", "exec", "[prompt redacted]"]
    });
    await expect(state.jobs.get(result.jobId)).resolves.toMatchObject({
      argv: ["codex", "exec", "[prompt redacted]"]
    });
    expect(JSON.stringify(env.detachedJobContext)).not.toContain("bearer-token");
    expect(env.execSpecs[0]).toMatchObject({
      command: "codex",
      args: ["exec", "prompt with bearer-token"]
    });
  });

  it("waits for workspace upload before starting the command", async () => {
    const { state } = createRecordingState();
    const upload = deferred<UploadResult>();
    const env = createMockEnv();
    const exec = env.exec.bind(env);
    let uploadResolved = false;
    let execStarted = false;

    env.uploadWorkspace = async () => {
      const result = await upload.promise;
      uploadResolved = true;
      return result;
    };
    env.exec = (spec): RunHandle => {
      execStarted = true;
      expect(uploadResolved).toBe(true);
      return exec(spec);
    };

    const run = runPoeCommand({
      factory: createFactory(env),
      openSpec: createOpenSpec(),
      detach: false,
      state
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(execStarted).toBe(false);

    upload.resolve({ files: 1, bytes: 12, skipped: [] });
    await expect(run).resolves.toMatchObject({ kind: "sync", exitCode: 0 });
    expect(execStarted).toBe(true);
  });

  it("syncs a reused session workspace back after each command while keeping remote state for the next command", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv();
    let localIterations = "";
    let remoteIterations = "";

    env.uploadWorkspace = async () => {
      env.uploads += 1;
      remoteIterations = localIterations;
      return { files: 1, bytes: Buffer.byteLength(localIterations), skipped: [] };
    };
    env.downloadWorkspace = async (call) => {
      env.downloads.push(call);
      localIterations = remoteIterations;
      return { files: 1, bytes: Buffer.byteLength(localIterations), conflicts: [] };
    };
    env.exec = (spec): RunHandle => {
      env.execSpecs.push(spec);
      const nextIteration =
        remoteIterations.trim().length === 0 ? 1 : remoteIterations.trim().split("\n").length + 1;
      remoteIterations += `${nextIteration}\n`;
      return {
        pid: 123,
        stdout: null,
        stderr: null,
        stdin: null,
        result: Promise.resolve({ exitCode: 0 }),
        kill() {}
      };
    };

    const session = createPoeCommandSession({ factory: createFactory(env), state });
    const openSpec = createOpenSpec({
      execution: { wrapForLogTee: false },
      jobLabel: { tool: "append-iteration", argv: ["append-iteration"] },
      runner: {
        detach: false,
        upload_max_file_mb: 100,
        download_conflict: "overwrite"
      }
    });

    await session.run(openSpec);
    expect(localIterations).toBe("1\n");

    await session.run(openSpec);
    expect(localIterations).toBe("1\n2\n");
    expect(remoteIterations).toBe("1\n2\n");
    expect(env.uploads).toBe(1);
    expect(env.downloads).toEqual([
      { conflictPolicy: "overwrite" },
      { conflictPolicy: "overwrite" }
    ]);
    expect(env.execSpecs).toHaveLength(2);

    await session.close();
  });

  it("returns the download result with conflicts from sync mode", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv({
      download: {
        files: 2,
        bytes: 20,
        conflicts: [{ path: "src/index.ts", reason: "local_modified" }]
      }
    });

    const result = await runPoeCommand({
      factory: createFactory(env),
      openSpec: createOpenSpec({
        runner: {
          detach: false,
          upload_max_file_mb: 100,
          download_conflict: "overwrite"
        }
      }),
      detach: false,
      state
    });

    expect(result).toEqual({
      kind: "sync",
      exitCode: 0,
      download: {
        files: 2,
        bytes: 20,
        conflicts: [{ path: "src/index.ts", reason: "local_modified" }]
      }
    });
    expect(env.downloads).toEqual([{ conflictPolicy: "overwrite" }]);
  });

  it("uses the log tee exit file instead of the wrapper process exit code", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv({
      result: Promise.resolve({ exitCode: 0 }),
      commandExitCode: 42
    });

    const result = await runPoeCommand({
      factory: createFactory(env),
      openSpec: createOpenSpec(),
      detach: false,
      state
    });

    const [job] = await state.jobs.list();
    expect(result).toMatchObject({ kind: "sync", exitCode: 42 });
    expect(job).toMatchObject({ status: "exited", exit_code: 42 });
  });

  it("does not fail when command stdin closes before execution input is written", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv();
    const kill = vi.fn();

    env.exec = (spec): RunHandle => {
      env.execSpecs.push(spec);
      const stdin = new PassThrough();
      queueMicrotask(() => {
        stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      });
      return {
        pid: 123,
        stdout: null,
        stderr: null,
        stdin,
        result: Promise.resolve({ exitCode: 0 }),
        kill
      };
    };

    await expect(
      runPoeCommand({
        factory: createFactory(env),
        openSpec: createOpenSpec({
          execution: { input: "hello", stdin: "pipe", wrapForLogTee: false }
        }),
        detach: false,
        state
      })
    ).resolves.toMatchObject({ kind: "sync", exitCode: 0 });
    expect(kill).not.toHaveBeenCalled();
  });

  it("does not treat inherited stdin error codes as closed pipes", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv({ result: new Promise(() => {}) });
    const kill = vi.fn();

    env.exec = (spec): RunHandle => {
      env.execSpecs.push(spec);
      const stdin = new PassThrough();
      queueMicrotask(() => {
        stdin.emit("error", new Error("inherited stdin EPIPE"));
      });
      return {
        pid: 123,
        stdout: null,
        stderr: null,
        stdin,
        result: new Promise(() => {}),
        kill
      };
    };

    await withObjectPrototypeProperties({ code: "EPIPE" }, async () => {
      await expect(
        runPoeCommand({
          factory: createFactory(env),
          openSpec: createOpenSpec({
            execution: { input: "hello", stdin: "pipe", wrapForLogTee: false }
          }),
          detach: false,
          state
        })
      ).rejects.toThrow("inherited stdin EPIPE");
    });
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects when execution input cannot be delivered", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv({ result: new Promise(() => {}) });
    const kill = vi.fn();

    env.exec = (spec): RunHandle => {
      env.execSpecs.push(spec);
      const stdin = new PassThrough();
      queueMicrotask(() => {
        stdin.emit("error", new Error("send stdin offline"));
      });
      return {
        pid: 123,
        stdout: null,
        stderr: null,
        stdin,
        result: new Promise(() => {}),
        kill
      };
    };

    await expect(
      runPoeCommand({
        factory: createFactory(env),
        openSpec: createOpenSpec({
          execution: { input: "hello", stdin: "pipe", wrapForLogTee: false }
        }),
        detach: false,
        state
      })
    ).rejects.toThrow("send stdin offline");
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("requests a killable process group for unwrapped activity timeouts", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv({ result: Promise.resolve({ exitCode: 0 }) });

    await runPoeCommand({
      factory: createFactory(env),
      openSpec: createOpenSpec({
        // Only the presence of activityTimeoutMs drives killProcessGroup; use a
        // value large enough that the real timer cannot fire before the mock run
        // resolves, even under heavy parallel load.
        execution: { activityTimeoutMs: 60_000, wrapForLogTee: false }
      }),
      detach: false,
      state
    });

    expect(env.execSpecs[0]).toMatchObject({ killProcessGroup: true });
  });

  it("rejects a wrapped synchronous run when its abort signal fires", async () => {
    const { state, statuses } = createRecordingState();
    const controller = new AbortController();
    const runResult = deferred<RunResult>();
    let killed = false;
    const env = createMockEnv({ result: runResult.promise });
    env.exec = (spec): RunHandle => {
      env.execSpecs.push(spec);
      queueMicrotask(() => controller.abort());
      return {
        pid: 123,
        stdout: new PassThrough(),
        stderr: null,
        stdin: null,
        result: runResult.promise,
        kill() {
          killed = true;
          runResult.resolve({ exitCode: 130 });
        }
      };
    };

    await expect(
      runPoeCommand({
        factory: createFactory(env),
        openSpec: createOpenSpec(),
        detach: false,
        state,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: "AbortError" });

    const [job] = await state.jobs.list();
    expect(killed).toBe(true);
    expect(env.downloads).toEqual([]);
    expect(env.closed).toBe(true);
    expect(job).toMatchObject({ status: "lost" });
    expect(statuses).toEqual(["pending", "running", "lost"]);
  });

  it("rejects a wrapped synchronous run promptly after inactivity timeout", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv({ result: new Promise(() => {}) });
    let killed = false;
    env.exec = (spec): RunHandle => {
      env.execSpecs.push(spec);
      return {
        pid: 123,
        stdout: new PassThrough(),
        stderr: null,
        stdin: null,
        result: new Promise(() => {}),
        kill() {
          killed = true;
        }
      };
    };

    const result = runPoeCommand({
      factory: createFactory(env),
      openSpec: createOpenSpec({ execution: { activityTimeoutMs: 1 } }),
      detach: false,
      state
    });

    await expect(
      Promise.race([
        result,
        new Promise((_, reject) => setTimeout(() => reject(new Error("run remained pending")), 100))
      ])
    ).rejects.toMatchObject({ name: "ActivityTimeoutError" });
    expect(killed).toBe(true);
    expect(env.closed).toBe(true);
  });

  it("resets the activity timeout when non-captured output is piped", async () => {
    vi.useFakeTimers();
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { state } = createRecordingState();
    const stdout = new PassThrough();
    const runStarted = deferred<void>();
    const env = createMockEnv({ result: new Promise(() => {}) });
    let killed = false;
    env.exec = (spec): RunHandle => {
      env.execSpecs.push(spec);
      runStarted.resolve();
      return {
        pid: 123,
        stdout,
        stderr: null,
        stdin: null,
        result: new Promise(() => {}),
        kill() {
          killed = true;
        }
      };
    };

    try {
      const result = runPoeCommand({
        factory: createFactory(env),
        openSpec: createOpenSpec({
          execution: { wrapForLogTee: false, activityTimeoutMs: 100 }
        }),
        detach: false,
        state
      });
      const rejection = result.catch((error: unknown) => error);

      await runStarted.promise;
      await vi.advanceTimersByTimeAsync(90);
      stdout.write("progress\n");
      await vi.advanceTimersByTimeAsync(99);
      expect(killed).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(rejection).resolves.toMatchObject({ name: "ActivityTimeoutError" });
      expect(killed).toBe(true);
      expect(env.closed).toBe(true);
    } finally {
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
      vi.useRealTimers();
    }
  });

  it.runIf(process.platform !== "win32")(
    "terminates the full wrapped host command process group on inactivity timeout",
    async () => {
      const { state } = createRecordingState();
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "poe-wrapped-timeout-"));
      const pidFile = path.join(tempDir, "inner.pid");
      const stopActivityFile = path.join(tempDir, "stop-activity");
      let innerPid: number | undefined;

      try {
        const run = runPoeCommand({
          factory: hostExecutionEnvFactory as unknown as ExecutionEnvFactory,
          openSpec: createOpenSpec({
            cwd: tempDir,
            env: processEnv(),
            jobLabel: {
              tool: "sh",
              argv: [
                "sh",
                "-c",
                [
                  `trap '' TERM`,
                  `sleep 30 & echo $! > ${shellQuote(pidFile)}`,
                `while [ ! -f ${shellQuote(stopActivityFile)} ]; do echo ready; sleep 0.05; done`,
                  "wait"
                ].join("; ")
              ]
            },
            execution: { activityTimeoutMs: 1_000, captureOutput: true }
          }),
          detach: false,
          state
        });
        const rejection = run.catch((error: unknown) => error);

        const pidText = await Promise.race([
          waitForFileText(pidFile, 10_000),
          rejection.then((error) => {
            throw error;
          })
        ]);
        innerPid = Number(pidText.trim());
        expect(Number.isInteger(innerPid)).toBe(true);
        await writeFile(stopActivityFile, "", "utf8");
        await expect(rejection).resolves.toMatchObject({ name: "ActivityTimeoutError" });
        await expect(waitForProcessExit(innerPid, 2_000)).resolves.toBe(true);
      } finally {
        if (innerPid !== undefined && isProcessAlive(innerPid)) {
          try {
            process.kill(innerPid, "SIGKILL");
          } catch {
            // Best-effort cleanup for a process that may have exited between checks.
          }
        }
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  );

  it("rejects a wrapped synchronous timeout when an abort signal is present", async () => {
    const { state } = createRecordingState();
    const controller = new AbortController();
    const runResult = deferred<RunResult>();
    const env = createMockEnv({ result: runResult.promise });
    env.exec = (spec): RunHandle => {
      env.execSpecs.push(spec);
      return {
        pid: 123,
        stdout: new PassThrough(),
        stderr: null,
        stdin: null,
        result: runResult.promise,
        kill() {
          runResult.resolve({ exitCode: 143 });
        }
      };
    };

    await expect(
      runPoeCommand({
        factory: createFactory(env),
        openSpec: createOpenSpec({ execution: { activityTimeoutMs: 1 } }),
        detach: false,
        state,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: "ActivityTimeoutError" });
  });
});
