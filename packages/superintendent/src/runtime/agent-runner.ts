import "@poe-code/agent-spawn/register-factories";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import path from "node:path";
import {
  type RuntimeOverrideOptions,
  resolvePoeCommandExecution,
  runPoeCommand
} from "@poe-code/agent-harness-tools";
import {
  buildSpawnArgs,
  type McpSpawnConfig,
  type SpawnMode
} from "@poe-code/agent-spawn";

export type { McpSpawnConfig, SpawnMode };

export type AutonomousInput = {
  agent: string;
  mode?: string;
  prompt: string;
  cwd?: string;
  mcpServers?: McpSpawnConfig;
  logPath?: string;
  signal?: AbortSignal;
  runtime?: RuntimeOverrideOptions["runtime"];
  runtimeImage?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: RuntimeOverrideOptions["runnerSync"];
};

export type AutonomousOutput =
  | string
  | {
      summary?: unknown;
      log?: unknown;
      output?: unknown;
      stdout?: unknown;
      text?: unknown;
      toolCalls?: unknown;
      sessionResult?: unknown;
      logFile?: unknown;
    };

type AutonomousRunner = (
  agent: string,
  options: Omit<AutonomousInput, "agent">
) => Promise<AutonomousOutput>;

const runnerContext = new AsyncLocalStorage<AutonomousRunner>();

export async function withAutonomousAgentRunner<T>(
  runner: AutonomousRunner,
  operation: () => Promise<T>
): Promise<T> {
  return runnerContext.run(runner, operation);
}

export async function runAutonomousAgent(input: AutonomousInput): Promise<AutonomousOutput> {
  const injectedRunner = runnerContext.getStore();
  if (injectedRunner) {
    return injectedRunner(input.agent, {
      cwd: input.cwd,
      prompt: input.prompt,
      mode: input.mode,
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
      ...(input.logPath ? { logPath: input.logPath } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.runtime ? { runtime: input.runtime } : {}),
      ...(input.runtimeImage ? { runtimeImage: input.runtimeImage } : {}),
      ...(input.detach ? { detach: input.detach } : {}),
      ...(input.mountPoeCode ? { mountPoeCode: input.mountPoeCode } : {}),
      ...(input.runnerSync ? { runnerSync: input.runnerSync } : {})
    });
  }

  const spawnArgs = buildSpawnArgs(input.agent, {
    prompt: input.prompt,
    mode: input.mode as SpawnMode | undefined,
    ...(input.mcpServers ? { mcpServers: input.mcpServers } : {})
  });
  const processEnv = spawnArgs.env ? { ...process.env, ...spawnArgs.env } : undefined;
  const argv = [spawnArgs.binaryName, ...spawnArgs.args];
  const logFd = input.logPath ? openSpawnLog(input.logPath) : undefined;
  const execution = resolvePoeCommandExecution({
    cwd: input.cwd ?? process.cwd(),
    env: (processEnv ?? process.env) as Record<string, string>,
    argv,
    tool: input.agent,
    runtime: {
      runtime: input.runtime,
      runtimeImage: input.runtimeImage,
      detach: input.detach,
      mountPoeCode: input.mountPoeCode,
      runnerSync: input.runnerSync
    },
    openSpec: {
      execution: {
        wrapForLogTee: false,
        stdin: "inherit",
        stdout: "pipe",
        stderr: "pipe",
        env: processEnv as Record<string, string> | undefined,
        captureOutput: true,
        onStdout(chunk) {
          appendSpawnLog(logFd, chunk);
        },
        onStderr(chunk) {
          appendSpawnLog(logFd, chunk);
        }
      }
    }
  });

  try {
    const result = await runPoeCommand({
      factory: execution.factory,
      openSpec: execution.openSpec,
      detach: execution.detach,
      state: execution.state,
      ...(input.signal ? { signal: input.signal } : {})
    });

    if (result.kind === "detached") {
      return {
        stdout: "",
        ...(input.logPath ? { logFile: input.logPath } : {})
      };
    }

    return {
      stdout: result.stdout ?? "",
      ...(input.logPath ? { logFile: input.logPath } : {})
    };
  } finally {
    closeSpawnLog(logFd);
  }
}

function openSpawnLog(filePath: string): number | undefined {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    return openSync(filePath, "a");
  } catch {
    return undefined;
  }
}

function appendSpawnLog(fd: number | undefined, chunk: string): void {
  if (fd === undefined) return;
  try {
    writeSync(fd, chunk);
  } catch {
    // logging is best-effort
  }
}

function closeSpawnLog(fd: number | undefined): void {
  if (fd === undefined) return;
  try {
    closeSync(fd);
  } catch {
    // logging is best-effort
  }
}
