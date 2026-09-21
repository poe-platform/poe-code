import { mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import path from "node:path";
import { native } from "./native.js";
import { buildSpawnArgs, resolveConfig, mergeSpawnEnvironment } from "./index.js";
import { getMcpEnv } from "./mcp-args.js";
import { applyMcpFile } from "./mcp-file.js";
import { observeAgentSpawn } from "./observe.js";
import { spawnStreaming } from "./spawn-streaming.js";
import { createSpawnRetry } from "./retry.js";
import { createSpawnParallel } from "./parallel.js";
import { resolveSpawnExecution } from "./runtime.js";
import { bridgeResourcesForRun, cleanupResourcesForRun } from "./resources.js";
import { runPoeCommand } from "./harness/run-poe-command.js";
const planner = new native.NativeSpawnPlanner();
function abortError() {
  const error = new Error("Agent spawn aborted");
  error.name = "AbortError";
  return error;
}
export function isActivityTimeoutError(error) {
  return error instanceof Error && error.name === "ActivityTimeoutError";
}
export async function spawn(agentId, options, context) {
  return observeAgentSpawn(
    {
      agent: agentId,
      cwd: options.cwd,
      mode: options.mode,
      otelSink: options.otelSink,
      prompt: options.prompt
    },
    async () => {
      if (options.signal?.aborted) throw abortError();
      const { agentId: resolvedId, spawnConfig } = resolveConfig(agentId);
      const { binaryName, args, displayArgs, env: modeEnv } = buildSpawnArgs(agentId, options);
      const stdinMode = planner.selectedStdin(
        agentId,
        JSON.stringify({ prompt: options.prompt, useStdin: options.useStdin })
      );
      if (context?.dryRun) {
        context.logger?.dryRun([binaryName, ...displayArgs].join(" "));
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      const cwd = options.cwd ?? process.cwd(),
        manifest = bridgeResourcesForRun(agentId, cwd, options.skills, options.hooks);
      let restore, logFd;
      try {
        restore =
          options.mcpServers && spawnConfig.mcpFile
            ? await applyMcpFile(spawnConfig.mcpFile, options.mcpServers, cwd)
            : undefined;
        const logFile = resolveLogPath(options);
        if (logFile)
          try {
            mkdirSync(path.dirname(logFile), { recursive: true });
            logFd = openSync(logFile, "a");
          } catch {
            /* best effort */
          }
        const overrides = {
          ...(modeEnv ?? {}),
          ...getMcpEnv(spawnConfig, options.mcpServers),
          ...(options.env ?? {})
        };
        const processEnv = Object.keys(overrides).length
          ? mergeSpawnEnvironment(process.env, overrides)
          : undefined;
        const output = (channel, chunk) => {
          options.tee?.[channel]?.write(chunk);
          if (logFd !== undefined)
            try {
              writeSync(logFd, chunk);
            } catch {
              /* best effort */
            }
        };
        const execution = resolveSpawnExecution({
          cwd,
          runtimeConfigCwd: options.runtimeConfigCwd,
          env: processEnv ?? process.env,
          argv: [binaryName, ...args],
          displayArgv: [binaryName, ...displayArgs],
          tool: resolvedId,
          runtime: {
            runtime: options.runtime,
            runtimeImage: options.runtimeImage,
            detach: options.detach,
            mountPoeCode: options.mountPoeCode,
            runnerSync: options.runnerSync
          },
          context,
          openSpec: {
            execution: {
              wrapForLogTee: false,
              stdin: stdinMode ? "pipe" : process.stdin.isTTY ? "inherit" : "ignore",
              stdout: "pipe",
              stderr: "pipe",
              env: processEnv,
              input: stdinMode ? options.prompt : undefined,
              captureOutput: true,
              activityTimeoutMs: options.activityTimeoutMs,
              onStdout: (chunk) => output("stdout", chunk),
              onStderr: (chunk) => output("stderr", chunk)
            }
          }
        });
        const result = await runPoeCommand({
          factory: execution.factory,
          openSpec: execution.openSpec,
          detach: execution.detach,
          state: execution.state,
          signal: options.signal
        });
        return result.kind === "detached"
          ? {
              stdout: "",
              stderr: "",
              exitCode: 0,
              detached: { jobId: result.jobId, envId: result.envId },
              ...(logFile ? { logFile } : {})
            }
          : {
              stdout: result.stdout ?? "",
              stderr: result.stderr ?? "",
              exitCode: result.exitCode,
              ...(logFile ? { logFile } : {})
            };
      } finally {
        if (logFd !== undefined)
          try {
            closeSync(logFd);
          } catch {
            /* best effort */
          }
        await restore?.();
        cleanupResourcesForRun(manifest);
      }
    }
  );
}
spawn.parallel = createSpawnParallel((service, options) => ({
  events: (async function* () {})(),
  result: spawn(service, options)
}));
function resolveLogPath(options) {
  if (options.logPath) return options.logPath;
  const name = options.logFileName;
  if (
    !options.logDir ||
    !name ||
    path.isAbsolute(name) ||
    path.win32.isAbsolute(name) ||
    path.basename(name) !== name ||
    path.win32.basename(name) !== name
  )
    return undefined;
  return path.join(options.logDir, name);
}

spawn.retry = createSpawnRetry((service, options) => {
  const handle = spawnStreaming({ ...options, agentId: service });
  return { events: handle.events, result: handle.done };
});
