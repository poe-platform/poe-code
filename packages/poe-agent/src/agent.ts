import * as fsPromises from "node:fs/promises";
import type { McpSpawnConfig } from "@poe-code/agent-spawn";
import type { CreateAgentSessionOptions } from "./agent-session.js";
import mcpPlugin from "./plugins/poe-agent-plugin-mcp.js";
import { POLICY_MODE_SESSION_KEY } from "./plugins/poe-agent-plugin-policy.js";
import { runAcpCore, type AcpModel } from "./runtime/acp-core.js";
import {
  AgentHost,
  createInMemorySpawnSession,
  type AgentHostOptions
} from "./runtime/agent-host.js";
import { AbortError } from "./runtime/hooks.js";
import {
  createResolvedAgentConfig,
  cloneAgentPlugin,
  resolvePluginSetupOrder,
  toRuntimePlugins,
  type ResolvedAgentConfig
} from "./runtime/config.js";
import { getResolvedProviderOptions } from "./runtime/provider-metadata.js";
import type { AgentPlugin, McpServerConfig } from "./runtime/plugin-types.js";
import { runPluginSetup } from "./runtime/plugin-setup.js";
import { collectProviders, resolveProvider } from "./runtime/resolve-provider.js";
import { createRunContext, type RunContext } from "./runtime/run-context.js";
import {
  createTranscriptWriter,
  type TranscriptFsApi,
  type TranscriptWriter
} from "./runtime/transcript.js";
import { assertValidToolName } from "./runtime/tool-names.js";
import type {
  AcpEvent,
  AcpHost,
  ChatMessage,
  ForkRequest,
  ForkResult,
  RunOutput,
  RunResult,
  Tool,
  ToolAckResult,
  ToolCallRecord,
  ToolIntent,
  UsageInfo
} from "./runtime/types.js";

export type AgentRunOptions = {
  signal?: AbortSignal;
  resume?: RunResult;
  skills?: string[];
  // Backward compatibility alias for `skills`.
  activeSkills?: string[];
  maxIterations?: number;
  acpModel?: AcpModel;
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  cwd?: string;
  baseSystemPrompt?: string;
  createSpawnSession?: AgentHostOptions["createSpawnSession"];
  onStdout?: (chunk: string) => void;
  logPath?: string;
};

type InternalAgentRunOptions = AgentRunOptions & {
  __legacyAutoHandleTools?: boolean;
};

export type AcpSession = {
  events: AsyncIterable<AcpEvent>;
  acknowledge(intentId: string, result: ToolAckResult): void;
  dispose(): Promise<void>;
};

export type AgentBuilder = {
  model(model: string): AgentBuilder;
  use(plugin: AgentPlugin): AgentBuilder;
  tools(...tools: Tool[]): AgentBuilder;
  mcp(configs: McpSpawnConfig): AgentBuilder;
  mcp(...configs: McpServerConfig[]): AgentBuilder;
  acp(prompt: string, options?: AgentRunOptions): Promise<AcpSession>;
  run(prompt: string, options?: AgentRunOptions): Promise<RunResult>;
  stream(prompt: string, options?: AgentRunOptions): AsyncIterable<AcpEvent>;
};

class ImmutableAgentBuilder implements AgentBuilder {
  readonly #config: ResolvedAgentConfig;

  constructor(config?: ResolvedAgentConfig) {
    this.#config = config ?? createResolvedAgentConfig();
  }

  model(model: string): AgentBuilder {
    return new ImmutableAgentBuilder(
      createResolvedAgentConfig({
        ...this.#config,
        model
      })
    );
  }

