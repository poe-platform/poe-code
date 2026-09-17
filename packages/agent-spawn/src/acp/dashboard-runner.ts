import { createStreamingDashboardLineBuffer, type dashboard } from "toolcraft-design";
import { getSpawnConfig } from "../configs/index.js";
import { isActivityTimeoutError } from "../spawn.js";
import type { SpawnOptions, SpawnResult, SpawnUsage } from "../types.js";
import type { AcpEvent } from "./types.js";
import { streamAcpEventsToDashboard } from "./dashboard-stream.js";

/** Connect a host's normal spawn path to the shared conversation view. */
export function createDashboardAgentRunner(options: {
  spawn(agent: string, options: SpawnOptions & { captureSession: false }): {
    events: AsyncIterable<AcpEvent>;
    result: Promise<SpawnResult>;
  };
  onOutput(item: dashboard.OutputItem): void;
  onActivity?(activity: string | undefined): void;
  /** Usage deltas; the final result reconciles any usage already observed in the stream. */
  onUsage?(usage: Pick<SpawnUsage, "inputTokens" | "outputTokens">): void;
  middlewares?: SpawnOptions["middlewares"];
  /** Total attempts on activity timeout, matching spawn.autonomous. Defaults to one. */
  maxTimeoutRetries?: number;
}) {
  const maxAttempts = options.maxTimeoutRetries ?? 1;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("maxTimeoutRetries must be an integer greater than or equal to 1.");
  }
  async function runAttempt(input: SpawnOptions & { agent: string }): Promise<SpawnResult> {
    const { agent, ...spawnOptions } = input;
    const config = getSpawnConfig(agent);
    const protocolStdout = config?.kind === "cli" && Boolean(config.adapter);
    let sawStdout = false;
    let sawStderr = false;
    let tokensIn = 0;
    let tokensOut = 0;
    const toolBuffer = createStreamingDashboardLineBuffer((text, id) => {
      options.onOutput({ id, kind: "info", role: "agent", text, ts: Date.now() });
    });
    const errorBuffer = createStreamingDashboardLineBuffer((text, id) => {
      options.onOutput({ id, kind: "error", role: "action", text, ts: Date.now() });
    });
    try {
      const { events, result } = options.spawn(agent, {
        ...spawnOptions,
        captureSession: false,
        activityTimeoutMs: input.activityTimeoutMs ?? 10 * 60 * 1000,
        ...(options.middlewares ? { middlewares: [...options.middlewares, ...(input.middlewares ?? [])] } : {}),
        tee: {
          stdout: { write(chunk) {
            input.tee?.stdout?.write(chunk);
            if (protocolStdout) return;
            sawStdout = true;
            toolBuffer.push(chunk);
          } },
          stderr: { write(chunk) {
            input.tee?.stderr?.write(chunk);
            sawStderr = true;
            errorBuffer.push(chunk);
          } }
        }
      });
      const streamed = streamAcpEventsToDashboard({
        events, signal: input.signal,
        onOutput: options.onOutput,
        onActivity: options.onActivity,
        onUsage(usage) {
          const inputTokens = Number.isFinite(usage.inputTokens) && usage.inputTokens >= 0 ? usage.inputTokens : 0;
          const outputTokens = Number.isFinite(usage.outputTokens) && usage.outputTokens >= 0 ? usage.outputTokens : 0;
          tokensIn += inputTokens;
          tokensOut += outputTokens;
          options.onUsage?.({ inputTokens, outputTokens });
        }
      });
      const [spawned, stream] = await Promise.allSettled([result, streamed]);
      if (spawned.status === "rejected") throw spawned.reason;
      if (stream.status === "rejected") throw stream.reason;
      if (!stream.value && !sawStdout && spawned.value.stdout) toolBuffer.push(spawned.value.stdout);
      if (!sawStderr && spawned.value.stderr) errorBuffer.push(spawned.value.stderr);
      if (spawned.value.usage) {
        options.onUsage?.({ inputTokens: spawned.value.usage.inputTokens - tokensIn, outputTokens: spawned.value.usage.outputTokens - tokensOut });
      }
      return spawned.value;
    } finally {
      toolBuffer.flush();
      errorBuffer.flush();
      options.onActivity?.(undefined);
    }
  }
  return async (input: SpawnOptions & { agent: string }): Promise<SpawnResult> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await runAttempt(input);
      } catch (error) {
        if (input.signal?.aborted || !isActivityTimeoutError(error) || attempt >= maxAttempts) throw error;
        options.onOutput({ kind: "status", role: "action", text: `Agent timed out · retrying ${attempt + 1}/${maxAttempts}`, ts: Date.now() });
      }
    }
  };
}
