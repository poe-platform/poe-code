import {
  applyHookDecision,
  createPostIterationHookContext,
  createPostToolUseHookContext,
  createPreIterationHookContext,
  createPreToolUseHookContext,
  createSessionStartHookContext,
  createStopHookContext,
  createUserPromptSubmitHookContext,
  dispatchHook,
  AbortError
} from "./hooks.js";
import { recordToolFileAwareness } from "./file-awareness.js";
import type { HookContextByEvent, HookEvent, ProviderStreamEvent } from "./plugin-types.js";
import type { RunContext } from "./run-context.js";
import { estimateMessageContentSize, toToolMessageContent } from "./tool-results.js";
import type {
  AcpEvent,
  AcpHost,
  ChatMessage,
  ForkResult,
  RunResult,
  ToolResultPart,
  ToolAckResult,
  ToolCallRecord,
  ToolIntent,
  UsageInfo
} from "./types.js";

export type AcpModelToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type AcpModelResponse = {
  events: AsyncIterable<ProviderStreamEvent>;
};

export type AcpModelRequestMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ToolResultPart[];
  reasoning_content?: string;
  reasoning?: string;
  thinking?: Array<{
    text: string;
    signature?: string;
  }>;
  redacted_thinking?: Array<{
    data: string;
  }>;
  reasoning_details?: unknown[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

export type AcpModel = {
  complete(request: {
    messages: AcpModelRequestMessage[];
    tools: AcpModelToolDefinition[];
    signal: AbortSignal;
  }): Promise<AcpModelResponse>;
};

export type RunAcpCoreOptions = {
  prompt: string;
  runContext: RunContext;
  host: AcpHost;
  model: AcpModel;
  baseSystemPrompt?: string;
  maxIterations?: number;
  signal?: AbortSignal;
  onPromptSubmitted?(prompt: string): void | Promise<void>;
  disposeRun?(): void | Promise<void>;
};

type AsyncResolver<T> = (result: IteratorResult<T>) => void;

type MutableToolOutcome = {
  intentId: string;
  tool: string;
  args: unknown;
  result?: unknown;
  error?: string;
};

type NormalizedModelToolCall = {
  intentId: string;
  tool: string;
  args: unknown;
  rawArguments?: string;
  intentEmitted: boolean;
};

type ModelToolError = {
  intentId: string;
  tool: string;
  args: unknown;
  error: string;
};

type StreamToolOutcome =
  | {
      type: "complete";
      toolCall: NormalizedModelToolCall;
    }
  | {
      type: "error";
      error: ModelToolError;
    };

type CollectedModelResponse = {
  content: string;
  reasoningContent?: string;
  reasoning?: string;
  thinking?: ChatMessage["thinking"];
  redactedThinking?: ChatMessage["redacted_thinking"];
  reasoningDetails?: unknown[];
  toolOutcomes: StreamToolOutcome[];
  usage?: UsageInfo;
  stopReason?: Extract<ProviderStreamEvent, { type: "stop" }>["reason"];
};

type PendingToolUse = {
  intentId: string;
  tool?: string;
  argsDelta: string;
  intentEmitted: boolean;
};

class AsyncEventQueue<T> implements AsyncIterableIterator<T> {
  readonly #items: T[] = [];
  readonly #resolvers: AsyncResolver<T>[] = [];
  #closed = false;

  constructor(readonly onReturn: () => void) {}

  push(item: T): void {
    if (this.#closed) {
      return;
    }

    const resolver = this.#resolvers.shift();
    if (resolver) {
      resolver({ done: false, value: item });
      return;
    }

    this.#items.push(item);
  }

  close(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    while (this.#resolvers.length > 0) {
      const resolver = this.#resolvers.shift();
      if (!resolver) {
        continue;
      }
      resolver({ done: true, value: undefined as never });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.#items.length > 0) {
      const value = this.#items.shift() as T;
      return { done: false, value };
    }

    if (this.#closed) {
      return { done: true, value: undefined as never };
    }

    return new Promise<IteratorResult<T>>((resolve) => {
      this.#resolvers.push(resolve);
    });
  }

  async return(): Promise<IteratorResult<T>> {
    this.onReturn();
    this.close();
    return { done: true, value: undefined as never };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

export function runAcpCore(options: RunAcpCoreOptions): AsyncIterable<AcpEvent> {
  const events = new AsyncEventQueue<AcpEvent>(() => {
    options.runContext.abortController.abort();
  });

  void execute(options, events);

  return events;
}

async function execute(
  options: RunAcpCoreOptions,
  events: AsyncEventQueue<AcpEvent>
): Promise<void> {
  const signal = wireAbortSignal(options.signal, options.runContext.abortController);
  const cleanupAbortSignal = signal.cleanup;
  const toolCalls: ToolCallRecord[] = [];

  let terminalEmitted = false;
  const baseDisposeRun = options.disposeRun ?? (() => options.runContext.dispose());
  let disposed = false;
  let stopHookRan = false;
  const disposeRun = async (): Promise<void> => {
    if (disposed) {
      return;
    }

    await baseDisposeRun();
    disposed = true;
  };

  const emit = (event: AcpEvent): void => {
    if (terminalEmitted) {
      return;
    }

    events.push(event);
  };
  options.host.setEmit?.(emit);

  const emitTerminal = (event: AcpEvent): void => {
    if (terminalEmitted) {
      return;
    }

    terminalEmitted = true;
    events.push(event);
    events.close();
  };

  const runStopHook = async (context: {
    status: "completed" | "error";
    output?: string;
    error?: Error;
  }): Promise<void> => {
    stopHookRan = true;

    const stopContext = createStopHookContext({
      ...context,
      toolCalls,
      messages: options.runContext.messages,
      signal: signal.value,
      disposeRun
    });
    const stopDecision = await options.runContext.hooks.run("stop", stopContext);
    await applyHookDecision("stop", stopDecision, stopContext);
  };

  try {
    const result = await runLoop({
      ...options,
      signal: signal.value,
      emit,
      disposeRun,
      toolCalls
    });
    await runStopHook({
      status: "completed",
      output: result.output
    });

    await disposeRun();
    emitTerminal({
      type: "session.complete",
      result: {
        ...result,
        messages: [...options.runContext.messages],
        toolCalls: [...toolCalls]
      }
    });
  } catch (error) {
    let finalError = toError(error);

    if (!stopHookRan) {
      try {
        await runStopHook({
          status: "error",
          error: finalError
        });
      } catch (stopError) {
        finalError = new AggregateError(
          [finalError, toError(stopError)],
          "Run failed and stop hook failed."
        );
      }
    }

    try {
      await disposeRun();
    } catch (disposeError) {
      finalError = new AggregateError(
        [finalError, disposeError],
        "Run failed and disposal failed."
      );
    }

    emitTerminal({ type: "session.error", error: finalError });
  } finally {
    cleanupAbortSignal();
    events.close();
  }
}

async function runLoop(
  options: RunAcpCoreOptions & {
    signal: AbortSignal;
    emit(event: AcpEvent): void;
    toolCalls: ToolCallRecord[];
  }
): Promise<RunResult> {
  assertNotAborted(options.signal);

  let prompt = options.prompt;
  let iterationNumber = 0;

  const sessionStartContext = createSessionStartHookContext({
    session: options.runContext.session,
    messages: options.runContext.messages,
    signal: options.signal,
    disposeRun: options.disposeRun
  });
  const sessionStartDecision = await options.runContext.hooks.run(
    "sessionStart",
    sessionStartContext
  );
  await applyHookDecision("sessionStart", sessionStartDecision, sessionStartContext);

  const promptMessage: ChatMessage = {
    role: "user",
    content: prompt
  };
  options.runContext.messages.push(promptMessage);

  const userPromptContext = createUserPromptSubmitHookContext({
    prompt,
    messages: options.runContext.messages,
    signal: options.signal,
    disposeRun: options.disposeRun
  });
  const userPromptDecision = await options.runContext.hooks.run(
    "userPromptSubmit",
    userPromptContext
  );
  const userPromptDispatch = await applyHookDecision(
    "userPromptSubmit",
    userPromptDecision,
    userPromptContext
  );
  prompt = syncSubmittedUserPrompt(promptMessage, prompt, userPromptContext.prompt);
  await options.onPromptSubmitted?.(prompt);
  if (userPromptDispatch.type === "handled") {
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: userPromptDispatch.response
    };
    options.runContext.messages.push(assistantMessage);
    if (userPromptDispatch.response.length > 0) {
      options.emit({
        type: "message.delta",
        content: userPromptDispatch.response
      });
    }
    return {
      output: userPromptDispatch.response,
      stdout: userPromptDispatch.response,
      summary: userPromptDispatch.response,
      messages: [...options.runContext.messages],
      toolCalls: [...options.toolCalls],
      exitCode: 0,
      stderr: ""
    };
  }

  while (true) {
    assertNotAborted(options.signal);

    iterationNumber += 1;

    if (options.maxIterations !== undefined && iterationNumber > options.maxIterations) {
      throw new AbortError("Maximum tool call iterations reached.");
    }

    const preIterationContext = createPreIterationHookContext({
      iterationNumber,
      tokenCount: estimateTokenCount(options.runContext.messages),
      messages: options.runContext.messages,
      signal: options.signal,
      fork: createForkRunner({
        host: options.host,
        emit: options.emit,
        messages: options.runContext.messages,
        toolCalls: options.toolCalls
      }),
      complete: createIterationCompleteRunner({
        model: options.model,
        signal: options.signal
      }),
      runHook: createIterationHookRunner({
        runContext: options.runContext,
        disposeRun: options.disposeRun
      }),
      fileAwareness: options.runContext.fileAwareness.snapshot(),
      disposeRun: options.disposeRun
    });
    const preIterationDecision = await options.runContext.hooks.run(
      "preIteration",
      preIterationContext
    );
    const preIterationDispatch = await applyHookDecision(
      "preIteration",
      preIterationDecision,
      preIterationContext
    );

    if (preIterationDispatch.type === "skip") {
      await runPostIterationHooks({
        runContext: options.runContext,
        model: options.model,
        signal: options.signal,
        iterationNumber,
        toolCalls: options.toolCalls,
        host: options.host,
        emit: options.emit,
        disposeRun: options.disposeRun
      });
      continue;
    }

    const compiledPrompt = await options.runContext.prompts.compile(
      prompt,
      options.baseSystemPrompt
    );

    const response = await options.model.complete({
      messages: toModelRequestMessages(options.runContext.messages, compiledPrompt.system),
      tools: options.runContext.tools
        .getActiveTools(options.runContext.activeSkills)
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        })),
      signal: options.signal
    });

    const collectedResponse = await collectModelResponseEvents({
      response,
      emit: options.emit
    });

    if (collectedResponse.stopReason === "error") {
      throw new Error("Model response failed.");
    }
    if (collectedResponse.stopReason === "max_tokens") {
      throw new Error("Model response exceeded the maximum token limit.");
    }

    if (collectedResponse.usage) {
      options.emit({
        type: "usage",
        usage: collectedResponse.usage
      });
    }

    options.runContext.messages.push(createAssistantMessage(collectedResponse));

    for (const toolOutcome of collectedResponse.toolOutcomes) {
      assertNotAborted(options.signal);

      if (toolOutcome.type === "error") {
        await emitToolExecutionError({
          ...toolOutcome.error,
          runContext: options.runContext,
          emit: options.emit,
          toolCalls: options.toolCalls
        });
        continue;
      }

      await runSingleToolCall({
        toolCall: toolOutcome.toolCall,
        runContext: options.runContext,
        host: options.host,
        emit: options.emit,
        signal: options.signal,
        toolCalls: options.toolCalls,
        disposeRun: options.disposeRun
      });
    }

    await runPostIterationHooks({
      runContext: options.runContext,
      model: options.model,
      signal: options.signal,
      iterationNumber,
      toolCalls: options.toolCalls,
      host: options.host,
      emit: options.emit,
      disposeRun: options.disposeRun
    });

    if (collectedResponse.toolOutcomes.length === 0) {
      return {
        output: collectedResponse.content,
        stdout: collectedResponse.content,
        summary: collectedResponse.content,
        messages: [...options.runContext.messages],
        toolCalls: [...options.toolCalls],
        exitCode: 0,
        stderr: ""
      };
    }
  }
}

