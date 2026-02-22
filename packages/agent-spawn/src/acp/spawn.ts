import { spawn as spawnChildProcess } from "node:child_process";
import { getAdapter } from "../adapters/index.js";
import type { AcpEvent } from "./types.js";
import { readLines } from "./line-reader.js";
import { resolveConfig } from "../configs/resolve-config.js";
import { getMcpArgs } from "../mcp-args.js";
import { stripModelNamespace } from "../model-utils.js";
import type { SpawnOptions, SpawnResult, SpawnUsage } from "../types.js";

export interface SpawnStreamingOptions extends SpawnOptions {
  agentId: string;
}

export interface SpawnStreamingResult {
  events: AsyncIterable<AcpEvent>;
  done: Promise<SpawnResult>;
}

function isAcpEvent(value: unknown): value is AcpEvent {
  return !!value && typeof value === "object" && "event" in value;
}

function captureUsage(event: AcpEvent): SpawnUsage | undefined {
  if (event.event !== "usage") return;
  const usage = event as Partial<SpawnUsage>;

  const inputTokens = typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
  const outputTokens = typeof usage.outputTokens === "number" ? usage.outputTokens : 0;
  const cachedTokens = typeof usage.cachedTokens === "number" ? usage.cachedTokens : undefined;
  const costUsd = typeof usage.costUsd === "number" ? usage.costUsd : undefined;

  return { inputTokens, outputTokens, cachedTokens, costUsd };
}

export function spawnStreaming(options: SpawnStreamingOptions): SpawnStreamingResult {
  const { agentId, binaryName, spawnConfig } = resolveConfig(options.agentId);

  if (spawnConfig === undefined) {
    throw new Error(`Agent "${agentId}" has no spawn config.`);
  }

  if (spawnConfig.kind !== "cli") {
    throw new Error(`Agent "${agentId}" does not support CLI spawn.`);
  }

  if (!binaryName) {
    throw new Error(`Agent "${agentId}" has no binaryName.`);
  }

  const args: string[] = [spawnConfig.promptFlag];

  const useStdin = !!options.useStdin && !!spawnConfig.stdinMode;
  if (!useStdin || !spawnConfig.stdinMode?.omitPrompt) {
    args.push(options.prompt);
  }

  if (options.model && spawnConfig.modelFlag) {
    let model = spawnConfig.modelStripProviderPrefix
      ? stripModelNamespace(options.model)
      : options.model;
    if (spawnConfig.modelTransform) model = spawnConfig.modelTransform(model);
    args.push(spawnConfig.modelFlag, model);
  }

  args.push(...spawnConfig.defaultArgs);
  args.push(...getMcpArgs(spawnConfig, options.mcpServers));

  const mode = options.mode ?? "yolo";
  args.push(...spawnConfig.modes[mode]);

  if (useStdin) {
    args.push(...spawnConfig.stdinMode!.extraArgs);
  }

  if (options.args && options.args.length > 0) {
    args.push(...options.args);
  }

  const child = spawnChildProcess(binaryName, args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"]
  });

  const result: SpawnResult = { stdout: "", stderr: "", exitCode: 1 };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    result.stderr += chunk;
  });

  if (useStdin) {
    child.stdin.write(options.prompt);
  }
  child.stdin.end();

  const adapter = getAdapter(spawnConfig.adapter);

  const events: AsyncIterable<AcpEvent> = (async function* () {
    for await (const output of adapter(readLines(child.stdout))) {
      if (!isAcpEvent(output)) continue;

      if (output.event === "session_start") {
        const maybeThreadId = (output as { threadId?: unknown }).threadId;
        if (typeof maybeThreadId === "string" && maybeThreadId.length > 0) {
          result.threadId = maybeThreadId;
          result.sessionId = maybeThreadId;
        }
      }

      const maybeUsage = captureUsage(output);
      if (maybeUsage) {
        result.usage = maybeUsage;
      }

      yield output;
    }
  })();

  const done = new Promise<SpawnResult>((resolve, reject) => {
    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      result.exitCode = code ?? 1;
      resolve(result);
    });
  });

  return { events, done };
}
