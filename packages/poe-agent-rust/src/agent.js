import { native } from "./native.js";
import * as fsPromises from "node:fs/promises";
import mcpPlugin from "./plugin-mcp.js";
import { POLICY_MODE_SESSION_KEY } from "./plugin-policy.js";
import { runAcpCore } from "./acp-core.js";
import { AgentHost, createInMemorySpawnSession } from "./agent-host.js";
import { AbortError } from "./hooks.js";
import {
  createResolvedAgentConfig,
  cloneAgentPlugin,
  resolvePluginSetupOrder,
  toRuntimePlugins
} from "./config.js";
import { getResolvedProviderOptions } from "./provider-metadata.js";
import { runPluginSetup } from "./plugin-setup.js";
import { collectProviders, resolveProvider } from "./providers.js";
import { createRunContext } from "./run-context.js";
import { createTranscriptWriter } from "./transcript.js";
import { assertValidToolName } from "./tool-names.js";
class ImmutableAgentBuilder {
  #config;
  constructor(config) {
    this.#config = config ?? createResolvedAgentConfig();
  }
  model(model) {
    return new ImmutableAgentBuilder(
      createResolvedAgentConfig({
        ...this.#config,
        model
      })
    );
  }
  use(plugin) {
    return new ImmutableAgentBuilder(
      createResolvedAgentConfig({
        ...this.#config,
        plugins: [...this.#config.plugins, cloneAgentPlugin(plugin)]
      })
    );
  }
  tools(...tools) {
    for (const tool of tools) {
      assertValidToolName(tool.name);
    }
    return this.use({
      name: `inline-tools-${this.#config.plugins.length + 1}`,
      tools
    });
  }
  mcp(...configsOrMap) {
    const configs = normalizeMcpConfigs(configsOrMap);
    return new ImmutableAgentBuilder(
      createResolvedAgentConfig({
        ...this.#config,
        plugins: [...this.#config.plugins, ...configs.map((config) => mcpPlugin(config))]
      })
    );
  }
  async acp(prompt, options = {}) {
    const normalizedPrompt = normalizePrompt(prompt);
    const prepared = await this.#prepareRun(options).catch((error) => {
      throw toError(error);
    });
    const autoHandleTools = options.__legacyAutoHandleTools === true;
    const delegateHost = new AgentHost({
      runContext: prepared.runContext,
      model: prepared.model,
      baseSystemPrompt: prepared.baseSystemPrompt,
      maxIterations: prepared.maxIterations,
      createSpawnSession: prepared.createSpawnSession
    });
    const host = new CallerAcpHost(
      prepared.runContext,
      delegateHost,
      autoHandleTools ? delegateHost.handle.bind(delegateHost) : undefined
    );
    const events = runAcpCore({
      prompt: normalizedPrompt,
      runContext: prepared.runContext,
      host,
      model: prepared.model,
      baseSystemPrompt: prepared.baseSystemPrompt,
      maxIterations: prepared.maxIterations,
      onPromptSubmitted: options.onPromptSubmitted
    });
    return {
      events,
      acknowledge(intentId, result) {
        host.acknowledge(intentId, result);
      },
      async dispose() {
        await prepared.runContext.dispose();
      }
    };
  }
  async run(prompt, options = {}) {
    const startedRun = await this.#startRun(prompt, options).catch((error) => {
      throw toError(error);
    });
    const { events, runContext } = startedRun;
    let completed;
    let failed;
    let usage;
    let streamedOutput = "";
    const streamedToolCalls = new Map();
    const transcript = options.logPath
      ? createTranscriptWriter({
          logPath: options.logPath,
          fs: defaultTranscriptFs
        })
      : undefined;
    try {
      for await (const event of events) {
        await transcript?.write(event);
        if (event.type === "message.delta") {
          options.onStdout?.(event.content);
          streamedOutput += event.content;
          continue;
        }
        if (event.type === "usage") {
          usage = event.usage;
          continue;
        }
        if (event.type === "tool.intent") {
          streamedToolCalls.set(event.intentId, {
            intentId: event.intentId,
            tool: event.tool,
            args: event.args
          });
          continue;
        }
        if (event.type === "tool.result") {
          const toolCall = streamedToolCalls.get(event.intentId);
          if (toolCall) {
            toolCall.status = "success";
            toolCall.result = event.result;
            toolCall.error = undefined;
          }
          continue;
        }
        if (event.type === "tool.error") {
          const toolCall = streamedToolCalls.get(event.intentId);
          if (toolCall) {
            toolCall.status = "error";
            toolCall.error = event.error;
            toolCall.result = undefined;
          }
          continue;
        }
        if (event.type === "session.complete") {
          completed = event.result;
          continue;
        }
        if (event.type === "session.error") {
          failed = event.error;
        }
      }
    } finally {
      await transcript?.close();
    }
    const logFile = transcript?.filePath ?? completed?.logFile;
    const resultUsage = usage ?? completed?.usage;
    const resultMessages =
      completed?.messages ??
      (runContext.messages.length === 1 && runContext.messages[0]?.role === "user"
        ? []
        : [...runContext.messages]);
    const resultToolCalls =
      completed?.toolCalls ??
      Array.from(streamedToolCalls.values()).map((toolCall) => {
        if (toolCall.status === "success") {
          return {
            intentId: toolCall.intentId,
            tool: toolCall.tool,
            args: toolCall.args,
            status: "success",
            result: toolCall.result
          };
        }
        return {
          intentId: toolCall.intentId,
          tool: toolCall.tool,
          args: toolCall.args,
          status: "error",
          error: toolCall.error ?? failed?.message ?? "Run ended before the tool completed."
        };
      });
    if (failed) {
      const fallback = completed ?? {
        output: streamedOutput,
        stdout: streamedOutput,
        messages: resultMessages,
        toolCalls: resultToolCalls,
        exitCode: 1,
        stderr: failed.message
      };
      return {
        ...fallback,
        ...(resultUsage === undefined ? {} : { usage: resultUsage }),
        ...(logFile === undefined ? {} : { logFile }),
        stdout: fallback.stdout ?? fallback.output,
        exitCode: 1,
        stderr: failed.message
      };
    }
    if (!completed) {
      throw new Error("Run ended without a terminal event.");
    }
    return {
      ...completed,
      ...(resultUsage === undefined ? {} : { usage: resultUsage }),
      ...(logFile === undefined ? {} : { logFile }),
      stdout: completed.stdout ?? completed.output,
      summary: completed.summary ?? completed.output,
      exitCode: completed.exitCode ?? 0,
      stderr: completed.stderr ?? ""
    };
  }
  async *stream(prompt, options = {}) {
    try {
      const startedRun = await this.#startRun(prompt, options);
      for await (const event of startedRun.events) {
        yield event;
      }
    } catch (error) {
      yield {
        type: "session.error",
        error: toError(error)
      };
    }
  }
  async #startRun(prompt, options) {
    const normalizedPrompt = normalizePrompt(prompt);
    const prepared = await this.#prepareRun(options);
    const host = new AgentHost({
      runContext: prepared.runContext,
      model: prepared.model,
      baseSystemPrompt: prepared.baseSystemPrompt,
      maxIterations: prepared.maxIterations,
      createSpawnSession: prepared.createSpawnSession
    });
    return {
      ...prepared,
      events: runAcpCore({
        prompt: normalizedPrompt,
        runContext: prepared.runContext,
        host,
        model: prepared.model,
        baseSystemPrompt: prepared.baseSystemPrompt,
        maxIterations: prepared.maxIterations,
        onPromptSubmitted: options.onPromptSubmitted
      })
    };
  }
  async #prepareRun(options) {
    assertPositiveIntegerOption(options.maxIterations, "maxIterations");
    const activeSkills = resolveActiveSkills(options);
    const runContext = createRunContext({
      ...(activeSkills === undefined ? {} : { activeSkills }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.fileAwareness === undefined ? {} : { fileAwareness: options.fileAwareness })
    });
    runContext.registerDisposeHook(
      linkExternalAbortSignal(options.signal, runContext.abortController)
    );
    try {
      assertNotAborted(runContext.abortController.signal);
      const plugins = resolvePluginSetupOrder(toRuntimePlugins(this.#config));
      await runPluginSetup(plugins, runContext);
      assertNotAborted(runContext.abortController.signal);
      const spawnMcpServers =
        runContext.mcpServers.length === 0 ? undefined : toSpawnMcpServers(runContext.mcpServers);
      injectResumeMessages(runContext.messages, options.resume?.messages);
      const modelName = resolveModelName(this.#config.model, options.acpModel);
      assertNotAborted(runContext.abortController.signal);
      const baseSystemPrompt = options.baseSystemPrompt;
      const model =
        options.acpModel ??
        (await (async () => {
          const providers = collectProviders(plugins);
          const provider = resolveProvider(providers, modelName);
          const providerContext = {
            fetch: options.fetch ?? globalThis.fetch,
            signal: runContext.abortController.signal,
            logger: runContext.logger,
            options: mergeRunProviderOptions(getResolvedProviderOptions(provider), options)
          };
          return provider.createModel(modelName, providerContext);
        })());
      assertNotAborted(runContext.abortController.signal);
      return {
        runContext,
        baseSystemPrompt,
        maxIterations: options.maxIterations ?? 100,
        createSpawnSession:
          options.createSpawnSession ??
          (() => {
            const mode = runContext.session.get(POLICY_MODE_SESSION_KEY);
            return createInMemorySpawnSession({
              model: modelName,
              cwd: options.cwd ?? process.cwd(),
              ...(mode === undefined ? {} : { mode }),
              ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
              ...(options.env === undefined ? {} : { env: options.env }),
              ...(spawnMcpServers === undefined ? {} : { mcpServers: spawnMcpServers })
            });
          }),
        model
      };
    } catch (error) {
      try {
        await runContext.dispose();
      } catch (disposeError) {
        throw new AggregateError(
          [error, disposeError],
          "Run preparation failed and disposal failed."
        );
      }
      throw error;
    }
  }
}
function mergeRunProviderOptions(providerOptions, runOptions) {
  if (
    providerOptions === null ||
    typeof providerOptions !== "object" ||
    Array.isArray(providerOptions)
  ) {
    return providerOptions;
  }
  return {
    ...providerOptions,
    ...(runOptions.apiKey === undefined ? {} : { apiKey: runOptions.apiKey }),
    ...(runOptions.baseUrl === undefined ? {} : { baseUrl: runOptions.baseUrl })
  };
}
const defaultTranscriptFs = {
  mkdir: (dir, options) => fsPromises.mkdir(dir, options).then(() => undefined),
  appendFile: (filePath, contents) => fsPromises.appendFile(filePath, contents, "utf8"),
  lstat: (filePath) => fsPromises.lstat(filePath)
};
export function agent() {
  return new ImmutableAgentBuilder();
}
class CallerAcpHost {
  #runContext;
  #delegate;
  #autoHandleIntent;
  #state = new native.NativeAgentCallerPending();
  #pending = new Map();
  constructor(runContext, delegate, autoHandleIntent) {
    this.#runContext = runContext;
    this.#delegate = delegate;
    this.#autoHandleIntent = autoHandleIntent;
    const onAbort = () => {
      this.#rejectPending(toAbortError(runContext.abortController.signal.reason));
    };
    if (runContext.abortController.signal.aborted) {
      onAbort();
    } else {
      runContext.abortController.signal.addEventListener("abort", onAbort, { once: true });
      runContext.registerDisposeHook(() => {
        runContext.abortController.signal.removeEventListener("abort", onAbort);
      });
    }
  }
  acknowledge(intentId, result) {
    const index = this.#state.take(intentId);
    const pending = this.#pending.get(index);
    if (!pending) {
      throw new Error(`Unknown or already acknowledged tool intent: ${intentId}`);
    }
    this.#pending.delete(index);
    pending.resolve(result);
  }
  async handle(intent) {
    if (this.#autoHandleIntent) {
      return this.#autoHandleIntent(intent);
    }
    assertNotAborted(this.#runContext.abortController.signal);
    const index = this.#state.insert(intent.intentId);
    if (index == null) {
      throw new Error(`Duplicate pending tool intent: ${intent.intentId}`);
    }
    return await new Promise((resolve, reject) => {
      this.#pending.set(index, { resolve, reject });
    });
  }
  async fork(request) {
    return this.#delegate.fork(request);
  }
  async spawn(prompt) {
    return this.#delegate.spawn(prompt);
  }
  setEmit(emit) {
    this.#delegate.setEmit?.(emit);
  }
  #rejectPending(error) {
    const pendingEntries = this.#state.drain().map((index) => this.#pending.get(index));
    this.#pending.clear();
    for (const pending of pendingEntries) {
      pending.reject(error);
    }
  }
}
function resolveModelName(configModel, model) {
  const normalized = normalizeNonEmptyString(configModel);
  if (normalized) {
    return normalized;
  }
  if (model) {
    return "injected-acp-model";
  }
  throw new Error("Missing model. Configure one with .model(...).", {
    cause: undefined
  });
}
function toSpawnMcpServers(mcpServers) {
  return Object.fromEntries(
    mcpServers.map((server) => [
      server.name,
      {
        transport: "stdio",
        command: server.command,
        ...(server.args === undefined ? {} : { args: [...server.args] }),
        ...(server.env === undefined ? {} : { env: { ...server.env } }),
        ...(server.timeout === undefined ? {} : { timeout: server.timeout })
      }
    ])
  );
}
function normalizeMcpConfigs(configsOrMap) {
  const [first, ...rest] = configsOrMap;
  if (first === undefined) {
    return [];
  }
  if (rest.length > 0 || isNamedMcpServerConfig(first)) {
    return [first, ...rest];
  }
  return Object.entries(first).map(([name, server]) => ({ name, ...server }));
}
function isNamedMcpServerConfig(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.name === "string" &&
    typeof value.command === "string"
  );
}
function resolveActiveSkills(options) {
  if (options.skills !== undefined) {
    return options.skills;
  }
  return options.activeSkills;
}
function linkExternalAbortSignal(externalSignal, runAbortController) {
  if (!externalSignal) {
    return () => undefined;
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
  return () => {
    externalSignal.removeEventListener("abort", onAbort);
  };
}
function assertNotAborted(signal) {
  if (!signal.aborted) {
    return;
  }
  throw toAbortError(signal.reason);
}
function toAbortError(reason) {
  if (reason instanceof AbortError) {
    return reason;
  }
  return new AbortError("Run aborted.", reason);
}
function injectResumeMessages(target, source) {
  if (!source || source.length === 0) {
    return;
  }
  for (const message of source) {
    target.push({ ...message });
  }
}
export function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = native.agentTrim(value);
  return trimmed.length > 0 ? trimmed : undefined;
}
export function assertPositiveIntegerOption(value, key) {
  if (value === undefined) {
    return;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${key} must be a positive integer.`);
  }
}
function normalizePrompt(prompt) {
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error("Prompt must not be empty.");
  }
  return prompt;
}
function toError(value) {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}