async function runSingleToolCall(options: {
  toolCall: NormalizedModelToolCall;
  runContext: RunContext;
  host: AcpHost;
  emit(event: AcpEvent): void;
  signal: AbortSignal;
  toolCalls: ToolCallRecord[];
  disposeRun?(): void | Promise<void>;
}): Promise<void> {
  const preToolContext = createPreToolUseHookContext({
    tool: options.toolCall.tool,
    args: options.toolCall.args,
    intentId: options.toolCall.intentId,
    session: options.runContext.session,
    messages: options.runContext.messages,
    signal: options.signal,
    disposeRun: options.disposeRun
  });

  const preToolDecision = await options.runContext.hooks.run("preToolUse", preToolContext);
  const preToolDispatch = await applyHookDecision("preToolUse", preToolDecision, preToolContext);

  const mutableOutcome: MutableToolOutcome = {
    intentId: preToolContext.intentId,
    tool: preToolContext.tool,
    args: preToolContext.args
  };

  if (preToolDispatch.type === "skip") {
    mutableOutcome.error = "Tool call skipped by preToolUse hook.";
  } else if (preToolDispatch.type === "tool_error") {
    mutableOutcome.error = preToolDispatch.error;
  } else {
    if (preToolDispatch.type === "rewrite") {
      mutableOutcome.args = preToolDispatch.args;
    }

    if (!options.toolCall.intentEmitted) {
      options.emit({
        type: "tool.intent",
        intentId: mutableOutcome.intentId,
        tool: mutableOutcome.tool,
        args: mutableOutcome.args
      });
    }

    const intent: ToolIntent = {
      intentId: mutableOutcome.intentId,
      tool: mutableOutcome.tool,
      args: mutableOutcome.args
    };

    const ack = await waitForToolAck({
      host: options.host,
      intent,
      signal: options.signal
    });

    if (ack.status === "success") {
      mutableOutcome.result = ack.result;
    } else {
      mutableOutcome.error = toToolErrorText(ack.result);
    }
  }

  const postToolContext = createPostToolUseHookContext({
    tool: mutableOutcome.tool,
    args: mutableOutcome.args,
    intentId: mutableOutcome.intentId,
    result: mutableOutcome.result,
    error: mutableOutcome.error,
    session: options.runContext.session,
    messages: options.runContext.messages,
    signal: options.signal,
    disposeRun: options.disposeRun
  });
  const postToolDecision = await options.runContext.hooks.run("postToolUse", postToolContext);
  const postToolDispatch = await applyHookDecision("postToolUse", postToolDecision, postToolContext);

  if (postToolDispatch.type === "replace") {
    if ("content" in postToolDispatch.patch) {
      postToolContext.result = postToolDispatch.patch.content;
    }
    if ("details" in postToolDispatch.patch) {
      postToolContext.result = postToolDispatch.patch.details;
    }
    if (postToolDispatch.patch.isError !== undefined) {
      postToolContext.error = postToolDispatch.patch.isError
        ? toToolErrorText(postToolContext.result)
        : undefined;
    }
  }

  if (postToolContext.error !== undefined) {
    mutableOutcome.error = postToolContext.error;
    mutableOutcome.result = undefined;
  } else {
    mutableOutcome.result = postToolContext.result;
    mutableOutcome.error = undefined;
  }

  if (mutableOutcome.error === undefined) {
    recordToolFileAwareness({
      tracker: options.runContext.fileAwareness,
      tool: mutableOutcome.tool,
      args: mutableOutcome.args
    });

    options.emit({
      type: "tool.result",
      intentId: mutableOutcome.intentId,
      result: mutableOutcome.result
    });

    options.runContext.messages.push({
      role: "tool",
      name: mutableOutcome.tool,
      toolCallId: mutableOutcome.intentId,
      content: toToolMessageContent(mutableOutcome.result)
    });

    options.toolCalls.push({
      intentId: mutableOutcome.intentId,
      tool: mutableOutcome.tool,
      args: mutableOutcome.args,
      status: "success",
      result: mutableOutcome.result
    });

    return;
  }

  await emitToolExecutionError({
    intentId: mutableOutcome.intentId,
    tool: mutableOutcome.tool,
    args: mutableOutcome.args,
    error: mutableOutcome.error,
    runContext: options.runContext,
    emit: options.emit,
    toolCalls: options.toolCalls
  });
}

