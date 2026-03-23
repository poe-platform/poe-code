import { createSecretStore } from "auth-store";
import type { CreateAgentSessionOptions } from "./agent-session.js";
import { runAcpCore, type AcpModel, type AcpModelRequestMessage } from "./runtime/acp-core.js";
import {
  AgentHost,
  createInMemorySpawnSession,
  type AgentHostOptions
} from "./runtime/agent-host.js";
import { AbortError } from "./runtime/hooks.js";
import {
  createResolvedAgentConfig,
  cloneAgentPlugin,
  cloneMcpServerConfig,
  resolvePluginSetupOrder,
  toRuntimePlugins,
  type ResolvedAgentConfig
} from "./runtime/config.js";
import type { AgentPlugin, McpServerConfig } from "./runtime/plugin-types.js";
import { runPluginSetup } from "./runtime/plugin-setup.js";
import { createRunContext, type RunContext } from "./runtime/run-context.js";
import type {
  AcpEvent,
  AcpHost,
  ChatMessage,
  ForkRequest,
  ForkResult,
  RunOutput,
  RunResult,
  ToolAckResult,
  ToolIntent
} from "./runtime/types.js";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

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
  fetch?: FetchFn;
  cwd?: string;
  baseSystemPrompt?: string;
  createSpawnSession?: AgentHostOptions["createSpawnSession"];
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

  mcp(...configs: McpServerConfig[]): AgentBuilder {
    return new ImmutableAgentBuilder(
      createResolvedAgentConfig({
        ...this.#config,
        mcpServers: [
          ...this.#config.mcpServers,
          ...configs.map((config) => cloneMcpServerConfig(config))
        ]
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
      maxIterations: options.maxIterations
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
    const events = await this.#startRun(prompt, options).catch((error) => {
      throw toError(error);
    });

    let completed: RunResult | undefined;
    let failed: Error | undefined = undefined;

    for await (const event of events) {
      if (event.type === "session.complete") {
        completed = event.result;
        continue;
      }

      if (event.type === "session.error") {
        failed = event.error;
      }
    }

    if (failed) {
      throw failed;
    }

    if (!completed) {
      throw new Error("Run ended without a terminal event.");
    }

    return completed;
  }

  async *stream(prompt: string, options: AgentRunOptions = {}): AsyncIterable<AcpEvent> {
    try {
      const events = await this.#startRun(prompt, options);
      for await (const event of events) {
        yield event;
      }
    } catch (error) {
      yield {
        type: "session.error",
        error: toError(error)
      };
    }
  }

  async #startRun(prompt: string, options: AgentRunOptions): Promise<AsyncIterable<AcpEvent>> {
    const prepared = await this.#prepareRun(options);
    const host = new AgentHost({
      runContext: prepared.runContext,
      model: prepared.model,
      baseSystemPrompt: prepared.baseSystemPrompt,
      createSpawnSession: prepared.createSpawnSession
    });

    return runAcpCore({
      prompt,
      runContext: prepared.runContext,
      host,
      model: prepared.model,
      baseSystemPrompt: prepared.baseSystemPrompt,
      maxIterations: options.maxIterations
    });
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

      injectResumeMessages(runContext.messages, options.resume?.messages);

      const modelName = resolveModelName(this.#config.model, options.acpModel);
      assertNotAborted(runContext.abortController.signal);
      const baseSystemPrompt = options.baseSystemPrompt;
      const model =
        options.acpModel ??
        (await createPoeAcpModel({
          model: modelName,
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          fetch: options.fetch
        }));
      assertNotAborted(runContext.abortController.signal);

      return {
        runContext,
        baseSystemPrompt,
        createSpawnSession:
          options.createSpawnSession ??
          (() =>
            createInMemorySpawnSession({
              model: modelName,
              cwd: options.cwd ?? process.cwd(),
              ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
              ...(this.#config.mcpServers.length === 0
                ? {}
                : {
                    mcpServers: toSpawnMcpServers(this.#config.mcpServers)
                  })
            })),
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

export function agent(): AgentBuilder {
  return new ImmutableAgentBuilder();
}

type PreparedRun = {
  runContext: RunContext;
  model: AcpModel;
  baseSystemPrompt?: string;
  createSpawnSession: AgentHostOptions["createSpawnSession"];
};

class CallerAcpHost implements AcpHost {
  readonly #runContext: RunContext;
  readonly #delegate: Pick<AcpHost, "fork" | "spawn">;
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
    delegate: Pick<AcpHost, "fork" | "spawn">,
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

  #rejectPending(error: Error): void {
    const pendingEntries = Array.from(this.#pending.values());
    this.#pending.clear();

    for (const pending of pendingEntries) {
      pending.reject(error);
    }
  }
}

async function createPoeAcpModel(options: {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchFn;
}): Promise<AcpModel> {
  const apiKey = await resolveApiKey(options.apiKey);
  const fetchFn = options.fetch ?? globalThis.fetch;
  const endpoint = toChatCompletionsUrl(options.baseUrl ?? "https://api.poe.com");

  return {
    async complete(request) {
      const payload = {
        model: options.model,
        messages: request.messages,
        ...(request.tools.length === 0
          ? {}
          : {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description ?? "",
                  parameters: normalizeToolInputSchema(tool.inputSchema)
                }
              }))
            })
      };

      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: request.signal
      });

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        throw new Error(
          `Poe API request failed (${response.status}): ${details || response.statusText}`
        );
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: AcpModelRequestMessage }>;
      };
      const message = json.choices?.[0]?.message;

      if (!message) {
        throw new Error("Poe API response did not include an assistant message.");
      }

      return {
        message: {
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
          ...(message.tool_calls === undefined
            ? {}
            : {
                tool_calls: message.tool_calls
              })
        }
      };
    }
  };
}

