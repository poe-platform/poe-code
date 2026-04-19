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
import type { HookContextByEvent, HookEvent } from "./plugin-types.js";
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
  ToolIntent
} from "./types.js";

export type AcpModelToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type AcpModelToolCall = {
  id?: string;
  intentId?: string;
  tool?: string;
  name?: string;
  args?: unknown;
  arguments?: unknown;
};

export type AcpModelMessage = {
  content?: string | null;
  reasoning_content?: string;
  reasoning?: string;
  toolCalls?: AcpModelToolCall[];
  tool_calls?: Array<{
    id: string;
    type?: "function";
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
};

export type AcpModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheCreationTokens: number;
};

export type AcpModelResponse = {
  message?: AcpModelMessage;
  content?: string;
  toolCalls?: AcpModelToolCall[];
  deltas?: AsyncIterable<string> | Iterable<string>;
  usage?: AcpModelUsage;
};

export type AcpModelRequestMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ToolResultPart[];
  reasoning_content?: string;
  reasoning?: string;
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

class AsyncEventQueue<T> implements AsyncIterableIterator<T> {
  readonly #items: T[] = [];
  readonly #resolvers: AsyncResolver<T>[] = [];
  #closed = false;

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

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

export function runAcpCore(options: RunAcpCoreOptions): AsyncIterable<AcpEvent> {
  const events = new AsyncEventQueue<AcpEvent>();

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

    disposed = true;
    await baseDisposeRun();
  };

  const emit = (event: AcpEvent): void => {
    if (terminalEmitted) {
      return;
    }

    events.push(event);
  };

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
  await applyHookDecision("userPromptSubmit", userPromptDecision, userPromptContext);
  prompt = syncSubmittedUserPrompt(promptMessage, prompt, userPromptContext.prompt);

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

    const normalizedResponse = normalizeModelResponse(response, iterationNumber);
    const resolvedContent = await emitMessageDeltas({
      response,
      fallbackContent: normalizedResponse.content,
      emit: options.emit
    });

    if (response.usage) {
      options.emit({
        type: "usage",
        usage: response.usage
      });
    }

    options.runContext.messages.push(
      createAssistantMessage({
        ...normalizedResponse,
        content: resolvedContent
      })
    );