async function runPostIterationHooks(options: {
  runContext: RunContext;
  model: AcpModel;
  signal: AbortSignal;
  iterationNumber: number;
  toolCalls: ToolCallRecord[];
  host: AcpHost;
  emit(event: AcpEvent): void;
  disposeRun?(): void | Promise<void>;
}): Promise<void> {
  const postIterationContext = createPostIterationHookContext({
    iterationNumber: options.iterationNumber,
    tokenCount: estimateTokenCount(options.runContext.messages),
    messages: options.runContext.messages,
    signal: options.signal,
    fork: createForkRunner({
      host: options.host,
      emit: options.emit,
      messages: options.runContext.messages,
      toolCalls: options.toolCalls
    }),
    complete: createIterationCompleteRunner({
      model: options.model,
      signal: options.signal
    }),
    runHook: createIterationHookRunner({
      runContext: options.runContext,
      disposeRun: options.disposeRun
    }),
    fileAwareness: options.runContext.fileAwareness.snapshot(),
    disposeRun: options.disposeRun
  });
  const postIterationDecision = await options.runContext.hooks.run(
    "postIteration",
    postIterationContext
  );
  await applyHookDecision("postIteration", postIterationDecision, postIterationContext);
}

type ForkRunnerOptions = {
  host: AcpHost;
  emit(event: AcpEvent): void;
  messages: ChatMessage[];
  toolCalls: ToolCallRecord[];
};

