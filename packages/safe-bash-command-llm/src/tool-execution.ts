import {LlmPluginExit} from "./loader-provider.js";
import type { CommandContext, FileSystem } from "safe-bash-contracts";
import { inheritYieldCheckpoint, yieldTurn } from "safe-bash-contracts/yield";
import { sourceBytes, waitForSource } from "./request-source.js";
import { referenceJson } from "./reference-json.js";
import { validateJsonData } from "./json-data.js";
import { validateAttachmentUrl } from "./url-attachment.js";
import type {
  LlmTool,
  LlmToolCall,
  LlmOption,
  LlmInputSource,
  LlmSourceAttachment
} from "./types.js";

export interface LlmToolContext {
  readonly fs: FileSystem;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly capabilities?: CommandContext["capabilities"];
  /** Remaining output admission. Implementations own pre-return acquisition. */
  readonly maxBytes: number;
}
export type LlmToolOutput = (
  | { readonly output: LlmOption; readonly source?: never }
  | { readonly source: LlmInputSource; readonly output?: never }
) & { readonly attachments?: readonly LlmSourceAttachment[] };
export interface LlmExecutableTool extends LlmTool {
  /** Shared runtime preparation runs once per distinct hook, before approvals.
   * The runtime owns per-instance initialization and retirement. */
  readonly prepare?: (context: LlmToolContext, mode: {readonly async: boolean}) => void | PromiseLike<void>;
  /** Declared coroutine, eligible for concurrent execution in async mode.
   * Promise-returning synchronous implementations leave this unset. */
  readonly async?: boolean;
  readonly implementation?: (
    args: Readonly<Record<string, LlmOption>>,
    context: LlmToolContext
  ) => LlmToolOutput | PromiseLike<LlmToolOutput>;
}
export interface LlmToolExecutionResult {
  readonly call: LlmToolCall;
  readonly output: LlmInputSource;
  readonly attachments: readonly LlmSourceAttachment[];
  readonly executed: boolean;
  readonly exception?: unknown;
}
export interface LlmToolExecutionOptions {
  /** Pinned AsyncResponse semantics; default is serial Response execution. */
  readonly async?: boolean;
  readonly tools: readonly LlmExecutableTool[];
  readonly calls: readonly LlmToolCall[];
  readonly context: Omit<LlmToolContext, "maxBytes">;
  readonly maxOutputBytes?: number;
  readonly beforeCall?: (
    tool: LlmExecutableTool | undefined,
    call: LlmToolCall,
    context: LlmToolContext
  ) => void | PromiseLike<void>;
}
/** Throw only from beforeCall to decline this call and continue the batch. */
export class LlmCancelToolCall extends Error {}

async function* outputBytes(output: LlmOption, signal: AbortSignal): AsyncIterable<Uint8Array> {
  if (typeof output !== "string") {
    yield* referenceJson(output, signal);
    return;
  }
  const encoder = new TextEncoder();
  for (let offset = 0; offset < output.length; ) {
    signal.throwIfAborted();
    let end = Math.min(output.length, offset + 4096);
    const last = output.charCodeAt(end - 1);
    if (end < output.length && last >= 0xd800 && last <= 0xdbff) end--;
    yield encoder.encode(output.slice(offset, end));
    offset = end;
  }
}

/** Execute using pinned Response/AsyncResponse semantics. Each result is
 * borrowed only during visit; stage it in caller storage if needed later. In
 * async mode visitors may overlap and run in completion order; the second
 * argument is the original call index for host-owned ordered staging. No
 * result payloads, conversation, response list or history are retained. */
