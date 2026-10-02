import { interruptible } from "safe-bash-contracts/runtime-control";
import type { CallToolParams, CallToolResult, ProgressParams } from "tiny-mcp-client";
import { withRemoteMcpClient } from "./remote.js";
import type { RemoteMcpServer, SchemaFetchOptions } from "./schema.js";

/** Invocation-local identity. No arguments, headers, endpoint credentials or result data. */
export interface RemoteMcpToolInvocation {
  readonly invocationId: string;
  readonly serverName: string;
  readonly toolName: string;
  readonly signal: AbortSignal;
}

export type RemoteMcpToolProgress = Omit<ProgressParams, "progressToken">;

export interface RemoteMcpToolLifecycleOptions {
  /** Runs after input validation and connection setup, before invoking tools/call. */
  readonly onToolStart?: (invocation: RemoteMcpToolInvocation) => void | Promise<void>;
  readonly onToolProgress?: (progress: RemoteMcpToolProgress, invocation: RemoteMcpToolInvocation) => void | Promise<void>;
  readonly maxProgressEvents?: number;
  readonly maxProgressMessageBytes?: number;
}

/** Observer failures cancel this invocation; a dispatched operation is never retried. */
export async function callCommandTool(
  server: RemoteMcpServer,
  params: CallToolParams,
  options: SchemaFetchOptions & RemoteMcpToolLifecycleOptions & { readonly signal: AbortSignal }
): Promise<CallToolResult> {
  if (options.onToolStart === undefined && options.onToolProgress === undefined)
    return withRemoteMcpClient(server, options, client => client.callTool(params, { signal: options.signal }));
  const controller = new AbortController();
  const signals = [options.signal, controller.signal];
  if (options.requestTimeoutMs !== undefined && options.requestTimeoutMs !== Infinity)
    signals.push(AbortSignal.timeout(options.requestTimeoutMs));
  const signal = AbortSignal.any(signals);
  const invocation: RemoteMcpToolInvocation = Object.freeze({
    invocationId: Array.from(crypto.getRandomValues(new Uint32Array(4)), word => word.toString(16).padStart(8, "0")).join(""),
    serverName: server.name, toolName: params.name, signal
  });
  let events = 0;
  const observe = async (callback: () => void | Promise<void>): Promise<void> => {
    signal.throwIfAborted();
    try { await interruptible(Promise.resolve(callback()), signal); }
    catch {
      if (!signal.aborted) controller.abort(new Error("MCP tool lifecycle callback failed"));
      signal.throwIfAborted();
    }
    signal.throwIfAborted();
  };
  const onProgress = options.onToolProgress === undefined ? undefined : async (params: ProgressParams) => {
    if (signal.aborted || params.progressToken !== invocation.invocationId) return;
    if (!Number.isFinite(params.progress) || params.progress < 0 ||
      (params.total !== undefined && (!Number.isFinite(params.total) || params.total < 0))) return;
    const maxMessageBytes = options.maxProgressMessageBytes ?? Infinity;
    if (++events > (options.maxProgressEvents ?? Infinity) ||
      (params.message !== undefined && (params.message.length > maxMessageBytes || new TextEncoder().encode(params.message).byteLength > maxMessageBytes))) {
      controller.abort(new Error("MCP tool progress limit exceeded"));
      return;
    }
    await observe(() => options.onToolProgress!({ progress: params.progress,
      ...(params.total === undefined ? {} : { total: params.total }),
      ...(params.message === undefined ? {} : { message: params.message }) }, invocation));
  };
  try {
    return await withRemoteMcpClient(server, { ...options, signal, onProgress }, async client => {
      if (options.onToolStart !== undefined) await observe(() => options.onToolStart!(invocation));
      signal.throwIfAborted();
      const result = await client.callTool(params, { signal,
        ...(onProgress === undefined ? {} : { progressToken: invocation.invocationId }) });
      signal.throwIfAborted();
      return result;
    });
  } finally { controller.abort(new Error("MCP tool invocation finished")); }
}