function createForkRunner(options: ForkRunnerOptions): (prompt: string) => Promise<ForkResult> {
  let sequence = 0;

  return async (prompt: string): Promise<ForkResult> => {
    sequence += 1;
    const forkId = `fork-${sequence}`;

    options.emit({
      type: "fork.start",
      forkId,
      prompt
    });

    try {
      const result = await options.host.fork({
        forkId,
        prompt,
        context: {
          messages: [...options.messages],
          toolCalls: [...options.toolCalls]
        }
      });

      options.emit({
        type: "fork.complete",
        forkId,
        result
      });

      return result;
    } catch (error) {
      const message = toError(error).message;

      options.emit({
        type: "fork.error",
        forkId,
        error: message
      });

      throw error;
    }
  };
}

function createIterationCompleteRunner(options: { model: AcpModel; signal: AbortSignal }) {
  return async (messages: ChatMessage[]): Promise<string> => {
    assertNotAborted(options.signal);

    const response = await options.model.complete({
      messages: toModelRequestMessages(messages, undefined),
      tools: [],
      signal: options.signal
    });

    return (await collectModelResponseEvents({ response })).content;
  };
}

function createIterationHookRunner(options: {
  runContext: RunContext;
  disposeRun?(): void | Promise<void>;
}) {
  return async <TEvent extends HookEvent>(event: TEvent, context: HookContextByEvent[TEvent]) =>
    dispatchHook({
      registry: options.runContext.hooks,
      event,
      ctx: context,
      disposeRun: options.disposeRun
    });
}

