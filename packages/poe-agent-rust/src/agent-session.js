import { createAgentRuntime } from "@poe-code/poe-agent";
import { UserError } from "./user-error.js";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { agent, assertPositiveIntegerOption, normalizeNonEmptyString } from "./agent.js";
import filesPlugin from "./plugin-files.js";
import { openaiChatCompletionsPlugin } from "./plugin-openai-chat-completions.js";
import { openaiResponsesPlugin } from "./plugin-openai-responses.js";
import policyPlugin from "./plugin-policy.js";
import shellPlugin from "./plugin-shell.js";
import systemPromptPlugin from "./plugin-system-prompt.js";
import webPlugin from "./plugin-web.js";
import { resolvePluginsFromConfig } from "./resolve-plugins.js";
import { createFileAwarenessTracker, recordToolFileAwareness } from "./file-awareness.js";
import { createJsonlSessionStore, createMemorySessionStore } from "./session-log.js";
import { buildMessages, collectBranch, findHead } from "./session-tree.js";
import { getStructuredToolResultParts } from "./tool-results.js";
export async function createAgentSession(options = {}) {
  if (options.fs) {
    const runtime = createAgentRuntime(options, new AbortController().signal);
    options = { ...options, cwd: runtime.cwd, homeDir: runtime.homeDir };
  }
  const model = normalizeNonEmptyString(options.model);
  if (!model) {
    throw new UserError("Model must not be empty. Pass --model <id>.");
  }
  if (options.plugins && options.pluginsConfig) {
    throw new Error("Cannot provide both plugins and pluginsConfig.");
  }
  assertPositiveIntegerOption(options.maxToolCallIterations, "maxToolCallIterations");
  let builder = agent(options).model(model);
  const plugins = options.plugins ??
    (options.pluginsConfig !== undefined
      ? resolvePluginsFromConfig(options.pluginsConfig)
      : undefined) ?? [
      openaiResponsesPlugin(),
      openaiChatCompletionsPlugin(),
      systemPromptPlugin(),
      filesPlugin({ cwd: options.cwd, allowedPaths: options.allowedPaths }),
      shellPlugin({ cwd: options.cwd, allowedPaths: options.allowedPaths }),
      webPlugin()
    ];
  for (const plugin of plugins) {
    builder = builder.use(plugin);
  }
  for (const [name, definition] of Object.entries(options.mcpServers ?? {})) {
    if (definition.transport !== "stdio") {
      throw new Error(
        `Unsupported MCP transport "${definition.transport}" for server "${name}". Only "stdio" is supported.`
      );
    }
    builder = builder.mcp({
      name,
      command: definition.command,
      args: definition.args,
      ...(definition.trustedHost === undefined ? {} : { trustedHost: definition.trustedHost }),
      env: definition.env
    });
  }
  const mode = options.mode;
  if (mode === "auto") {
    throw new Error('poe-agent does not support mode "auto". Supported modes: read, edit, yolo.');
  }
  if (mode) {
    builder = builder.use(policyPlugin({ mode }));
  }
  return await adaptAcpToLegacySession(builder, options);
}
async function adaptAcpToLegacySession(builder, options, initialStore, initialHeadId) {
  let disposed = false;
  let previousRun = options.resume;
  let activeSession;
  const store = initialStore ?? (await createStore(options));
  let entries = await store.list();
  let headId = initialHeadId === undefined ? findHead(entries) : initialHeadId;
  if (entries.length === 0 && options.resume?.messages) {
    for (const entry of entriesFromMessages(options.resume.messages, headId)) {
      await store.append(entry);
      entries = [...entries, entry];
      headId = entry.id;
    }
  }
  const fileAwareness = createFileAwarenessTracker(options.cwd ?? process.cwd());
  const toolIntents = new Map();
  const recordedCompactionSummaries = new Set(
    entries.filter((entry) => entry.kind === "compaction").map((entry) => entry.summary)
  );
  const queue = [];
  const children = new Map();
  const idleWaiters = [];
  let backgroundFailure;
  function notifyIdle() {
    if (!active && !queue.length && !children.size)
      for (const waiter of idleWaiters.splice(0)) {
        if (backgroundFailure !== undefined) waiter.reject(backgroundFailure);
        else waiter.resolve();
      }
  }
  async function delegate(
    prompt,
    fork = false,
    history = buildResumeFromTree(entries, headId)?.messages ?? previousRun?.messages ?? []
  ) {
    if (disposed) throw new Error("Agent session is already disposed.");
    if (!normalizeNonEmptyString(prompt)) throw new UserError("Prompt must not be empty.");
    const id = randomUUID();
    const snapshot = fork ? structuredClone(history) : undefined;
    if (snapshot)
      for (const [index, message] of history.entries()) {
        for (const call of message.tool_calls ?? []) {
          if (!history.slice(index + 1).some((m) => m.toolCallId === call.id)) {
            snapshot.push({
              role: "tool",
              name: call.function.name,
              toolCallId: call.id,
              content: JSON.stringify({ status: "running_in_parent" })
            });
          }
        }
      }
    const callback = active?.request.options.onSessionUpdate;
    const task = { cancelled: false, done: Promise.resolve() };
    children.set(id, task);
    task.done = (async () => {
      let result;
      try {
        const child = await createAgentSession({
          ...options,
          onSessionUpdate: undefined,
          resume: snapshot ? { messages: snapshot } : undefined
        });
        task.session = child;
        if (task.cancelled) return;
        await child.sendMessage(prompt);
        await child.whenIdle();
        const last = child
          .getHistory()
          .filter((m) => m.role === "assistant")
          .at(-1);
        result = { delegation: id, status: "completed", output: last?.content ?? "" };
      } catch (error) {
        result = {
          delegation: id,
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        };
      } finally {
        try {
          await task.session?.dispose();
        } catch (error) {
          result = {
            delegation: id,
            status: "failed",
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
      if (!task.cancelled && !disposed) {
        await enqueue(JSON.stringify(result), { mode: "follow-up", onSessionUpdate: callback });
      }
    })()
      .catch((error) => {
        // The follow-up is recorded before inference. Its failure remains visible in history.
        if (!task.cancelled && !disposed) backgroundFailure = error;
      })
      .finally(() => {
        children.delete(id);
        notifyIdle();
      });
    return id;
  }
  let active;
  function enqueue(prompt, sendOptions = {}) {
    if (disposed) return Promise.reject(new Error("Agent session is already disposed."));
    if (!normalizeNonEmptyString(prompt))
      return Promise.reject(new UserError("Prompt must not be empty."));
    const mode = sendOptions.mode ?? "queue";
    if (!["interrupt", "follow-up", "queue"].includes(mode))
      return Promise.reject(new Error("Unknown input mode."));
    if (sendOptions.signal?.aborted)
      return Promise.reject(new DOMException("Message cancelled.", "AbortError"));
    backgroundFailure = undefined;
    return new Promise((resolve, reject) => {
      const item = {
        prompt,
        options: sendOptions,
        resolve,
        reject,
        cleanup: () => sendOptions.signal?.removeEventListener("abort", abort)
      };
      const abort = () => {
        const index = queue.indexOf(item);
        if (index >= 0) {
          queue.splice(index, 1);
          item.cleanup();
          reject(new DOMException("Message cancelled.", "AbortError"));
        } else if (active?.request === item || active?.followers.includes(item))
          active.controller.abort();
      };
      sendOptions.signal?.addEventListener("abort", abort, { once: true });
      if (
        mode === "follow-up" &&
        active &&
        !active.controller.signal.aborted &&
        (!activeSession || activeSession.followUp(prompt))
      ) {
        active.followers.push(item);
        return;
      }
      if (mode === "interrupt") {
        // Preserve accepted messages, with interrupts ahead of ordinary queued turns.
        const next = queue.findIndex((entry) => entry.options.mode !== "interrupt");
        queue.splice(next < 0 ? queue.length : next, 0, item);
        active?.controller.abort();
      } else {
        queue.push(item);
      }
      pump();
    });
  }
  function pump() {
    if (active || disposed) return;
    const request = queue.shift();
    if (!request) {
      notifyIdle();
      return;
    }
    const current = {
      request,
      followers: [],
      controller: new AbortController(),
      done: Promise.resolve()
    };
    active = current;
    current.done = (async () => {
      try {
        const result = await runMessage(request.prompt, {
          ...request.options,
          signal: current.controller.signal
        });
        for (const item of [request, ...current.followers]) item.resolve(result);
      } catch (error) {
        for (const item of [request, ...current.followers]) item.reject(error);
      } finally {
        for (const item of [request, ...current.followers]) item.cleanup();
        active = undefined;
        pump();
      }
    })();
  }
  async function cancel() {
    backgroundFailure = undefined;
    const owned = [...children.values()];
    for (const task of owned) task.cancelled = true;
    const cancelling = Promise.allSettled(owned.map((task) => task.session?.cancel()));
    for (const item of queue.splice(0)) {
      item.cleanup();
      item.reject(new DOMException("Message cancelled.", "AbortError"));
    }
    const current = active;
    current?.controller.abort();
    await activeSession?.dispose();
    await current?.done;
    await cancelling;
    await Promise.all(owned.map((task) => task.done));
    notifyIdle();
  }
  let pendingWrite = Promise.resolve();
  const api = {
    id: store.sessionId,
    sendMessage: enqueue,
    delegate: (prompt, options) => delegate(prompt, options?.fork),
    whenIdle() {
      if (!active && !queue.length && !children.size)
        return backgroundFailure === undefined
          ? Promise.resolve()
          : Promise.reject(backgroundFailure);
      return new Promise((resolve, reject) => idleWaiters.push({ resolve, reject }));
    },
    cancel,
    getHistory() {
      return previousRun?.messages ?? buildResumeFromTree(entries, headId)?.messages ?? [];
    },
    tree() {
      return entries.map(cloneSessionEntry);
    },
    async fork(fromEntryId) {
      entries = await store.list();
      const branch = collectBranch(entries, fromEntryId);
      if (branch.length === 0 || branch.at(-1)?.id !== fromEntryId) {
        throw new Error(`Cannot fork unknown session entry: ${fromEntryId}`);
      }
      const forkStore = await createStore(options);
      for (const entry of branch) {
        await forkStore.append(entry);
      }
      const forkMarker = createEntry(
        {
          kind: "fork_marker",
          fromEntryId
        },
        fromEntryId
      );
      await forkStore.append(forkMarker);
      const branchSummary = createEntry(
        {
          kind: "branch_summary",
          fromEntryId,
          summary: `Forked into session ${forkStore.sessionId}.`
        },
        fromEntryId
      );
      await store.append(branchSummary);
      entries = await store.list();
      return await adaptAcpToLegacySession(builder, options, forkStore, forkMarker.id);
    },
    async navigateTo(entryId) {
      if (active) throw new Error("Cannot navigate while a turn is running.");
      entries = await store.list();
      if (!entries.some((entry) => entry.id === entryId)) {
        throw new Error(`Cannot navigate to unknown session entry: ${entryId}`);
      }
      headId = entryId;
      previousRun = { messages: buildMessages(entries, headId) };
    },
    async dispose() {
      disposed = true;
      await cancel();
      previousRun = undefined;
      await store.dispose();
    }
  };
  return api;
  async function runMessage(prompt, sendOptions = {}) {
    if (disposed) {
      throw new Error("Agent session is already disposed.");
    }
    if (!normalizeNonEmptyString(prompt)) {
      throw new UserError("Prompt must not be empty.");
    }
    const onSessionUpdate = (update) => {
      options.onSessionUpdate?.(update);
      sendOptions.onSessionUpdate?.(update);
      for (const follower of active?.followers ?? []) follower.options.onSessionUpdate?.(update);
    };
    let assistantContent = "";
    let emittedAssistantChunk = false;
    let completed;
    let failed;
    let userEntryRecorded = false;
    const treeResume = buildResumeFromTree(entries, headId);
    const recordSubmittedPrompt = async (submittedPrompt) => {
      if (userEntryRecorded) return;
      await appendEntry({
        kind: "user",
        text: submittedPrompt
      });
      userEntryRecorded = true;
    };
    const runOptions = {
      signal: sendOptions.signal,
      resume: previousRun ?? treeResume,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      fetch: options.fetch,
      cwd: options.cwd,
      env: options.env,
      maxIterations: options.maxToolCallIterations,
      fileAwareness,
      onPromptSubmitted: recordSubmittedPrompt,
      delegate,
      __legacyAutoHandleTools: true
    };
    const acpSession = await builder.acp(prompt, runOptions);
    activeSession = acpSession;
    for (const follower of active?.followers ?? []) {
      if (!acpSession.followUp(follower.prompt))
        throw new Error("Run stopped before accepting follow-up.");
    }
    if (disposed) {
      await acpSession.dispose();
      throw new Error("Agent session is already disposed.");
    }
    try {
      for await (const event of acpSession.events) {
        if (!userEntryRecorded) await recordSubmittedPrompt(prompt);
        if (event.type === "input.accepted") {
          if (assistantContent) await appendEntry({ kind: "assistant", text: assistantContent });
          assistantContent = "";
          await appendEntry({ kind: "user", text: event.prompt });
        }
        await recordSessionEvent(event);
        handleEvent(event, onSessionUpdate, (chunk) => {
          if (chunk.length > 0) {
            emittedAssistantChunk = true;
            assistantContent += chunk;
          }
        });
        if (event.type === "session.complete") {
          completed = event.result;
          assistantContent = event.result.output;
          continue;
        }
        if (event.type === "session.error") {
          failed = event.error;
        }
      }
    } finally {
      await acpSession.dispose();
      if (activeSession === acpSession) {
        activeSession = undefined;
      }
    }
    if (failed) {
      if (assistantContent) await appendEntry({ kind: "assistant", text: assistantContent });
      previousRun = buildResumeFromTree(entries, headId);
      throw failed;
    }
    if (!completed) {
      throw new Error("Run ended without a terminal event.");
    }
    previousRun = { messages: completed.messages };
    await appendEntry({
      kind: "assistant",
      text: assistantContent
    });
    if (onSessionUpdate && !emittedAssistantChunk && assistantContent.length > 0) {
      onSessionUpdate({
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: assistantContent
        }
      });
    }
    return {
      role: "assistant",
      content: assistantContent
    };
  }
  async function appendEntry(entry) {
    const next = pendingWrite.then(async () => {
      const persisted = createEntry(entry, headId);
      await store.append(persisted);
      headId = persisted.id;
      entries = [...entries, persisted];
      return persisted;
    });
    pendingWrite = next.then(
      () => {},
      () => {}
    );
    return next;
  }
  async function recordSessionEvent(event) {
    if (event.type === "tool.intent") {
      toolIntents.set(event.intentId, {
        tool: event.tool,
        args: event.args
      });
      await appendEntry({
        kind: "tool_call",
        tool: event.tool,
        args: event.args,
        intentId: event.intentId
      });
      return;
    }
    if (event.type === "tool.result") {
      const intent = toolIntents.get(event.intentId);
      if (intent) {
        recordToolFileAwareness({
          tracker: fileAwareness,
          tool: intent.tool,
          args: intent.args
        });
      }
      await appendEntry({
        kind: "tool_result",
        intentId: event.intentId,
        result: event.result
      });
      return;
    }
    if (event.type === "tool.error") {
      if (event.tool !== undefined && !toolIntents.has(event.intentId)) {
        await appendEntry({
          kind: "tool_call",
          intentId: event.intentId,
          tool: event.tool,
          args: event.args
        });
      }
      await appendEntry({
        kind: "tool_result",
        intentId: event.intentId,
        error: event.error
      });
      return;
    }
    if (event.type === "session.complete") {
      for (const message of event.result.messages) {
        const summary = getCompactionSummary(message);
        if (summary === undefined || recordedCompactionSummaries.has(summary)) {
          continue;
        }
        const awareness = fileAwareness.snapshot();
        await appendEntry({
          kind: "compaction",
          summary,
          droppedIds: [],
          readFiles: Array.from(awareness.readFiles),
          modifiedFiles: Array.from(awareness.modifiedFiles)
        });
        recordedCompactionSummaries.add(summary);
      }
    }
  }
}

function cloneSessionEntry(entry) {
  return JSON.parse(JSON.stringify(entry));
}
async function createStore(options) {
  const sessionId = randomUUID();
  if (!options.persist) {
    return createMemorySessionStore(sessionId);
  }
  return await createJsonlSessionStore(
    sessionId,
    expandHome(
      options.persist.directory,
      options.homeDir ?? (options.fs ? "/" : os.homedir()),
      options.fs ? path.posix : path
    ),
    { fs: createAgentRuntime(options, new AbortController().signal).nodeFs }
  );
}
function createEntry(entry, parentId) {
  return {
    ...entry,
    id: randomUUID(),
    parentId,
    createdAt: new Date().toISOString()
  };
}
function buildResumeFromTree(entries, headId) {
  if (entries.length === 0 || headId === null) {
    return undefined;
  }
  return { messages: buildMessages(entries, headId) };
}
function expandHome(directory, homeDir, path) {
  if (directory === "~") {
    return homeDir;
  }
  if (directory.startsWith("~/")) {
    return path.join(homeDir, directory.slice(2));
  }
  return directory;
}
function getCompactionSummary(message) {
  if (message.role !== "system" || message.name !== "compaction") {
    return undefined;
  }
  if (typeof message.content !== "string") {
    return undefined;
  }
  const prefix = "Compacted context summary:\n";
  return message.content.startsWith(prefix)
    ? message.content.slice(prefix.length)
    : message.content;
}
function entriesFromMessages(messages, initialParentId) {
  let parentId = initialParentId;
  const entries = [];
  for (const message of messages) {
    const entry = entryFromMessage(message, parentId);
    if (!entry) {
      continue;
    }
    entries.push(entry);
    parentId = entry.id;
  }
  return entries;
}
function entryFromMessage(message, parentId) {
  if (message.role === "user" && typeof message.content === "string") {
    return createEntry({ kind: "user", text: message.content }, parentId);
  }
  if (message.role === "assistant" && typeof message.content === "string") {
    return createEntry({ kind: "assistant", text: message.content }, parentId);
  }
  const compactionSummary = getCompactionSummary(message);
  if (compactionSummary !== undefined) {
    return createEntry(
      {
        kind: "compaction",
        summary: compactionSummary,
        droppedIds: [],
        readFiles: [],
        modifiedFiles: []
      },
      parentId
    );
  }
  if (message.role === "tool" && message.toolCallId) {
    return createEntry(
      {
        kind: "tool_result",
        intentId: message.toolCallId,
        result: message.content
      },
      parentId
    );
  }
  return undefined;
}
function handleEvent(event, onSessionUpdate, onMessageDelta) {
  if (event.type === "tool.intent") {
    if (!onSessionUpdate) {
      return;
    }
    const toolCall = {
      sessionUpdate: "tool_call",
      toolCallId: event.intentId,
      title: event.tool,
      kind: "execute",
      status: "pending",
      rawInput: event.args
    };
    const inProgressUpdate = {
      sessionUpdate: "tool_call_update",
      toolCallId: event.intentId,
      kind: "execute",
      status: "in_progress"
    };
    onSessionUpdate(toolCall);
    onSessionUpdate(inProgressUpdate);
    return;
  }
  if (event.type === "tool.result") {
    if (!onSessionUpdate) {
      return;
    }
    const content = toLegacyToolCallContent(event.result);
    onSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: event.intentId,
      kind: "execute",
      status: "completed",
      rawOutput: event.result,
      ...(content === undefined ? {} : { content })
    });
    return;
  }
  if (event.type === "tool.error") {
    if (!onSessionUpdate) {
      return;
    }
    onSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: event.intentId,
      kind: "execute",
      status: "failed",
      rawOutput: event.error
    });
    return;
  }
  if (event.type === "message.delta") {
    onMessageDelta(event.content);
    if (!onSessionUpdate || event.content.length === 0) {
      return;
    }
    onSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: event.content
      }
    });
    return;
  }
  if (event.type === "usage") {
    if (!onSessionUpdate) {
      return;
    }
    const { inputTokens, outputTokens, cachedTokens, cacheCreationTokens } = event.usage;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
    onSessionUpdate({
      sessionUpdate: "usage_update",
      used: nonCachedInput,
      size: inputTokens,
      _meta: {
        inputTokens,
        outputTokens,
        cachedTokens,
        cacheCreationTokens
      }
    });
  }
}
function toLegacyToolCallContent(result) {
  const parts = getStructuredToolResultParts(result);
  if (!parts) {
    return undefined;
  }
  return parts.map((part) => {
    if (part.type === "text") {
      return {
        type: "text",
        text: part.text
      };
    }
    if (part.type === "image") {
      return {
        type: "image",
        mimeType: part.mimeType,
        data: part.data
      };
    }
    return {
      type: "text",
      text: JSON.stringify(part)
    };
  });
}