  use(plugin: AgentPlugin): AgentBuilder {
    return new ImmutableAgentBuilder(
      createResolvedAgentConfig({
        ...this.#config,
        plugins: [...this.#config.plugins, cloneAgentPlugin(plugin)]
      })
    );
  }

  tools(...tools: Tool[]): AgentBuilder {
    for (const tool of tools) {
      assertValidToolName(tool.name);
    }

    return this.use({
      name: `inline-tools-${this.#config.plugins.length + 1}`,
      tools
    });
  }

  mcp(configs: McpSpawnConfig): AgentBuilder;
  mcp(...configs: McpServerConfig[]): AgentBuilder;
  mcp(...configsOrMap: [McpSpawnConfig] | McpServerConfig[]): AgentBuilder {
    const configs = normalizeMcpConfigs(configsOrMap);

    return new ImmutableAgentBuilder(
      createResolvedAgentConfig({
        ...this.#config,
        plugins: [...this.#config.plugins, ...configs.map((config) => mcpPlugin(config))]
      })
    );
  }

  async acp(prompt: string, options: AgentRunOptions = {}): Promise<AcpSession> {
    const prepared = await this.#prepareRun(options).catch((error) => {
      throw toError(error);
    });

    const autoHandleTools = (options as InternalAgentRunOptions).__legacyAutoHandleTools === true;
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
      prompt,
      runContext: prepared.runContext,
      host,
      model: prepared.model,
      baseSystemPrompt: prepared.baseSystemPrompt,
      maxIterations: prepared.maxIterations
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

  async run(prompt: string, options: AgentRunOptions = {}): Promise<RunResult> {
    const startedRun = await this.#startRun(prompt, options).catch((error) => {
      throw toError(error);
    });
    const { events, runContext } = startedRun;

