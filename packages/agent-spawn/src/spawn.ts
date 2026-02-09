import { spawn as spawnChildProcess } from "node:child_process";
import { resolveConfig } from "./configs/resolve-config.js";
import { stripModelNamespace } from "./model-utils.js";
import type { SpawnContext, SpawnMode, SpawnOptions, SpawnResult } from "./types.js";

export interface BuildSpawnArgsOptions {
  prompt: string;
  model?: string;
  mode?: SpawnMode;
  args?: string[];
}

export interface BuildSpawnArgsResult {
  binaryName: string;
  args: string[];
}

export function buildSpawnArgs(
  agentId: string,
  options: BuildSpawnArgsOptions
): BuildSpawnArgsResult {
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

  const args: string[] = [spawnConfig.promptFlag, options.prompt];

  if (options.model && spawnConfig.modelFlag) {
    args.push(spawnConfig.modelFlag, stripModelNamespace(options.model));
  }

  args.push(...spawnConfig.defaultArgs);

  const mode = options.mode ?? "yolo";
  args.push(...spawnConfig.modes[mode]);

  if (options.args && options.args.length > 0) {
    args.push(...options.args);
  }

  return { binaryName: resolved.binaryName, args };
}

export async function spawn(
  agentId: string,
  options: SpawnOptions,
  _context?: SpawnContext
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

  const stdinMode =
    options.useStdin && spawnConfig.stdinMode ? spawnConfig.stdinMode : undefined;

  let spawnArgs: string[];
  if (stdinMode) {
    spawnArgs = [
      spawnConfig.promptFlag,
      ...(stdinMode.omitPrompt ? [] : [options.prompt]),
      ...stdinMode.extraArgs
    ];

    if (options.model && spawnConfig.modelFlag) {
      spawnArgs.push(spawnConfig.modelFlag, stripModelNamespace(options.model));
    }

    spawnArgs.push(...spawnConfig.defaultArgs);

    const mode = options.mode ?? "yolo";
    spawnArgs.push(...spawnConfig.modes[mode]);

    if (options.args && options.args.length > 0) {
      spawnArgs.push(...options.args);
    }
  } else {
    spawnArgs = buildSpawnArgs(agentId, options).args;
  }

  const child = spawnChildProcess(resolved.binaryName, spawnArgs, {
    cwd: options.cwd,
    stdio: [stdinMode ? "pipe" : "inherit", "pipe", "pipe"]
  });

  if (!child.stdout || !child.stderr) {
    throw new Error(`Failed to spawn "${resolved.agentId}": missing stdio pipes.`);
  }

  const stdoutStream = child.stdout;
  const stderrStream = child.stderr;

  if (stdinMode) {
    if (!child.stdin) {
      throw new Error(`Failed to spawn "${resolved.agentId}": missing stdin pipe.`);
    }
    child.stdin.setDefaultEncoding("utf8");
    child.stdin.write(options.prompt);
    child.stdin.end();
  }

  return new Promise<SpawnResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    stdoutStream.setEncoding("utf8");
    stdoutStream.on("data", (chunk) => {
      stdout += chunk;
      if (options.tee?.stdout) options.tee.stdout.write(chunk);
    });

    stderrStream.setEncoding("utf8");
    stderrStream.on("data", (chunk) => {
      stderr += chunk;
      if (options.tee?.stderr) options.tee.stderr.write(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1
      });
    });
  });
}