function syncSubmittedUserPrompt(
  promptMessage: ChatMessage,
  originalPrompt: string,
  prompt: string
): string {
  if (typeof promptMessage.content === "string" && promptMessage.content !== originalPrompt) {
    return promptMessage.content;
  }

  promptMessage.content = prompt;
  return prompt;
}

async function collectModelResponseEvents(options: {
  response: AcpModelResponse;
  emit?(event: AcpEvent): void;
}): Promise<CollectedModelResponse> {
  const contentChunks: string[] = [];
  const thinking: NonNullable<ChatMessage["thinking"]> = [];
  const redactedThinking: NonNullable<ChatMessage["redacted_thinking"]> = [];
  const reasoningDetails: unknown[] = [];
  const toolOutcomes: StreamToolOutcome[] = [];
  const pendingToolUses = new Map<string, PendingToolUse>();
  let usage: UsageInfo | undefined;
  let stopReason: CollectedModelResponse["stopReason"];

  for await (const event of options.response.events) {
    switch (event.type) {
      case "text":
        if (event.text.length === 0) {
          continue;
        }
        contentChunks.push(event.text);
        options.emit?.({
          type: "message.delta",
          content: event.text
        });
        break;
      case "thinking":
        if (event.text.length === 0) {
          continue;
        }
        appendThinkingChunk(thinking, event);
        break;
      case "redacted_thinking":
        redactedThinking.push({ data: event.data });
        break;
      case "reasoning_details":
        reasoningDetails.push(event.payload);
        break;
      case "tool_use_delta": {
        const pendingToolUse = getPendingToolUse(pendingToolUses, event.id);
        if (event.name !== undefined) {
          pendingToolUse.tool = normalizeToolName(event.name) ?? pendingToolUse.tool;
        }
        if (event.argsDelta !== undefined && event.argsDelta.length > 0) {
          pendingToolUse.argsDelta += event.argsDelta;
        }
        maybeEmitPendingToolIntent(pendingToolUse, options.emit);
        break;
      }
      case "tool_use_complete": {
        const pendingToolUse = getPendingToolUse(pendingToolUses, event.id);
        const tool = normalizeToolName(event.name);
        if (tool === undefined) {
          pendingToolUses.delete(event.id);
          break;
        }

        toolOutcomes.push({
          type: "complete",
          toolCall: {
            intentId: event.id,
            tool,
            args: event.args,
            rawArguments:
              pendingToolUse.argsDelta.length > 0
                ? pendingToolUse.argsDelta
                : typeof event.args === "string"
                  ? event.args
                  : undefined,
            intentEmitted: pendingToolUse.intentEmitted
          }
        });
        pendingToolUses.delete(event.id);
        break;
      }
      case "tool_use_json_parse_error": {
        const pendingToolUse = getPendingToolUse(pendingToolUses, event.id);
        toolOutcomes.push({
          type: "error",
          error: {
            intentId: event.id,
            tool: pendingToolUse.tool ?? "unknown",
            args: event.raw,
            error: event.error
          }
        });
        pendingToolUses.delete(event.id);
        break;
      }
      case "usage":
        usage = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cachedTokens: event.cachedTokens,
          cacheCreationTokens: event.cacheCreationTokens
        };
        break;
      case "stop":
        stopReason = event.reason;
        break;
    }
  }

  const reasoningContent =
    thinking.length === 0 ? undefined : thinking.map((entry) => entry.text).join("");

  return {
    content: contentChunks.join(""),
    ...(reasoningContent === undefined ? {} : { reasoningContent, reasoning: reasoningContent }),
    ...(thinking.length === 0 ? {} : { thinking }),
    ...(redactedThinking.length === 0 ? {} : { redactedThinking }),
    ...(reasoningDetails.length === 0 ? {} : { reasoningDetails }),
    toolOutcomes,
    ...(usage === undefined ? {} : { usage }),
    ...(stopReason === undefined ? {} : { stopReason })
  };
}