    let completed: RunResult | undefined;
    let failed: Error | undefined;
    let usage: UsageInfo | undefined;
    let streamedOutput = "";
    const streamedToolCalls = new Map<
      string,
      {
        intentId: string;
        tool: string;
        args: unknown;
        status?: ToolCallRecord["status"];
        result?: unknown;
        error?: string;
      }
    >();
    const transcript: TranscriptWriter | undefined = options.logPath
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
            status: "success" as const,
            result: toolCall.result
          };
        }

        return {
          intentId: toolCall.intentId,
          tool: toolCall.tool,
          args: toolCall.args,
          status: "error" as const,
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

  async *stream(prompt: string, options: AgentRunOptions = {}): AsyncIterable<AcpEvent> {
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

  async #startRun(prompt: string, options: AgentRunOptions): Promise<StartedRun> {
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
        prompt,
        runContext: prepared.runContext,
        host,
        model: prepared.model,
        baseSystemPrompt: prepared.baseSystemPrompt,
        maxIterations: prepared.maxIterations
      })
    };
  }

  async #prepareRun(options: AgentRunOptions): Promise<PreparedRun> {
    const activeSkills = resolveActiveSkills(options);
    const runContext = createRunContext({
      ...(activeSkills === undefined ? {} : { activeSkills })
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
            const mode = runContext.session.get(
              POLICY_MODE_SESSION_KEY
            ) as CreateAgentSessionOptions["mode"];

            return createInMemorySpawnSession({
              model: modelName,
              cwd: options.cwd ?? process.cwd(),
              ...(mode === undefined ? {} : { mode }),
              ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
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

function mergeRunProviderOptions(providerOptions: unknown, runOptions: AgentRunOptions): unknown {
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

const defaultTranscriptFs: TranscriptFsApi = {
  mkdir: (dir, options) => fsPromises.mkdir(dir, options).then(() => undefined),
  appendFile: (filePath, contents) => fsPromises.appendFile(filePath, contents, "utf8"),
  lstat: (filePath) => fsPromises.lstat(filePath)
};

export function agent(): AgentBuilder {
  return new ImmutableAgentBuilder();
}

type PreparedRun = {
  runContext: RunContext;
  model: AcpModel;
  baseSystemPrompt?: string;
  maxIterations: number;
  createSpawnSession: AgentHostOptions["createSpawnSession"];
};

type StartedRun = PreparedRun & {
  events: AsyncIterable<AcpEvent>;
};

class CallerAcpHost implements AcpHost {
  readonly #runContext: RunContext;
  readonly #delegate: Pick<AcpHost, "fork" | "spawn" | "setEmit">;
  readonly #autoHandleIntent?: (intent: ToolIntent) => Promise<ToolAckResult>;
  readonly #pending = new Map<
    string,
    {
      resolve(result: ToolAckResult): void;
      reject(error: Error): void;
    }
  >();

  constructor(
    runContext: RunContext,
    delegate: Pick<AcpHost, "fork" | "spawn" | "setEmit">,
    autoHandleIntent?: (intent: ToolIntent) => Promise<ToolAckResult>
  ) {
    this.#runContext = runContext;
    this.#delegate = delegate;
    this.#autoHandleIntent = autoHandleIntent;

    const onAbort = (): void => {
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

  acknowledge(intentId: string, result: ToolAckResult): void {
    const pending = this.#pending.get(intentId);
    if (!pending) {
      throw new Error(`Unknown or already acknowledged tool intent: ${intentId}`);
    }

    this.#pending.delete(intentId);
    pending.resolve(result);
  }

  async handle(intent: ToolIntent): Promise<ToolAckResult> {
    if (this.#autoHandleIntent) {
      return this.#autoHandleIntent(intent);
    }

    assertNotAborted(this.#runContext.abortController.signal);

    if (this.#pending.has(intent.intentId)) {
      throw new Error(`Duplicate pending tool intent: ${intent.intentId}`);
    }

    return await new Promise<ToolAckResult>((resolve, reject) => {
      this.#pending.set(intent.intentId, { resolve, reject });
    });
  }

  async fork(request: ForkRequest): Promise<ForkResult> {
    return this.#delegate.fork(request);
  }

  async spawn(prompt: string): Promise<RunOutput> {
    return this.#delegate.spawn(prompt);
  }

  setEmit(emit: (event: AcpEvent) => void): void {
    this.#delegate.setEmit?.(emit);
  }

  #rejectPending(error: Error): void {
    const pendingEntries = Array.from(this.#pending.values());
    this.#pending.clear();

    for (const pending of pendingEntries) {
      pending.reject(error);
    }
  }
}

function resolveModelName(configModel: string | undefined, model: AcpModel | undefined): string {
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

function toSpawnMcpServers(
  mcpServers: ReadonlyArray<McpServerConfig>
): NonNullable<CreateAgentSessionOptions["mcpServers"]> {
  return Object.fromEntries(
    mcpServers.map((server) => [
      server.name,
      {
        transport: "stdio",
        command: server.command,
        ...(server.args === undefined ? {} : { args: [...server.args] }),
        ...(server.env === undefined ? {} : { env: { ...server.env } })
      }
    ])
  );
}

function normalizeMcpConfigs(
  configsOrMap: [McpSpawnConfig] | McpServerConfig[]
): McpServerConfig[] {
  const [first, ...rest] = configsOrMap;
  if (first === undefined) {
    return [];
  }

  if (rest.length > 0 || isNamedMcpServerConfig(first)) {
    return [first, ...rest] as McpServerConfig[];
  }

  return Object.entries(first).map(([name, server]) => ({ name, ...server }));
}

function isNamedMcpServerConfig(value: McpSpawnConfig | McpServerConfig): value is McpServerConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.name === "string" &&
    typeof value.command === "string"
  );
}

function resolveActiveSkills(options: AgentRunOptions): string[] | undefined {
  if (options.skills !== undefined) {
    return options.skills;
  }

  return options.activeSkills;
}

function linkExternalAbortSignal(
  externalSignal: AbortSignal | undefined,
  runAbortController: AbortController
): () => void {
  if (!externalSignal) {
    return () => undefined;
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

  return () => {
    externalSignal.removeEventListener("abort", onAbort);
  };
}

function assertNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }

  throw toAbortError(signal.reason);
}

function toAbortError(reason: unknown): AbortError {
  if (reason instanceof AbortError) {
    return reason;
  }

  return new AbortError("Run aborted.", reason);
}

function injectResumeMessages(
  target: ChatMessage[],
  source: ReadonlyArray<ChatMessage> | undefined
): void {
  if (!source || source.length === 0) {
    return;
  }

  for (const message of source) {
    target.push({ ...message });
  }
}

export function normalizeNonEmptyString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return new Error(String(value));
}