async function resolveApiKey(explicitApiKey: string | undefined): Promise<string> {
  const normalizedExplicitApiKey = normalizeNonEmptyString(explicitApiKey);
  if (normalizedExplicitApiKey) {
    return normalizedExplicitApiKey;
  }

  const { store } = createSecretStore({
    backendEnvVar: "POE_AUTH_BACKEND",
    fileStore: {
      salt: "poe-code:encrypted-file-auth-store:v1",
      defaultDirectory: ".poe-code",
      defaultFileName: "credentials.enc"
    }
  });
  const storedApiKey = normalizeNonEmptyString(await store.get());
  if (storedApiKey) {
    return storedApiKey;
  }

  throw new Error("Missing Poe API key. Provide apiKey or run 'poe-code login'.");
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

function toChatCompletionsUrl(baseUrl: string): string {
  const trimmedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  if (trimmedBaseUrl.endsWith("/v1")) {
    return `${trimmedBaseUrl}/chat/completions`;
  }

  return `${trimmedBaseUrl}/v1/chat/completions`;
}

function normalizeToolInputSchema(schema: unknown): {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
} {
  if (typeof schema === "object" && schema !== null && !Array.isArray(schema)) {
    const objectSchema = schema as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };

    return {
      type: objectSchema.type === "object" ? "object" : "object",
      properties: objectSchema.properties ?? {},
      ...(objectSchema.required === undefined ? {} : { required: [...objectSchema.required] })
    };
  }

  return {
    type: "object",
    properties: {}
  };
}

function toSpawnMcpServers(
  mcpServers: ReadonlyArray<McpServerConfig>
): NonNullable<CreateAgentSessionOptions["mcpServers"]> {
  const byName: NonNullable<CreateAgentSessionOptions["mcpServers"]> = {};

  for (const server of mcpServers) {
    byName[server.name] = {
      transport: "stdio",
      command: server.command,
      ...(server.args === undefined ? {} : { args: [...server.args] }),
      ...(server.env === undefined ? {} : { env: { ...server.env } })
    };
  }

  return byName;
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
