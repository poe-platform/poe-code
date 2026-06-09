import { spawn as spawnChildProcess } from "node:child_process";
import { registerExecutionEnvFactory } from "@poe-code/agent-harness-tools";
import type { ExecutionEnvFactory, OpenedEnv, RunSpec } from "@poe-code/agent-harness-tools";
import { dockerExecutionEnvFactory, hostExecutionEnvFactory } from "@poe-code/process-runner";
import { e2bExecutionEnvFactory } from "@poe-code/runner-e2b";

registerExecutionEnvFactory(hostExecutionEnvFactory);
registerExecutionEnvFactory(dockerExecutionEnvFactory);
registerExecutionEnvFactory(e2bExecutionEnvFactory);

if (isVitest()) {
  registerExecutionEnvFactory(createTestHostExecutionEnvFactory());
}

function isVitest(): boolean {
  return process.env.VITEST !== undefined || process.env.VITEST_POOL_ID !== undefined;
}

function createTestHostExecutionEnvFactory(): ExecutionEnvFactory {
  return {
    type: "host",
    supportsDetach: false,
    open: ((openSpec: Parameters<ExecutionEnvFactory["open"]>[0]) => {
      return {
        id: "host",
        job: null,
        async uploadWorkspace() {
          return { files: 0, bytes: 0, skipped: [] };
        },
        async downloadWorkspace() {
          return { files: 0, bytes: 0, conflicts: [] };
        },
        exec(spec) {
          return runHost(spawnChildProcess, spec);
        },
        async detach() {
          throw new Error(
            "host runtime does not support detach because host has no addressable env"
          );
        },
        shell() {
          const shellSpec = openSpec.shellSpec;
          const shellArgs = getOwnShellSpecProperty(shellSpec, "args");
          const shellCwd = getOwnShellSpecProperty(shellSpec, "cwd");
          const shellEnv = getOwnShellSpecProperty(shellSpec, "env");
          const shellSignal = getOwnShellSpecProperty(shellSpec, "signal");
          return runHost(spawnChildProcess, {
            command:
              getOwnShellSpecProperty(shellSpec, "command") ??
              openSpec.env.SHELL ??
              process.env.SHELL ??
              "sh",
            ...(shellArgs === undefined ? {} : { args: shellArgs }),
            cwd: shellCwd ?? openSpec.cwd,
            env: hasOwnShellSpecProperty(shellSpec, "env") ? shellEnv : openSpec.env,
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
            tty: true,
            ...(shellSignal === undefined ? {} : { signal: shellSignal })
          });
        },
        async close() {}
      } as OpenedEnv;
    }) as unknown as ExecutionEnvFactory["open"],
    async attach() {
      throw new Error("host runtime does not support reattach");
    }
  };
}

function runHost(spawnProcess: typeof import("node:child_process").spawn, spec: RunSpec) {
  const stdin = spec.stdin ?? "ignore";
  const stdout = spec.stdout ?? "pipe";
  const stderr = spec.stderr ?? "pipe";
  const stdio =
    stdin === "inherit" && stdout === "inherit" && stderr === "inherit"
      ? "inherit"
      : ([stdin, stdout, stderr] as [
          "pipe" | "inherit" | "ignore",
          "pipe" | "inherit",
          "pipe" | "inherit"
        ]);
  const child = spawnProcess(
    spec.command,
    spec.args ?? [],
    createNullRecord({
      cwd: spec.cwd,
      env: spec.env,
      stdio
    })
  );
  const result = new Promise<{ exitCode: number }>((resolve) => {
    child.once("close", (code) => {
      resolve({ exitCode: code ?? 1 });
    });
    child.once("error", () => {
      resolve({ exitCode: 1 });
    });
  });
  const kill = (signal?: NodeJS.Signals) => {
    child.kill(signal);
  };
  if (spec.signal?.aborted) {
    kill("SIGTERM");
  } else {
    spec.signal?.addEventListener("abort", () => kill("SIGTERM"), { once: true });
  }
  return {
    pid: child.pid ?? null,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    result,
    kill
  };
}

function createNullRecord<T extends object>(value: T): T {
  return Object.assign(Object.create(null) as T, value);
}

function getOwnShellSpecProperty<Name extends keyof RunSpec>(
  shellSpec: RunSpec | undefined,
  name: Name
): RunSpec[Name] | undefined {
  return hasOwnShellSpecProperty(shellSpec, name) ? shellSpec[name] : undefined;
}

function hasOwnShellSpecProperty<Name extends keyof RunSpec>(
  shellSpec: RunSpec | undefined,
  name: Name
): shellSpec is RunSpec & Record<Name, RunSpec[Name]> {
  return shellSpec !== undefined && Object.prototype.hasOwnProperty.call(shellSpec, name);
}
