import { spawnPlanner as planner, mergeSpawnEnvironment } from "./planning.js";
import { resolveConfig } from "./resolve-config.js";
import { getMcpEnv } from "./mcp-args.js";
import { resolveSpawnExecution } from "./runtime.js";
import { bridgeResourcesForRun, cleanupResourcesForRun } from "./resources.js";
import { runPoeCommand } from "./harness/run-poe-command.js";
export async function spawnInteractive(agentId, options) {
  const resolved = resolveConfig(agentId),
    config = resolved.spawnConfig;
  if (!config) throw new Error(`Agent "${resolved.agentId}" has no spawn config.`);
  if (config.kind !== "cli")
    throw new Error(`Agent "${resolved.agentId}" does not support CLI spawn.`);
  if (!resolved.binaryName) throw new Error(`Agent "${resolved.agentId}" has no binaryName.`);
  if (!config.interactive)
    throw new Error(`Agent "${resolved.agentId}" does not support interactive mode.`);
  const cwd = options.cwd ?? process.cwd();
  const plan = planner.build(
    agentId,
    JSON.stringify({
      prompt: options.prompt,
      mode: options.mode,
      model: options.model,
      args: options.args,
      mcpServers: options.mcpServers,
      resumeThreadId: options.resumeThreadId,
      cwd,
      interactiveTransport: true
    }),
    resolved.binaryName
  );
  const overrides = {
    ...(plan.env ?? {}),
    ...getMcpEnv(config, options.mcpServers),
    ...(options.env ?? {})
  };
  const env = Object.keys(overrides).length
    ? mergeSpawnEnvironment(process.env, overrides)
    : undefined;
  const execution = resolveSpawnExecution({
    cwd,
    runtimeConfigCwd: options.runtimeConfigCwd,
    env: env ?? process.env,
    argv: [plan.binaryName, ...plan.args],
    tool: resolved.agentId,
    runtime: {
      runtime: options.runtime,
      runtimeImage: options.runtimeImage,
      detach: options.detach,
      mountPoeCode: options.mountPoeCode,
      runnerSync: options.runnerSync
    },
    openSpec: {
      execution: {
        wrapForLogTee: false,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        tty: true,
        env
      },
      shellSpec: {
        command: plan.binaryName,
        args: plan.args,
        cwd: options.cwd,
        env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        tty: true,
        signal: options.signal
      }
    }
  });
  const resources = bridgeResourcesForRun(agentId, cwd, options.skills, options.hooks);
  try {
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
  } finally {
    cleanupResourcesForRun(resources);
  }
}
