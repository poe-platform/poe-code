import { spawn as spawnChildProcess } from "node:child_process";
import { resolveConfig } from "./configs/resolve-config.js";
import { stripModelNamespace } from "./model-utils.js";
import type { SpawnOptions, SpawnResult } from "./types.js";

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

  if (options.prompt) {
    if (interactive.promptFlag) {
      args.push(interactive.promptFlag, options.prompt);
    } else {
      args.push(options.prompt);
    }
  }

  if (options.model && spawnConfig.modelFlag) {
    args.push(spawnConfig.modelFlag, stripModelNamespace(options.model));
  }

  args.push(...interactive.defaultArgs);

  const mode = options.mode ?? "yolo";
  args.push(...spawnConfig.modes[mode]);

  if (options.args && options.args.length > 0) {
    args.push(...options.args);
  }

  const child = spawnChildProcess(resolved.binaryName, args, {
    cwd: options.cwd,
    stdio: "inherit"
  });

  return new Promise<SpawnResult>((resolve, reject) => {
    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        stdout: "",
        stderr: "",
        exitCode: code ?? 1
      });
    });
  });
}