function appendThinkingChunk(
  thinking: NonNullable<ChatMessage["thinking"]>,
  event: Extract<ProviderStreamEvent, { type: "thinking" }>
): void {
  const lastChunk = thinking.at(-1);
  if (lastChunk && lastChunk.signature === event.signature) {
    lastChunk.text += event.text;
    return;
  }

  thinking.push({
    text: event.text,
    ...(event.signature === undefined ? {} : { signature: event.signature })
  });
}

function getPendingToolUse(
  pendingToolUses: Map<string, PendingToolUse>,
  intentId: string
): PendingToolUse {
  const existing = pendingToolUses.get(intentId);
  if (existing) {
    return existing;
  }

  const pendingToolUse: PendingToolUse = {
    intentId,
    argsDelta: "",
    intentEmitted: false
  };
  pendingToolUses.set(intentId, pendingToolUse);
  return pendingToolUse;
}

function maybeEmitPendingToolIntent(
  pendingToolUse: PendingToolUse,
  emit: ((event: AcpEvent) => void) | undefined
): void {
  if (
    !emit ||
    pendingToolUse.intentEmitted ||
    pendingToolUse.tool === undefined ||
    pendingToolUse.argsDelta.length === 0
  ) {
    return;
  }

  const parsedArgs = tryParseJson(pendingToolUse.argsDelta);
  if (!parsedArgs.ok) {
    return;
  }

  emit({
    type: "tool.intent",
    intentId: pendingToolUse.intentId,
    tool: pendingToolUse.tool,
    args: parsedArgs.value
  });
  pendingToolUse.intentEmitted = true;
}

