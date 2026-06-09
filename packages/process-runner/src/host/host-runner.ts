import { spawn as spawnChildProcess } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { Runner, RunSpec } from "../types.js";
import type { HostRunnerOptions, RunHandle, RunResult } from "../types.js";

export function createHostRunner(options: HostRunnerOptions = {}): Runner {
  const runnerOptions = normalizeHostRunnerOptions(options);
  const detachedByDefault = runnerOptions.detached === true;

  return {
    name: "host",
    exec(inputSpec: RunSpec): RunHandle {
      const spec = normalizeRunSpec(inputSpec);

      if (spec.signal?.aborted === true) {
        return {
          pid: null,
          stdin: null,
          stdout: null,
          stderr: null,
          result: Promise.resolve({ exitCode: 1 }),
          kill() {}
        };
      }

      const stdinMode = spec.stdin ?? "ignore";
      const stdoutMode = spec.stdout ?? "pipe";
      const stderrMode = spec.stderr ?? "pipe";
      const killProcessGroup = detachedByDefault || spec.killProcessGroup === true;
      const stdio: SpawnOptions["stdio"] =
        stdinMode === "inherit" && stdoutMode === "inherit" && stderrMode === "inherit"
          ? "inherit"
          : [stdinMode, stdoutMode, stderrMode];
      const child: ChildProcess = spawnChildProcess(
        spec.command,
        spec.args ?? [],
        createNullRecord<SpawnOptions>({
          cwd: spec.cwd,
          env: spec.env,
          stdio,
          ...(killProcessGroup ? { detached: true } : {})
        })
      );

      if (killProcessGroup) {
        child.unref();
      }

      const kill = (signal?: NodeJS.Signals) => {
        if (killProcessGroup && process.platform !== "win32" && child.pid !== undefined) {
          process.kill(-child.pid, signal);
          return;
        }

        child.kill(signal);
      };

      let settled = false;
      let resolveResult: ((value: RunResult) => void) | null = null;
      const result = new Promise<RunResult>((resolve) => {
        resolveResult = resolve;
      });

      const cleanupAbort = bindAbortSignal(spec.signal, () => {
        try {
          kill("SIGTERM");
        } catch {
          return;
        }
      });

      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        cleanupAbort();
        resolveResult?.({ exitCode: code ?? 1 });
      });
      child.once("error", () => {
        if (settled) return;
        settled = true;
        cleanupAbort();
        resolveResult?.({ exitCode: 1 });
      });

      return {
        pid: child.pid ?? null,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        result,
        kill
      };
    }
  };
}

function normalizeHostRunnerOptions(options: HostRunnerOptions): HostRunnerOptions {
  return createNullRecord({
    ...optionalOwnProperty(options, "detached")
  });
}

function normalizeRunSpec(spec: RunSpec): RunSpec {
  return createNullRecord({
    command: getOwnProperty(spec, "command") as RunSpec["command"],
    ...optionalOwnProperty(spec, "args"),
    ...optionalOwnProperty(spec, "cwd"),
    ...optionalOwnProperty(spec, "env"),
    ...optionalOwnProperty(spec, "stdin"),
    ...optionalOwnProperty(spec, "stdout"),
    ...optionalOwnProperty(spec, "stderr"),
    ...optionalOwnProperty(spec, "tty"),
    ...optionalOwnProperty(spec, "signal"),
    ...optionalOwnProperty(spec, "killProcessGroup")
  });
}

function optionalOwnProperty<T extends object, Name extends keyof T>(
  value: T,
  name: Name
): Pick<T, Name> | Record<string, never> {
  const property = getOwnProperty(value, name);
  return property === undefined ? {} : ({ [name]: property } as Pick<T, Name>);
}

function getOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): unknown {
  return hasOwnProperty(value, name) ? value[name] : undefined;
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function createNullRecord<T extends object>(value: T): T {
  return Object.assign(Object.create(null) as T, value);
}

function bindAbortSignal(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (signal === undefined) {
    return () => {};
  }

  if (signal.aborted) {
    onAbort();
    return () => {};
  }

  signal.addEventListener("abort", onAbort, { once: true });

  return () => {
    signal.removeEventListener("abort", onAbort);
  };
}
