import * as childProcess from "node:child_process";
import { randomBytes } from "node:crypto";
import { buildDockerRunArgs } from "./args.js";
import { buildContextArgs, detectContext } from "./context.js";
import { detectEngine } from "./engine.js";
import type { DockerRunnerOptions, RunHandle, Runner, RunResult, RunSpec } from "../types.js";

export function createDockerRunner(options: DockerRunnerOptions): Runner {
  const engine = options.engine ?? detectEngine();
  const context = options.context ?? detectContext();

  return {
    name: "docker",
    exec(spec: RunSpec): RunHandle {
      const stdinMode = spec.stdin ?? "ignore";
      const stdoutMode = spec.stdout ?? "pipe";
      const stderrMode = spec.stderr ?? "pipe";
      const interactiveMode =
        stdinMode === "inherit" &&
        stdoutMode === "inherit" &&
        stderrMode === "inherit" &&
        spec.tty === true;
      const containerName = buildContainerName(options.containerName ?? spec.command);
      const runArgs = buildDockerRunArgs({
        engine,
        context,
        image: options.image,
        command: spec.command,
        args: spec.args ?? [],
        cwd: spec.cwd,
        env: spec.env,
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
      const child = childProcess.spawn(command, args, {
        stdio: interactiveMode ? "inherit" : [stdinMode, stdoutMode, stderrMode]
      });
      let isResultSettled = false;
      let resolveResult: ((value: RunResult) => void) | null = null;
      const result = new Promise<RunResult>((resolve) => {
        resolveResult = resolve;
      });
      const cleanupAbort = bindAbortSignal(spec.signal, () => {
        spawnControlCommand(engine, context, ["stop", containerName]);
      });
      const settleResult = (exitCode: number) => {
        if (isResultSettled) {
          return;
        }

        isResultSettled = true;
        cleanupAbort();
        resolveResult?.({ exitCode });
      };

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
  childProcess.spawn(engine, [...buildContextArgs(engine, context), ...args], {
    stdio: "ignore"
  });
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
