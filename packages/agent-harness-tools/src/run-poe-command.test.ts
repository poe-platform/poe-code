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
  downloads: { conflictPolicy: "refuse" | "overwrite" }[];
  execSpecs: RunSpec[];
  fs: LogStreamFs;
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

function createMockEnv(opts: {
  result?: Promise<RunResult>;
  commandExitCode?: number;
  download?: DownloadResult;
} = {}): MockEnv {
  const result = opts.result ?? Promise.resolve({ exitCode: 0 });
  const commandExitCode = opts.commandExitCode ?? 0;
  const download = opts.download ?? { files: 0, bytes: 0, conflicts: [] };
  const rawFs = createFsFromVolume(new Volume());
  const env: MockEnv = {
    id: "env-1",
    job: null,
    closed: false,
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
      void writeExitFile(rawFs.promises, spec, commandExitCode);
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
      throw new Error("detach is not used by runPoeCommand");
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
    expect(env.downloads).toEqual([]);
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