function normalizeToolName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function createAssistantMessage(response: CollectedModelResponse): ChatMessage {
  const message: ChatMessage = {
    role: "assistant",
    content: response.content,
    ...(response.reasoningContent === undefined
      ? {}
      : {
          reasoning_content: response.reasoningContent
        }),
    ...(response.reasoning === undefined
      ? {}
      : {
          reasoning: response.reasoning
        }),
    ...(response.thinking === undefined
      ? {}
      : {
          thinking: response.thinking.map((entry) => ({ ...entry }))
        }),
    ...(response.redactedThinking === undefined
      ? {}
      : {
          redacted_thinking: response.redactedThinking.map((entry) => ({ ...entry }))
        }),
    ...(response.reasoningDetails === undefined
      ? {}
      : {
          reasoning_details: [...response.reasoningDetails]
        })
  };

  const toolCalls = response.toolOutcomes
    .filter(
      (toolOutcome): toolOutcome is Extract<StreamToolOutcome, { type: "complete" }> =>
        toolOutcome.type === "complete"
    )
    .map((toolOutcome) => ({
      id: toolOutcome.toolCall.intentId,
      type: "function" as const,
      function: {
        name: toolOutcome.toolCall.tool,
        arguments:
          toolOutcome.toolCall.rawArguments ?? serializeToolArguments(toolOutcome.toolCall.args)
      }
    }));

  if (toolCalls.length === 0) {
    return message;
  }

  return {
    ...message,
    tool_calls: toolCalls
  };
}

