import { shellValueByteLength } from "safe-bash-contracts";
import { inheritYieldCheckpoint, yieldTurn } from "safe-bash-contracts/yield";
import type { LlmStreamEvent } from "./service.js";
import type { LlmInputSource } from "./types.js";
import { jsonValue } from "./json-value.js";
import { waitForSource } from "./request-source.js";
import {
  executeLlmToolCalls,
  type LlmToolExecutionOptions,
  type LlmToolExecutionResult
} from "./tool-execution.js";

export interface LlmToolChainOptions extends Omit<LlmToolExecutionOptions, "calls" | "maxOutputBytes"> {
  /** Open one response through the shared service. The host supplies all request
   * data and owns continuation state. Called only after all prior results have
   * been visited. Index is zero-based; use the supplied cancellation signal. */
  readonly openResponse: (index: number, signal: AbortSignal) => AsyncIterable<LlmStreamEvent>;
  /** Borrow each result during this callback; consume/stage leases before returning. */
  readonly visit: (result: LlmToolExecutionResult) => void | PromiseLike<void>;
  /** Pinned SDK default is 10 (the CLI uses 5). Zero/null disables this limit.
   * Use bigint for Python integers outside the JavaScript safe integer range. */
  readonly chainLimit?: number | bigint | null;
  /** Aggregate response text/bytes and tool-call controls, across all rounds. */
  readonly maxOutputBytes?: number;
  /** Aggregate consumed tool output and attachment bytes, across all rounds. */
  readonly maxToolOutputBytes?: number;
}

/** Serial pinned chain ordering without a retained response/conversation list.
 * The consumer observes response events before tool execution; returning early
 * aborts the current response and never executes its outstanding tools. */
export async function* streamLlmToolChain(options: LlmToolChainOptions): AsyncGenerator<LlmStreamEvent> {
  const chainLimit = options.chainLimit === undefined ? 10 : options.chainLimit;
  if (chainLimit !== null && typeof chainLimit !== "bigint" && !Number.isSafeInteger(chainLimit)) throw new RangeError("Invalid chain limit");
  const outputLimit = options.maxOutputBytes ?? Infinity;
  const toolLimit = options.maxToolOutputBytes ?? Infinity;
  for (const limit of [outputLimit, toolLimit])
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0)) throw new RangeError("Invalid chain byte limit");
  const controller = new AbortController();
  const signal = AbortSignal.any([options.context.signal, controller.signal]);
  inheritYieldCheckpoint(options.context.signal, signal);
  let outputBytes = 0, toolBytes = 0;
  const admit = (size: number): void => {
    if (size > outputLimit - outputBytes) throw new RangeError("LLM chain output byte limit exceeded");
    outputBytes += size;
  };
  const counted = (source: LlmInputSource): LlmInputSource => ({
    dispose: () => source.dispose(),
    bytes: { async *[Symbol.asyncIterator]() {
      for await (const bytes of source.bytes) { toolBytes += bytes.length; yield bytes; }
    } }
  });
  try {
    for (let index = 0; ; index++) {
      await yieldTurn(signal);
      const iterator = options.openResponse(index, signal)[Symbol.asyncIterator]();
      let ended = false;
      let events = 0;
      let response: Extract<LlmStreamEvent, {type: "response"}> | undefined;
      try {
        while (true) {
          if (++events % 256 === 0) await yieldTurn(signal);
          const next = await waitForSource(() => iterator.next(), signal);
          if (next.done) { ended = true; break; }
          const event = next.value;
          if (response) throw new Error("LLM response event must be final");
          if (event.type === "response") {
            response = event;
            if (event.response.toolCalls) for await (const bytes of jsonValue(event.response.toolCalls, signal)) admit(bytes.length);
            yield event;
          } else if (event.type === "text") {
            // Bound both encoding work and yielded pieces without materializing
            // an encoded copy of a potentially large provider string.
            for (let offset = 0; offset < event.text.length;) {
              await yieldTurn(signal);
              let end = Math.min(event.text.length, offset + 4096);
              const last = event.text.charCodeAt(end - 1);
              if (end < event.text.length && last >= 0xd800 && last <= 0xdbff) end--;
              const text = event.text.slice(offset, end);
              admit(shellValueByteLength(text));
              yield {type: "text", text};
              offset = end;
            }
          } else if (event.type === "bytes") {
            for (let offset = 0; offset < event.data.length; offset += 16384) {
              await yieldTurn(signal);
              const bytes = event.data.subarray(offset, offset + 16384);
              admit(bytes.length);
              yield {type: "bytes", data: Uint8Array.from(bytes)};
            }
          } else throw new TypeError("Invalid LLM stream event");
        }
      } finally {
        if (!ended) {
          controller.abort(new Error("LLM chain response closed"));
          // A pending provider read need not settle for cancellation to retire
          // its source leases. Service disposal listens to this signal.
          void Promise.resolve().then(() => iterator.return?.()).catch(() => undefined);
        }
      }
      signal.throwIfAborted();
      if (!response) throw new Error("LLM stream ended without response metadata");
      if (chainLimit && index + 1 >= chainLimit) throw new Error(`Chain limit of ${chainLimit} exceeded.`);
      const calls = response.response.toolCalls ?? [];
      if (!calls.length) return;
      await executeLlmToolCalls({
        tools: options.tools, calls, context: {...options.context, signal},
        maxOutputBytes: toolLimit - toolBytes,
        ...(options.beforeCall ? {beforeCall: options.beforeCall} : {})
      }, result => options.visit({
        ...result, output: counted(result.output),
        attachments: result.attachments.map(attachment => attachment.source
          ? {...attachment, source: counted(attachment.source)} : attachment)
      }));
    }
  } finally {
    controller.abort(new Error("LLM chain closed"));
  }
}
