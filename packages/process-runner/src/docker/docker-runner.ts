import * as childProcess from "node:child_process";
import { randomBytes } from "node:crypto";
import { buildDockerRunArgs } from "./args.js";
import { buildContextArgs, detectContext } from "./context.js";
import { detectEngine } from "./engine.js";
import { createDockerEnvFile } from "./env-file.js";
import type { DockerRunnerOptions, RunHandle, Runner, RunResult, RunSpec } from "../types.js";

const DOCKER_ABORT_GRACE_MS = 10_000;
const DOCKER_ABORT_FORCE_GRACE_MS = 5_000;

export function createDockerRunner(options: DockerRunnerOptions): Runner {
  const engine = options.engine ?? detectEngine();
  const context = options.context ?? detectContext();

  return {
    name: "docker",
    exec(spec: RunSpec): RunHandle {
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
      const interactiveMode =
        stdinMode === "inherit" &&
        stdoutMode === "inherit" &&
        stderrMode === "inherit" &&
        spec.tty === true;
      const containerName = buildContainerName(options.containerName ?? spec.command);
      const envFile = createDockerEnvFile(spec.env);
      const runArgs = buildDockerRunArgs({
        engine,
        context,
        image: options.image,
        command: spec.command,
        args: spec.args ?? [],
        cwd: spec.cwd,
        env: spec.env,
        envFilePath: envFile?.path,
        mounts: options.mounts ?? [],
        ports: options.ports ?? [],
        network: options.network,
        containerName,
        detached: false,
        interactive: stdinMode === "pipe" || stdinMode === "inherit",
        tty: spec.tty ?? false,
        rm: true,
        extraArgs: options.extraArgs ?? []
      });
      const [command, ...args] = runArgs;
      let child: childProcess.ChildProcess;
      try {
        child = childProcess.spawn(command, args, {
          stdio: interactiveMode ? "inherit" : [stdinMode, stdoutMode, stderrMode]
        });
      } catch (error) {
        envFile?.cleanup();
        throw error;
      }
      let isResultSettled = false;
      let exitCodeOverride: number | null = null;
      let resolveResult: ((value: RunResult) => void) | null = null;
      let abortEscalationTimers: Array<ReturnType<typeof setTimeout>> = [];
      const result = new Promise<RunResult>((resolve) => {
        resolveResult = resolve;
      });
      const clearAbortEscalation = () => {
        for (const timer of abortEscalationTimers) {
          clearTimeout(timer);
        }
        abortEscalationTimers = [];
      };
      const settleResult = (exitCode: number) => {
        if (isResultSettled) {
          return;
        }

        isResultSettled = true;
        cleanupAbort();
        clearAbortEscalation();
        envFile?.cleanup();
        resolveResult?.({ exitCode: exitCodeOverride ?? exitCode });
      };
      const scheduleAbortEscalation = () => {
        const terminateTimer = setTimeout(() => {
          killHostDockerChild(child, "SIGTERM");
          const forceTimer = setTimeout(() => {
            killHostDockerChild(child, "SIGKILL");
          }, DOCKER_ABORT_FORCE_GRACE_MS);
          unrefTimer(forceTimer);
          abortEscalationTimers.push(forceTimer);
        }, DOCKER_ABORT_GRACE_MS);
        unrefTimer(terminateTimer);
        abortEscalationTimers.push(terminateTimer);
      };
      const cleanupAbort = bindAbortSignal(spec.signal, () => {
        exitCodeOverride = 1;
        spawnControlCommand(engine, context, ["stop", containerName]);
        scheduleAbortEscalation();
      });

      child.once("error", () => {
        settleResult(1);
      });

      child.once("close", (code) => {
        settleResult(code ?? 1);
      });

      return {
        pid: null,
        stdin: interactiveMode ? null : child.stdin,
        stdout: interactiveMode ? null : child.stdout,
        stderr: interactiveMode ? null : child.stderr,
        result,
        kill(signal?: NodeJS.Signals) {
          if (signal === "SIGKILL") {
            spawnControlCommand(engine, context, ["kill", containerName]);
            return;
          }

          if (signal === undefined || signal === "SIGTERM") {
            spawnControlCommand(engine, context, ["stop", containerName]);
            return;
          }

          spawnControlCommand(engine, context, ["kill", `--signal=${signal}`, containerName]);
        }
      };
    }
  };
}

function killHostDockerChild(child: childProcess.ChildProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    return;
  }
}

function buildContainerName(name: string): string {
  const suffix = randomBytes(3).toString("hex").slice(0, 6);
  const sanitizedName = sanitizeContainerName(name);

  return `poe-run-${sanitizedName}-${suffix}`;
}

function sanitizeContainerName(name: string): string {
  let sanitized = "";

  for (const char of name) {
    if (isContainerNameCharacter(char)) {
      sanitized += char;
      continue;
    }

    sanitized += "-";
  }

  return sanitized.length > 0 ? sanitized : "command";
}

function isContainerNameCharacter(char: string): boolean {
  const code = char.charCodeAt(0);

  if (code >= 48 && code <= 57) {
    return true;
  }

  if (code >= 65 && code <= 90) {
    return true;
  }

  if (code >= 97 && code <= 122) {
    return true;
  }

  return char === "." || char === "_" || char === "-";
}

function spawnControlCommand(
  engine: DockerRunnerOptions["engine"] extends infer T ? Exclude<T, undefined> : never,
  context: string | null,
  args: string[]
): void {
  try {
    const child = childProcess.spawn(engine, [...buildContextArgs(engine, context), ...args], {
      stdio: "ignore"
    });
    child.once("error", () => undefined);
    child.unref();
  } catch {
    return;
  }
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

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (
    typeof timer === "object" &&
    timer !== null &&
    "unref" in timer &&
    typeof timer.unref === "function"
  ) {
    timer.unref();
  }
}