function toModelRequestMessages(
  messages: ChatMessage[],
  compiledSystemPrompt: string | undefined
): AcpModelRequestMessage[] {
  const modelMessages: AcpModelRequestMessage[] = [];

  if (
    compiledSystemPrompt !== undefined &&
    compiledSystemPrompt.length > 0 &&
    !hasSystemMessage(messages)
  ) {
    modelMessages.push({
      role: "system",
      content: compiledSystemPrompt
    });
  }

  for (const message of messages) {
    let modelMessage: AcpModelRequestMessage;
    if (message.role === "tool") {
      modelMessage = {
        role: message.role,
        ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
        ...(message.name === undefined ? {} : { name: message.name }),
        content: message.content
      };
    } else {
      modelMessage = {
        role: message.role,
        content: message.content,
        ...(message.reasoning_content === undefined
          ? {}
          : {
              reasoning_content: message.reasoning_content
            }),
        ...(message.reasoning === undefined
          ? {}
          : {
              reasoning: message.reasoning
            }),
        ...(message.thinking === undefined
          ? {}
          : {
              thinking: message.thinking.map((entry) => ({ ...entry }))
            }),
        ...(message.redacted_thinking === undefined
          ? {}
          : {
              redacted_thinking: message.redacted_thinking.map((entry) => ({ ...entry }))
            }),
        ...(message.reasoning_details === undefined
          ? {}
          : {
              reasoning_details: [...message.reasoning_details]
            })
      };

      if (message.name !== undefined) {
        modelMessage.name = message.name;
      }
    }

    const maybeToolCalls = message.tool_calls;
    if (maybeToolCalls && maybeToolCalls.length > 0) {
      modelMessage.tool_calls = maybeToolCalls;
    }

    modelMessages.push(modelMessage);
  }

  return modelMessages;
}

function hasSystemMessage(messages: ChatMessage[]): boolean {
  for (const message of messages) {
    if (message.role === "system" && message.name !== "compaction") {
      return true;
    }
  }

  return false;
}

function estimateTokenCount(messages: ChatMessage[]): number {
  let count = 0;

  for (const message of messages) {
    count += estimateMessageContentSize(message.content);
  }

  return count;
}

function serializeToolArguments(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function tryParseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  if (value.length === 0) {
    return {
      ok: true,
      value: {}
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(value) as unknown
    };
  } catch {
    return { ok: false };
  }
}

async function emitToolExecutionError(options: {
  intentId: string;
  tool: string;
  args: unknown;
  error: string;
  runContext: RunContext;
  emit(event: AcpEvent): void;
  toolCalls: ToolCallRecord[];
}): Promise<void> {
  options.emit({
    type: "tool.error",
    intentId: options.intentId,
    error: options.error
  });

  options.runContext.messages.push({
    role: "tool",
    name: options.tool,
    toolCallId: options.intentId,
    content: `Error: ${options.error}`
  });

  options.toolCalls.push({
    intentId: options.intentId,
    tool: options.tool,
    args: options.args,
    status: "error",
    error: options.error
  });
}

function toToolErrorText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function waitForToolAck(options: {
  host: AcpHost;
  intent: ToolIntent;
  signal: AbortSignal;
}): Promise<ToolAckResult> {
  assertNotAborted(options.signal);

  let abortListener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortListener = () => {
      reject(new AbortError("Run aborted.", options.signal.reason));
    };

    if (options.signal.aborted) {
      abortListener();
      return;
    }

    options.signal.addEventListener("abort", abortListener, { once: true });
  });

  try {
    return await Promise.race([options.host.handle(options.intent), abortPromise]);
  } finally {
    if (abortListener) {
      options.signal.removeEventListener("abort", abortListener);
    }
  }
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return new Error(String(value));
}

function assertNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }

  throw new AbortError("Run aborted.", signal.reason);
}

function wireAbortSignal(
  externalSignal: AbortSignal | undefined,
  runAbortController: AbortController
): {
  value: AbortSignal;
  cleanup(): void;
} {
  if (!externalSignal) {
    return {
      value: runAbortController.signal,
      cleanup() {
        return;
      }
    };
  }

  const onAbort = (): void => {
    if (!runAbortController.signal.aborted) {
      runAbortController.abort(externalSignal.reason);
    }
  };

  if (externalSignal.aborted) {
    onAbort();
  } else {
    externalSignal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    value: runAbortController.signal,
    cleanup() {
      externalSignal.removeEventListener("abort", onAbort);
    }
  };
}
