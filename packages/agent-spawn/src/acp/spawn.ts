import { spawn as spawnChildProcess } from "node:child_process";
import { getAdapter } from "../adapters/index.js";
import type { AcpEvent } from "./types.js";
import { readLines } from "./line-reader.js";
import { resolveConfig } from "../configs/resolve-config.js";
import { getMcpArgs } from "../mcp-args.js";
import { stripModelNamespace } from "../model-utils.js";
import type { SpawnOptions, SpawnResult } from "../types.js";

function createAbortError(): Error {
  const error = new Error("Agent spawn aborted");
  error.name = "AbortError";
  return error;
}

export interface SpawnStreamingOptions extends SpawnOptions {
  agentId: string;
  spawnImpl?: typeof spawnChildProcess;
}

export interface SpawnStreamingResult {
  events: AsyncIterable<AcpEvent>;
  done: Promise<SpawnResult>;
}

function isAcpEvent(value: unknown): value is AcpEvent {
  return !!value && typeof value === "object" && "event" in value;
}

export function spawnStreaming(options: SpawnStreamingOptions): SpawnStreamingResult {
  if (options.signal?.aborted) {
    throw createAbortError();
  }

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

  const mcpArgs = getMcpArgs(spawnConfig, options.mcpServers);
  const args: string[] = [];

  if (spawnConfig.mcpArgsBeforeCommand) {
    args.push(...mcpArgs);
  }

  args.push(spawnConfig.promptFlag);

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

  if (!spawnConfig.mcpArgsBeforeCommand) {
    args.push(...mcpArgs);
  }

  const mode = options.mode ?? "yolo";
  args.push(...spawnConfig.modes[mode]);

  if (useStdin) {
    args.push(...spawnConfig.stdinMode!.extraArgs);
  }

  if (options.args && options.args.length > 0) {
    args.push(...options.args);
  }

  const spawnImpl = options.spawnImpl ?? spawnChildProcess;
  const child = spawnImpl(binaryName, args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    child.kill("SIGTERM");
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const result: SpawnResult = { stdout: "", stderr: "", exitCode: 1 };
  const done = new Promise<SpawnResult>((resolve, reject) => {
    let settled = false;
    const settleRejected = (error: Error) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    };
    const settleResolved = (code: number | null) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      result.exitCode = code ?? 1;
      resolve(result);
    };

    child.once("error", (error) => {
      if (aborted) {
        settleRejected(createAbortError());
        return;
      }
      settleRejected(error);
    });

    child.once("close", (code) => {
      if (aborted) {
        settleRejected(createAbortError());
        return;
      }
      settleResolved(code);
    });

    if (typeof child.exitCode === "number") {
      queueMicrotask(() => {
        if (aborted) {
          settleRejected(createAbortError());
          return;
        }
        settleResolved(child.exitCode);
      });
    }
  });

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
      yield output;
    }
  })();

  return { events, done };
}
