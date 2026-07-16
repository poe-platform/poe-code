import path from "node:path";
import {
  createMockRunner,
  type MockRunBehavior,
  type RunHandle,
  type Runner,
  type RunSpec
} from "@poe-code/process-runner";
import { Volume, createFsFromVolume } from "memfs";
import { createLogWriter } from "../logs/log-writer.js";
import { createStateStore } from "../state/state-store.js";
import { createSupervisor } from "../supervisor/supervisor.js";
import type {
  LauncherFileSystem,
  LogWriter,
  ProcessSpec,
  ProcessState,
  StateStore,
  Supervisor,
  SupervisorOptions
} from "../types.js";

export type SimulationLogLine = {
  line: string;
  stream: "stdout" | "stderr";
};

export type SimulationRun = {
  handle: RunHandle;
  killSignals: Array<NodeJS.Signals | undefined>;
  spec: RunSpec;
};

export type SimulationEnv = {
  execCalls: RunSpec[];
  fs: LauncherFileSystem;
  logDir: string;
  logLines: SimulationLogLine[];
  logWriter: LogWriter;
  runner: Runner;
  runs: SimulationRun[];
  stateDir: string;
  statePath: string;
  stateStore: StateStore;
  statusChanges: ProcessState[];
  stderrLogPath: string;
  stdoutLogPath: string;
  supervisor: Supervisor;
};

export function createSimulation(
  spec: ProcessSpec,
  behaviors: MockRunBehavior[],
  options: Pick<SupervisorOptions, "signal"> &
    Partial<Pick<SupervisorOptions, "startSettleMs" | "stateDir">> = {}
): SimulationEnv {
  const fs = createMemFs();
  const stateDir = options.stateDir ?? "/state";
  const statePath = path.join(stateDir, spec.id, "state.json");
  const logDir = path.join(stateDir, spec.id, "logs");
  const stdoutLogPath = path.join(logDir, "stdout.log");
  const stderrLogPath = path.join(logDir, "stderr.log");
  const stateStore = createStateStore(stateDir, fs);
  const logWriter = createLogWriter(logDir, spec.logRetainCount ?? 5, fs);
  const statusChanges: ProcessState[] = [];
  const logLines: SimulationLogLine[] = [];
  const execCalls: RunSpec[] = [];
  const runs: SimulationRun[] = [];
  const runner = createRecordingMockRunner(behaviors, execCalls, runs);
  const supervisor = createSupervisor({
    spec,
    stateDir,
    fs,
    runner,
    startSettleMs: options.startSettleMs ?? 0,
    ...(options.signal ? { signal: options.signal } : {}),
    onLog: (line, stream) => {
      logLines.push({ line, stream });
    },
    onStatusChange: state => {
      statusChanges.push(state);
    }
  });

  return {
    execCalls,
    fs,
    logDir,
    logLines,
    logWriter,
    runner,
    runs,
    stateDir,
    statePath,
    stateStore,
    statusChanges,
    stderrLogPath,
    stdoutLogPath,
    supervisor
  };
}

function createMemFs(): LauncherFileSystem {
  const volume = new Volume();
  const rawFs = createFsFromVolume(volume).promises;

  return {
    appendFile: async (filePath, content) => {
      await rawFs.appendFile(filePath, content, { encoding: "utf8" });
    },
    mkdir: async (filePath, options) => {
      await rawFs.mkdir(filePath, options);
    },
    readFile: async (filePath, encoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
    readdir: async filePath => rawFs.readdir(filePath) as Promise<string[]>,
    rm: async (filePath, options) => {
      await rawFs.rm(filePath, options);
    },
    rename: async (sourcePath, destinationPath) => {
      await rawFs.rename(sourcePath, destinationPath);
    },
    stat: async filePath => {
      const stat = await rawFs.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        mtimeMs: Number(stat.mtimeMs)
      };
    },
    lstat: async filePath => {
      const stat = await rawFs.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    writeFile: async (filePath, content, options) => {
      await rawFs.writeFile(filePath, content, options ?? { encoding: "utf8" });
    }
  };
}

function createRecordingMockRunner(
  behaviors: MockRunBehavior[],
  execCalls: RunSpec[],
  runs: SimulationRun[]
): Runner {
  const runner = createMockRunner(behaviors);

  return {
    name: runner.name,
    exec(spec) {
      const nextSpec = cloneRunSpec(spec);
      const baseHandle = runner.exec(nextSpec);
      const killSignals: Array<NodeJS.Signals | undefined> = [];
      const handle: RunHandle = {
        pid: baseHandle.pid,
        stderr: baseHandle.stderr,
        stdin: baseHandle.stdin,
        stdout: baseHandle.stdout,
        result: baseHandle.result,
        kill(signal) {
          killSignals.push(signal);
          baseHandle.kill(signal);
        }
      };

      execCalls.push(nextSpec);
      runs.push({ handle, killSignals, spec: nextSpec });

      return handle;
    }
  };
}

function cloneRunSpec(spec: RunSpec): RunSpec {
  return {
    ...spec,
    ...(spec.args ? { args: [...spec.args] } : {}),
    ...(spec.env ? { env: { ...spec.env } } : {})
  };
}