export async function executeLlmToolCalls(
  options: LlmToolExecutionOptions,
  visit: (result: LlmToolExecutionResult, index: number) => void | PromiseLike<void>
): Promise<void> {
  const limit = options.maxOutputBytes ?? Infinity;
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0))
    throw new RangeError("Invalid tool output byte limit");
  const controller = new AbortController();
  const signal = options.async ? AbortSignal.any([options.context.signal, controller.signal]) : options.context.signal;
  inheritYieldCheckpoint(options.context.signal, signal);
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  let size = 0;
  const context: LlmToolContext = {
    ...options.context,
    signal,
    get maxBytes() {
      return limit - size;
    }
  };
  const execute = async (call: LlmToolCall, index: number): Promise<void> => {
    const tool = tools.get(call.name);
    let closed = false,
      failed = false,
      cleanup: Promise<void> | undefined;
    const resources = new Map<
      LlmInputSource,
      { lease: LlmInputSource; dispose: () => Promise<void> }
    >();
    const own = (source: LlmInputSource): LlmInputSource => {
      const existing = resources.get(source);
      if (existing) return existing.lease;
      let disposal: Promise<void> | undefined,
        read = false;
      const dispose = (): Promise<void> =>
        (disposal ??= Promise.resolve().then(() => source.dispose()));
      const lease: LlmInputSource = {
        dispose,
        bytes: {
          async *[Symbol.asyncIterator]() {
            if (closed || disposal || read)
              throw new Error("Tool result lease is closed or already consumed");
            read = true;
            let steps = 0;
            for await (const bytes of sourceBytes(source.bytes, signal)) {
              if (++steps % 256 === 0) await yieldTurn(signal);
              if (closed || disposal) throw new Error("Tool result lease is closed");
              if (bytes.length > limit - size)
                throw new RangeError("Tool output byte limit exceeded");
              size += bytes.length;
              for (let offset = 0; offset < bytes.length; offset += 16384) {
                if (++steps % 256 === 0) await yieldTurn(signal);
                signal.throwIfAborted();
                if (closed || disposal) throw new Error("Tool result lease is closed");
                yield Uint8Array.from(bytes.subarray(offset, offset + 16384));
              }
            }
          }
        }
      };
      resources.set(source, { lease, dispose });
      if (closed) void dispose().catch(() => undefined);
      return lease;
    };
    const close = (): Promise<void> => {
      closed = true;
      return (cleanup ??= Promise.allSettled(
        Array.from(resources.values(), (resource) => resource.dispose())
      ).then((results) => {
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason;
      }));
    };
    const abort = (): void => {
      void close().catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      let exception: unknown,
        output: LlmToolOutput | undefined,
        executed = false;
      try {
        await waitForSource(
          () => Promise.resolve(options.beforeCall?.(tool, call, context)),
          signal
        );
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof LlmCancelToolCall)) throw error;
        exception = error;
        output = { output: "Cancelled: " + error.message };
      }
      if (!output && !tool) {
        const error = new Error(`tool "${call.name}" does not exist`);
        exception = error;
        output = { output: "Error: " + error.message };
      }
      if (!output) {
        if (!tool!.implementation)
          throw new Error(`No implementation available for tool: ${call.name}`);
        executed = true;
        try {
          if (
            !call.arguments ||
            typeof call.arguments !== "object" ||
            Array.isArray(call.arguments)
          )
            throw new TypeError("Tool arguments must be a JSON object");
          validateJsonData(call.arguments, "Tool arguments must be finite JSON data");
          const pending = Promise.resolve()
            .then(() => {
              signal.throwIfAborted();
              return tool!.implementation!(
                call.arguments as Readonly<Record<string, LlmOption>>,
                context
              );
            })
            .then((value) => {
              // Adopt before validation so malformed and late results cannot leak leases.
              if (value?.source) own(value.source);
              if (Array.isArray(value?.attachments))
                for (const attachment of value.attachments)
                  if (attachment?.source) own(attachment.source);
              return value;
            });
          output = await waitForSource(() => pending, signal);
          if (!output || typeof output !== "object" || "source" in output === "output" in output)
            throw new TypeError("Invalid tool output");
          if ("output" in output)
            validateJsonData(output.output, "Tool output must be finite JSON data");
          if (
            "source" in output &&
            (!output.source ||
              typeof output.source.dispose !== "function" ||
              typeof output.source.bytes?.[Symbol.asyncIterator] !== "function")
          )
            throw new TypeError("Invalid tool output source");
        } catch (error) {
          signal.throwIfAborted();
          if(error instanceof LlmPluginExit)throw error;
          exception = error;
          output = { output: "Error: " + (error instanceof Error ? error.message : String(error)) };
        }
      }
      const attachments: LlmSourceAttachment[] = [];
      if (output.attachments !== undefined && !Array.isArray(output.attachments))
        throw new TypeError("Invalid tool attachments");
      for (const attachment of output.attachments ?? []) {
        if (
          !attachment ||
          typeof attachment.mimeType !== "string" ||
          !attachment.mimeType ||
          (attachment.id !== undefined && typeof attachment.id !== "string")
        )
          throw new TypeError("Invalid tool attachment");
        if (attachment.url !== undefined) {
          if (attachment.source !== undefined) throw new TypeError("Invalid tool attachment");
          validateAttachmentUrl(attachment.url);
          attachments.push(attachment);
        } else {
          if (
            !attachment.source ||
            typeof attachment.source.dispose !== "function" ||
            typeof attachment.source.bytes?.[Symbol.asyncIterator] !== "function"
          )
            throw new TypeError("Invalid tool attachment source");
          attachments.push({ ...attachment, source: own(attachment.source) });
        }
      }
      const source = output.source ?? {
        bytes: outputBytes(output.output!, signal),
        async dispose() {}
      };
      await waitForSource(
        () =>
          Promise.resolve(
            visit({
              call,
              output: own(source),
              attachments,
              executed,
              ...(exception === undefined ? {} : { exception })
            }, index)
          ),
        signal
      );
    } catch (error) {
      failed = true;
      throw signal.aborted ? signal.reason : error;
    } finally {
      signal.removeEventListener("abort", abort);
      await close().catch((error) => {
        if (!failed && !signal.aborted) throw error;
      });
    }
  };
  const pending: Promise<void>[] = [];
  let failure: unknown, failed = false;
  const fail = (error: unknown): void => {
    if (!failed) { failed = true; failure = error; controller.abort(error); }
  };
  try {
    const preparations = new Set([...tools.values()].map(tool => tool.prepare).filter(prepare => prepare !== undefined));
    for (const prepare of preparations) {
      await waitForSource(async () => prepare(context, {async: options.async ?? false}), signal);
    }
    for (let index = 0; index < options.calls.length; index++) {
      await yieldTurn(signal);
      const call = options.calls[index]!;
      const tool = tools.get(call.name);
      // The pinned AsyncResponse omits these calls, including both hooks.
      if (options.async && !tool?.implementation) continue;
      if (options.async && tool?.async) {
        // Observe rejection immediately: a sibling must never remain blocked
        // on a source or visitor after the batch has already failed.
        pending.push(execute(call, index).catch(fail));
      } else await execute(call, index);
    }
  } catch (error) { fail(error); }
  await Promise.all(pending);
  if (failed) throw failure;
  signal.throwIfAborted();
}
