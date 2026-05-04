import { PassThrough } from "node:stream";
import {
  createStateManager,
  type RuntimeConfig,
  type StateFileSystem,
  type StateManager
} from "@poe-code/poe-code-config";
import type { RunHandle, RunResult, RunSpec } from "@poe-code/process-runner";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import type {
  DownloadResult,
  ExecutionEnvFactory,
  OpenedEnv,
  OpenSpec,
  UploadResult
} from "./execution-env.js";
import type { LogStreamFs } from "./log-stream.js";
import { runPoeCommand } from "./run-poe-command.js";

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
  const start = script.indexOf(prefix);
  const end = script.indexOf(suffix, start);
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

function createE2bFactory(env: OpenedEnv): ExecutionEnvFactory {
  return {
    type: "e2b",
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

describe("runPoeCommand", () => {
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
      stderr: "pipe"
    });
  });

  it("leaves the environment open in detach mode", async () => {
    const { state, statuses } = createRecordingState();
    const runResult = deferred<RunResult>();
    const env = createMockEnv({ result: runResult.promise });

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

  it("configures the spawned E2B agent after upload and before the agent command", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv();
    const upload = env.uploadWorkspace.bind(env);
    const exec = env.exec.bind(env);
    let uploadFinished = false;

    env.uploadWorkspace = async () => {
      const result = await upload();
      uploadFinished = true;
      return result;
    };
    env.exec = (spec): RunHandle => {
      expect(uploadFinished).toBe(true);
      return exec(spec);
    };

    await runPoeCommand({
      factory: createE2bFactory(env),
      openSpec: createOpenSpec({
        env: { POE_API_KEY: "sk-test" },
        jobLabel: { tool: "claude-code", argv: ["claude", "-p", "hello"] }
      }),
      detach: false,
      state
    });

    expect(env.execSpecs.map((spec) => [spec.command, ...(spec.args ?? [])])).toEqual([
      ["which", "claude"],
      [
        "poe-code",
        "configure",
        "--yes",
        "--provider",
        "poe",
        "claude-code"
      ],
      ["sh", "-c", expect.stringContaining("'claude' '-p' 'hello'")]
    ]);
    expect(env.execSpecs[1]).toMatchObject({
      cwd: "/repo",
      env: { POE_API_KEY: "sk-test" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe"
    });
  });

  it("skips E2B configure when the spawned agent binary is absent", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv();
    const exec = env.exec.bind(env);

    env.exec = (spec): RunHandle => {
      env.execSpecs.push(spec);
      const isBinaryCheck =
        spec.command === "which" ||
        spec.command === "where" ||
        (spec.command === "sh" &&
          spec.args?.[0] === "-c" &&
          spec.args[1]?.includes("test -f"));
      if (isBinaryCheck) {
        return {
          pid: 123,
          stdout: null,
          stderr: null,
          stdin: null,
          result: Promise.resolve({ exitCode: 1 }),
          kill() {}
        };
      }
      env.execSpecs.pop();
      return exec(spec);
    };

    await runPoeCommand({
      factory: createE2bFactory(env),
      openSpec: createOpenSpec({
        jobLabel: { tool: "codex", argv: ["codex", "exec", "hello"] }
      }),
      detach: false,
      state
    });

    expect(env.execSpecs.map((spec) => [spec.command, ...(spec.args ?? [])])).toEqual([
      ["which", "codex"],
      ["where", "codex"],
      [
        "sh",
        "-c",
        'test -f "/usr/local/bin/codex" || test -f "/usr/bin/codex" || test -f "$HOME/.local/bin/codex" || test -f "$HOME/.claude/local/bin/codex"'
      ],
      ["sh", "-c", expect.stringContaining("'codex' 'exec' 'hello'")]
    ]);
  });

  it("does not treat an empty where result as an existing E2B agent binary", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv();
    const exec = env.exec.bind(env);

    env.exec = (spec): RunHandle => {
      env.execSpecs.push(spec);
      if (spec.command === "which") {
        return {
          pid: 123,
          stdout: null,
          stderr: null,
          stdin: null,
          result: Promise.resolve({ exitCode: 1 }),
          kill() {}
        };
      }
      if (spec.command === "where") {
        const stdout = new PassThrough();
        stdout.end("");
        return {
          pid: 123,
          stdout,
          stderr: null,
          stdin: null,
          result: Promise.resolve({ exitCode: 0 }),
          kill() {}
        };
      }
      if (
        spec.command === "sh" &&
        spec.args?.[0] === "-c" &&
        spec.args[1]?.includes("test -f")
      ) {
        return {
          pid: 123,
          stdout: null,
          stderr: null,
          stdin: null,
          result: Promise.resolve({ exitCode: 1 }),
          kill() {}
        };
      }
      env.execSpecs.pop();
      return exec(spec);
    };

    await runPoeCommand({
      factory: createE2bFactory(env),
      openSpec: createOpenSpec({
        jobLabel: { tool: "opencode", argv: ["opencode", "run", "hello"] }
      }),
      detach: false,
      state
    });

    expect(env.execSpecs.map((spec) => [spec.command, ...(spec.args ?? [])])).toEqual([
      ["which", "opencode"],
      ["where", "opencode"],
      [
        "sh",
        "-c",
        'test -f "/usr/local/bin/opencode" || test -f "/usr/bin/opencode" || test -f "$HOME/.local/bin/opencode" || test -f "$HOME/.claude/local/bin/opencode"'
      ],
      ["sh", "-c", expect.stringContaining("'opencode' 'run' 'hello'")]
    ]);
  });

  it("fails the E2B spawn when sandbox configure fails after the binary check passes", async () => {
    const { state } = createRecordingState();
    const env = createMockEnv();
    const exec = env.exec.bind(env);

    env.exec = (spec): RunHandle => {
      env.execSpecs.push(spec);
      if (spec.command === "which") {
        return {
          pid: 123,
          stdout: null,
          stderr: null,
          stdin: null,
          result: Promise.resolve({ exitCode: 0 }),
          kill() {}
        };
      }
      if (spec.command === "poe-code") {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        stdout.end("configure stdout\n");
        stderr.end("configure stderr\n");
        return {
          pid: 123,
          stdout,
          stderr,
          stdin: null,
          result: Promise.resolve({ exitCode: 2 }),
          kill() {}
        };
      }
      env.execSpecs.pop();
      return exec(spec);
    };

    await expect(
      runPoeCommand({
        factory: createE2bFactory(env),
        openSpec: createOpenSpec({
          jobLabel: { tool: "claude-code", argv: ["claude", "-p", "hello"] }
        }),
        detach: false,
        state
      })
    ).rejects.toThrow(
      [
        "Failed to configure claude-code for Poe inside E2B sandbox.",
        "Exit code: 2",
        "stdout:\nconfigure stdout",
        "stderr:\nconfigure stderr"
      ].join("\n")
    );

    expect(env.execSpecs.map((spec) => [spec.command, ...(spec.args ?? [])])).toEqual([
      ["which", "claude"],
      [
        "poe-code",
        "configure",
        "--yes",
        "--provider",
        "poe",
        "claude-code"
      ]
    ]);
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

  it("kills, downloads, and closes when the abort signal fires during sync", async () => {
    const { state } = createRecordingState();
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

    const result = await runPoeCommand({
      factory: createFactory(env),
      openSpec: createOpenSpec(),
      detach: false,
      state,
      signal: controller.signal
    });

    const [job] = await state.jobs.list();
    expect(killed).toBe(true);
    expect(env.downloads).toEqual([{ conflictPolicy: "refuse" }]);
    expect(env.closed).toBe(true);
    expect(result).toMatchObject({ kind: "sync", exitCode: 130 });
    expect(job).toMatchObject({ status: "exited", exit_code: 130 });
  });
});
