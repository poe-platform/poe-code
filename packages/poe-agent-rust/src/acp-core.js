import { createRequire } from "node:module";
import { AsyncEventQueue } from "./event-queue.js";
import { collectModelResponseEvents } from "./model-stream.js";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");
const messageCopies = {
  entries(value) {
    return value.map((entry) => ({ ...entry }));
  },
  values(value) {
    return [...value];
  }
};
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
import { estimateMessageContentSize, toToolMessageContent } from "./tool-results.js";
export function runAcpCore(options) {
  const events = new AsyncEventQueue(() => {
    options.runContext.abortController.abort();
  });
  void execute(options, events);
  return events;
}
async function execute(options, events) {
  const signal = wireAbortSignal(options.signal, options.runContext.abortController);
  const cleanupAbortSignal = signal.cleanup;
  const toolCalls = [];
  const execution = new native.NativeAgentExecution();
  const baseDisposeRun = options.disposeRun ?? (() => options.runContext.dispose());

  const disposeRun = async () => {
    if (execution.disposed()) {
      return;
    }
    await baseDisposeRun();
    execution.finishDisposal();
  };
  const emit = (event) => {
    if (!execution.acceptsEvent()) {
      return;
    }
    events.push(event);
  };
  options.host.setEmit?.(emit);
  const emitTerminal = (event) => {
    if (!execution.acceptTerminal()) {
      return;
    }
    events.push(event);
    events.close();
  };
  const runStopHook = async (context) => {
    execution.startStop();
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
      execution,
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
    if (!execution.stopStarted()) {
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
async function runLoop(options) {
  assertNotAborted(options.signal);
  let prompt = options.prompt;

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
  const promptMessage = {
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
    const assistantMessage = {
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
    const iterationNumber = options.execution.advanceIteration(options);
    if (iterationNumber === null) {
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
    options.execution.checkStop(collectedResponse);
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
async function runSingleToolCall(options) {
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
  const mutableOutcome = {
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
    const intent = {
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
  const postToolDispatch = await applyHookDecision(
    "postToolUse",
    postToolDecision,
    postToolContext
  );
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
async function runPostIterationHooks(options) {
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
function createForkRunner(options) {
  let sequence = 0;
  return async (prompt) => {
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
function createIterationCompleteRunner(options) {
  return async (messages) => {
    assertNotAborted(options.signal);
    const response = await options.model.complete({
      messages: toModelRequestMessages(messages, undefined),
      tools: [],
      signal: options.signal
    });
    return (await collectModelResponseEvents({ response })).content;
  };
}
function createIterationHookRunner(options) {
  return async (event, context) =>
    dispatchHook({
      registry: options.runContext.hooks,
      event,
      ctx: context,
      disposeRun: options.disposeRun
    });
}
function syncSubmittedUserPrompt(promptMessage, originalPrompt, prompt) {
  if (typeof promptMessage.content === "string" && promptMessage.content !== originalPrompt) {
    return promptMessage.content;
  }
  promptMessage.content = prompt;
  return prompt;
}
function createAssistantMessage(response) {
  const message = native.mapAgentAssistantMessage(response, messageCopies);
  const toolCalls = response.toolOutcomes
    .filter((toolOutcome) => toolOutcome.type === "complete")
    .map((toolOutcome) => ({
      id: toolOutcome.toolCall.intentId,
      type: "function",
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
function toModelRequestMessages(messages, compiledSystemPrompt) {
  const modelMessages = [];
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
    const mapped = native.mapAgentRequestMessage(message, messageCopies);
    const modelMessage = mapped.message;
    if (!mapped.toolRole && message.name !== undefined) {
      modelMessage.name = message.name;
    }
    const maybeToolCalls = message.tool_calls;
    if (maybeToolCalls && maybeToolCalls.length > 0) {
      modelMessage.tool_calls = maybeToolCalls;
    }
    modelMessages.push(modelMessage);
  }
  return modelMessages;
}
function hasSystemMessage(messages) {
  for (const message of messages) {
    if (message.role === "system" && message.name !== "compaction") {
      return true;
    }
  }
  return false;
}
function estimateTokenCount(messages) {
  let count = 0;
  for (const message of messages) {
    count += estimateMessageContentSize(message.content);
  }
  return count;
}
function serializeToolArguments(value) {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
async function emitToolExecutionError(options) {
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
function toToolErrorText(value) {
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
async function waitForToolAck(options) {
  assertNotAborted(options.signal);
  let abortListener;
  const abortPromise = new Promise((_, reject) => {
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
function toError(value) {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}
function assertNotAborted(signal) {
  if (!signal.aborted) {
    return;
  }
  throw new AbortError("Run aborted.", signal.reason);
}
function wireAbortSignal(externalSignal, runAbortController) {
  if (!externalSignal) {
    return {
      value: runAbortController.signal,
      cleanup() {
        return;
      }
    };
  }
  const onAbort = () => {
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
