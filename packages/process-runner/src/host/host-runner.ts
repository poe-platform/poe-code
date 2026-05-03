import { spawn as spawnChildProcess } from "node:child_process";
import type { Runner, RunSpec } from "../types.js";
import type { HostRunnerOptions, RunHandle, RunResult } from "../types.js";

export function createHostRunner(options: HostRunnerOptions = {}): Runner {
  const detached = options.detached === true;

  return {
    name: "host",
    exec(spec: RunSpec): RunHandle {
      const stdinMode = spec.stdin ?? "ignore";
      const stdoutMode = spec.stdout ?? "pipe";
      const stderrMode = spec.stderr ?? "pipe";
      const stdio =
        stdinMode === "inherit" && stdoutMode === "inherit" && stderrMode === "inherit"
          ? "inherit"
          : [stdinMode, stdoutMode, stderrMode];
      const child = spawnChildProcess(spec.command, spec.args ?? [], {
        cwd: spec.cwd,
        env: spec.env,
        stdio,
        ...(detached ? { detached: true } : {})
      });

      if (detached) {
        child.unref();
      }

      const kill = (signal?: NodeJS.Signals) => {
        if (detached && process.platform !== "win32" && child.pid !== undefined) {
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
        kill("SIGTERM");
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
