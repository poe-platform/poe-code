import "./register-factories.js";
import { runPoeCommand } from "@poe-code/agent-harness-tools";
import { resolveConfig } from "./configs/resolve-config.js";
import { getMcpArgs } from "./mcp-args.js";
import { stripModelNamespace } from "./model-utils.js";
import { resolveSpawnExecution } from "./runtime.js";
import { resolveModeConfig, type SpawnOptions, type SpawnResult } from "./types.js";

export async function spawnInteractive(
  agentId: string,
  options: SpawnOptions
): Promise<SpawnResult> {
  const resolved = resolveConfig(agentId);
  const spawnConfig = resolved.spawnConfig;

  if (!spawnConfig) {
    throw new Error(`Agent "${resolved.agentId}" has no spawn config.`);
  }

  if (spawnConfig.kind !== "cli") {
    throw new Error(`Agent "${resolved.agentId}" does not support CLI spawn.`);
  }

  if (!resolved.binaryName) {
    throw new Error(`Agent "${resolved.agentId}" has no binaryName.`);
  }

  if (!spawnConfig.interactive) {
    throw new Error(`Agent "${resolved.agentId}" does not support interactive mode.`);
  }

  const { interactive } = spawnConfig;

  const args: string[] = [];

  if (interactive.defaultArgsPosition === "beforePrompt") {
    args.push(...interactive.defaultArgs);
  }

  if (options.prompt) {
    if (interactive.promptFlag) {
      args.push(interactive.promptFlag, options.prompt);
    } else {
      args.push(options.prompt);
    }
  }

  if (options.model && spawnConfig.modelFlag) {
    let model = spawnConfig.modelStripProviderPrefix
      ? stripModelNamespace(options.model)
      : options.model;
    if (spawnConfig.modelTransform) model = spawnConfig.modelTransform(model);
    args.push(spawnConfig.modelFlag, model);
  }

  if (interactive.defaultArgsPosition !== "beforePrompt") {
    args.push(...interactive.defaultArgs);
  }
  args.push(...getMcpArgs(spawnConfig, options.mcpServers));

  const modeResolved = resolveModeConfig(spawnConfig.modes[options.mode ?? "yolo"]);
  args.push(...modeResolved.args);

  if (options.args && options.args.length > 0) {
    args.push(...options.args);
  }

  const processEnv = modeResolved.env ? { ...process.env, ...modeResolved.env } : undefined;
  const executionEnv = processEnv as Record<string, string> | undefined;
  const argv = [resolved.binaryName, ...args];
  const execution = resolveSpawnExecution({
    cwd: options.cwd ?? process.cwd(),
    env: (processEnv ?? process.env) as Record<string, string>,
    argv,
    tool: resolved.agentId,
    runtime: {
      runtime: options.runtime,
      runtimeImage: options.runtimeImage,
      runtimeTemplate: options.runtimeTemplate,
      detach: options.detach,
      mountPoeCode: options.mountPoeCode
    },
    openSpec: {
      execution: {
        wrapForLogTee: false,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        tty: true,
        env: executionEnv
      },
      shellSpec: {
        command: resolved.binaryName,
        args,
        cwd: options.cwd,
        env: executionEnv,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        tty: true,
        signal: options.signal
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

  return {
    stdout: "",
    stderr: "",
    exitCode: result.kind === "sync" ? result.exitCode : 0,
    ...(result.kind === "detached"
      ? { detached: { jobId: result.jobId, envId: result.envId } }
      : {})
  };
}