    for (const toolCall of normalizedResponse.toolCalls) {
      assertNotAborted(options.signal);

      await runSingleToolCall({
        toolCall,
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

    if (normalizedResponse.toolCalls.length === 0) {
      return {
        output: resolvedContent,
        messages: [...options.runContext.messages],
        toolCalls: [...options.toolCalls]
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
    options.emit({
      type: "tool.intent",
      intentId: mutableOutcome.intentId,
      tool: mutableOutcome.tool,
      args: mutableOutcome.args
    });

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
  await applyHookDecision("postToolUse", postToolDecision, postToolContext);

  if (postToolContext.error !== undefined) {
    mutableOutcome.error = postToolContext.error;
    mutableOutcome.result = undefined;
  } else {
    mutableOutcome.result = postToolContext.result;
    mutableOutcome.error = undefined;
  }

  if (mutableOutcome.error === undefined) {
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

  options.emit({
    type: "tool.error",
    intentId: mutableOutcome.intentId,
    error: mutableOutcome.error
  });

  options.runContext.messages.push({
    role: "tool",
    name: mutableOutcome.tool,
    toolCallId: mutableOutcome.intentId,
    content: `Error: ${mutableOutcome.error}`
  });

  options.toolCalls.push({
    intentId: mutableOutcome.intentId,
    tool: mutableOutcome.tool,
    args: mutableOutcome.args,
    status: "error",
    error: mutableOutcome.error
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

    return normalizeModelResponse(response, 0).content;
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

type NormalizedModelResponse = {
  content: string;
  reasoningContent?: string;
  reasoning?: string;
  toolCalls: NormalizedModelToolCall[];
};

type NormalizedModelToolCall = {
  intentId: string;
  tool: string;
  args: unknown;
  rawArguments?: string;
};

function normalizeModelResponse(
  response: AcpModelResponse,
  iterationNumber: number
): NormalizedModelResponse {
  const message = response.message;
  const messageContent = message?.content;
  const reasoningContent =
    typeof message?.reasoning_content === "string" ? message.reasoning_content : undefined;
  const reasoning = typeof message?.reasoning === "string" ? message.reasoning : undefined;

  const contentFromMessage = typeof messageContent === "string" ? messageContent : undefined;
  const content = contentFromMessage ?? response.content ?? "";

  const rawToolCalls =
    message?.toolCalls ?? response.toolCalls ?? fromOpenAiToolCalls(message?.tool_calls);

  return {
    content,
    ...(reasoningContent === undefined ? {} : { reasoningContent }),
    ...(reasoning === undefined ? {} : { reasoning }),
    toolCalls: normalizeModelToolCalls(rawToolCalls, iterationNumber)
  };
}

function normalizeModelToolCalls(
  rawToolCalls: AcpModelToolCall[] | undefined,
  iterationNumber: number
): NormalizedModelToolCall[] {
  if (!rawToolCalls || rawToolCalls.length === 0) {
    return [];
  }

  const normalized: NormalizedModelToolCall[] = [];

  for (let index = 0; index < rawToolCalls.length; index += 1) {
    const raw = rawToolCalls[index];
    if (!raw) {
      continue;
    }

    const tool = normalizeToolName(raw);
    if (tool === undefined) {
      continue;
    }

    const normalizedArgs = normalizeToolArguments(raw);
    normalized.push({
      intentId: normalizeIntentId(raw, iterationNumber, index),
      tool,
      args: normalizedArgs.args,
      ...(normalizedArgs.rawArguments === undefined
        ? {}
        : {
            rawArguments: normalizedArgs.rawArguments
          })
    });
  }

  return normalized;
}

function normalizeToolName(raw: AcpModelToolCall): string | undefined {
  const candidate = raw.tool ?? raw.name;

  if (typeof candidate !== "string") {
    return undefined;
  }

  const tool = candidate.trim();
  return tool.length > 0 ? tool : undefined;
}

function normalizeIntentId(
  raw: AcpModelToolCall,
  iterationNumber: number,
  toolIndex: number
): string {
  const directId = raw.intentId ?? raw.id;
  if (typeof directId === "string") {
    const normalized = directId.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return `intent-${iterationNumber}-${toolIndex + 1}`;
}

function normalizeToolArguments(raw: AcpModelToolCall): { args: unknown; rawArguments?: string } {
  const args = raw.args ?? raw.arguments;

  if (typeof args !== "string") {
    return { args };
  }

  try {
    return {
      args: JSON.parse(args) as unknown,
      rawArguments: args
    };
  } catch {
    return { args };
  }
}

function fromOpenAiToolCalls(
  toolCalls:
    | Array<{
        id: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>
    | undefined
): AcpModelToolCall[] {
  if (!toolCalls || toolCalls.length === 0) {
    return [];
  }

  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.function?.name,
    arguments: toolCall.function?.arguments
  }));
}

function createAssistantMessage(response: NormalizedModelResponse): ChatMessage {
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
        })
  };

  if (response.toolCalls.length === 0) {
    return message;
  }

  const toolCalls = response.toolCalls.map((toolCall) => ({
    id: toolCall.intentId,
    type: "function" as const,
    function: {
      name: toolCall.tool,
      arguments: toolCall.rawArguments ?? serializeToolArguments(toolCall.args)
    }
  }));

  return {
    ...message,
    ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls })
  } as ChatMessage;
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
            })
      };

      if (message.name !== undefined) {
        modelMessage.name = message.name;
      }
    }

    const maybeToolCalls = (
      message as ChatMessage & { tool_calls?: AcpModelRequestMessage["tool_calls"] }
    ).tool_calls;
    if (maybeToolCalls && maybeToolCalls.length > 0) {
      modelMessage.tool_calls = maybeToolCalls;
    }

    modelMessages.push(modelMessage);
  }

  return modelMessages;
}

function hasSystemMessage(messages: ChatMessage[]): boolean {
  for (const message of messages) {
    if (message.role === "system") {
      return true;
    }
  }

  return false;
}

async function emitMessageDeltas(options: {
  response: AcpModelResponse;
  fallbackContent: string;
  emit(event: AcpEvent): void;
}): Promise<string> {
  const chunks: string[] = [];

  if (options.response.deltas) {
    for await (const chunk of options.response.deltas) {
      if (typeof chunk !== "string" || chunk.length === 0) {
        continue;
      }

      chunks.push(chunk);
      options.emit({
        type: "message.delta",
        content: chunk
      });
    }
  }

  if (chunks.length === 0 && options.fallbackContent.length > 0) {
    chunks.push(options.fallbackContent);
    options.emit({
      type: "message.delta",
      content: options.fallbackContent
    });
  }

  return chunks.join("");
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
