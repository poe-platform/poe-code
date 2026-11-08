import type { McpServerConfig } from "@poe-code/agent-mcp-config";
import type { AnySchema, ObjectSchema, Static } from "toolcraft-schema";
import type { LoggerOutput, RenderTableOptions, ThemePalette } from "toolcraft-design";
import type { RuntimeLogger } from "./index.js";

type ScopeValue = "cli" | "mcp" | "sdk";

type AnyObjectSchema = ObjectSchema<Record<string, never>>;

type EmptyServices = Record<string, never>;

type ScopeInput = readonly Scope[] | undefined;

type HumanInLoopMode = "sync" | "async";

type HumanInLoopModeInput = HumanInLoopMode | null | undefined;

export type Scope = ScopeValue;

export type MCPResultValue =
  | Record<string, unknown>
  | readonly unknown[]
  | string
  | number
  | boolean
  | null;

type ResolveOwnHumanInLoopMode<TValue> = TValue extends {
  mode: infer TMode extends HumanInLoopMode;
}
  ? TMode
  : TValue extends null
    ? null
    : undefined;

export interface SecretDefinition {
  env: string;
  description?: string;
  optional?: boolean;
}

export type SecretDeclarations = Record<string, SecretDefinition>;

type OptionalSecretKeys<TSecrets extends SecretDeclarations> = {
  [TKey in keyof TSecrets]: TSecrets[TKey] extends {
    optional: true;
  }
    ? TKey
    : never;
}[keyof TSecrets];

type RequiredSecretKeys<TSecrets extends SecretDeclarations> = Exclude<
  keyof TSecrets,
  OptionalSecretKeys<TSecrets>
>;

export type InferSecrets<TSecrets extends SecretDeclarations | undefined> =
  TSecrets extends SecretDeclarations
    ? {
        [TKey in RequiredSecretKeys<TSecrets>]: string;
      } & {
        [TKey in OptionalSecretKeys<TSecrets>]?: string;
      }
    : Record<string, never>;

export interface HandlerFs {
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    contents: string,
    options?: {
      encoding?: BufferEncoding;
      flag?: string;
      mode?: number;
    }
  ): Promise<void>;
  exists(path: string): Promise<boolean>;
  lstat(path: string): Promise<{
    isSymbolicLink(): boolean;
  }>;
  rename(fromPath: string, toPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface HandlerEnv {
  get(key: string): string | undefined;
}

export interface RenderPrimitives {
  logger: LoggerOutput;
  renderTable(options: RenderTableOptions): string;
  getTheme(): ThemePalette;
  note(message: string, title?: string): void;
  outputFormat: string;
}

export interface CheckResult {
  ok: boolean;
  message?: string;
}

export interface CommandExample {
  title: string;
  params: Record<string, unknown>;
}

export type GroupCheckContext<TServices extends object = EmptyServices> = TServices &
  HandlerInvocationCapabilities & {
    params?: unknown;
    secrets?: Record<string, string | undefined>;
    fetch: typeof globalThis.fetch;
    fs: HandlerFs;
    env: HandlerEnv;
    diagnostics: RuntimeLogger;
    signal?: AbortSignal;
    progress(message: string): void;
  };

export type CommandCheckContext<
  TParamsSchema extends ObjectSchema<any> = AnyObjectSchema,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TServices extends object = EmptyServices
> = TServices &
  HandlerInvocationCapabilities & {
    params?: Static<TParamsSchema>;
    secrets?: InferSecrets<TSecrets>;
    fetch: typeof globalThis.fetch;
    fs: HandlerFs;
    env: HandlerEnv;
    diagnostics: RuntimeLogger;
    progress(message: string): void;
  };

export interface Requires<TContext = unknown> {
  auth?: boolean;
  apiVersion?: string;
  check?: (ctx: TContext) => Promise<CheckResult>;
}

export interface Renderers<TResult> {
  rich?: (result: TResult, primitives: RenderPrimitives) => void;
  markdown?: (result: TResult, primitives: RenderPrimitives) => string;
  json?: (result: TResult, primitives: RenderPrimitives) => unknown;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface HandlerInvocationCapabilities {
  readonly signal?: AbortSignal;
}

export type HandlerContext<
  TParamsSchema extends ObjectSchema<any> = AnyObjectSchema,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TServices extends object = EmptyServices
> = TServices &
  HandlerInvocationCapabilities & {
    params: Static<TParamsSchema>;
    secrets: InferSecrets<TSecrets>;
    fetch: typeof globalThis.fetch;
    fs: HandlerFs;
    env: HandlerEnv;
    diagnostics: RuntimeLogger;
    progress(message: string): void;
  };

export interface CommandConfig<
  TServices extends object,
  TParamsSchema extends ObjectSchema<any>,
  TSecrets extends SecretDeclarations | undefined,
  TResult
> {
  name: string;
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
  hidden?: boolean;
  examples?: CommandExample[];
  aliases?: string[];
  positional?: string[];
  params: TParamsSchema;
  result?: AnySchema;
  mcpResult?: (result: TResult) => MCPResultValue;
  secrets?: TSecrets;
  scope?: Scope[];
  confirm?: boolean;
  humanInLoop?: HumanInLoopConfig<TParamsSchema> | null;
  requires?: Requires<CommandCheckContext<TParamsSchema, TSecrets, TServices>>;
  handler: (ctx: HandlerContext<TParamsSchema, TSecrets, TServices>) => Promise<TResult> | TResult;
  render?: Renderers<TResult>;
}

export interface StreamDefinition<TEventSchema extends AnySchema = AnySchema> {
  event: TEventSchema;
  bufferSize: number;
}

export type StreamHandlerContext<
  TParamsSchema extends ObjectSchema<any>,
  TSecrets extends SecretDeclarations | undefined,
  TServices extends object
> = HandlerContext<TParamsSchema, TSecrets, TServices> & {
  signal: AbortSignal;
  status(event: StreamStatusEvent): void;
  refreshSecrets(): Promise<InferSecrets<TSecrets>>;
};

export interface StreamCommandConfig<
  TServices extends object,
  TParamsSchema extends ObjectSchema<any>,
  TSecrets extends SecretDeclarations | undefined,
  TEventSchema extends AnySchema
> extends Omit<
  CommandConfig<TServices, TParamsSchema, TSecrets, AsyncIterable<Static<TEventSchema>>>,
  "handler" | "render" | "result" | "mcpResult" | "humanInLoop" | "confirm"
> {
  event: TEventSchema;
  handler: (
    ctx: StreamHandlerContext<TParamsSchema, TSecrets, TServices>
  ) => AsyncIterable<Static<TEventSchema>> | Promise<AsyncIterable<Static<TEventSchema>>>;
  render?: Renderers<Static<TEventSchema>>;
}

export interface Command<
  TServices extends object = EmptyServices,
  TParamsSchema extends ObjectSchema<any> = AnyObjectSchema,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TResult = unknown
> {
  kind: "command";
  name: string;
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
  hidden: boolean;
  examples: CommandExample[];
  aliases: string[];
  positional: string[];
  params: TParamsSchema;
  result?: AnySchema;
  mcpResult?: (result: TResult) => MCPResultValue;
  stream?: StreamDefinition<any>;
  secrets: SecretDeclarations;
  scope: Scope[];
  confirm: boolean;
  humanInLoop?: HumanInLoopConfig<TParamsSchema> | null;
  requires?: Requires<any>;
  handler: (ctx: HandlerContext<TParamsSchema, TSecrets, TServices>) => Promise<TResult> | TResult;
  render?: Renderers<TResult>;
}

export interface GroupConfig<TServices extends object> {
  name: string;
  description?: string;
  aliases?: string[];
  mcp?: McpServerConfig;
  scope?: Scope[];
  humanInLoop?: HumanInLoopConfig<AnyObjectSchema> | null;
  secrets?: SecretDeclarations;
  tools?: string[];
  rename?: Record<string, string>;
  requires?: Requires<GroupCheckContext<TServices>>;
  children: Array<CommandNode<TServices>>;
  default?: Command<TServices, any, any, any>;
}

export interface Group<TServices extends object = EmptyServices> {
  kind: "group";
  name: string;
  description?: string;
  aliases: string[];
  scope?: Scope[];
  humanInLoop?: HumanInLoopConfig<AnyObjectSchema> | null;
  secrets: SecretDeclarations;
  requires?: Requires<any>;
  children: Array<CommandNode<TServices>>;
  default?: Command<TServices, any, any, any>;
}

export type CommandNode<TServices extends object = EmptyServices> =
  | Command<TServices, any, any, any>
  | Group<TServices>;

export interface CommandTypeInfo<
  TName extends string = string,
  TParamsSchema extends ObjectSchema<any> = AnyObjectSchema,
  TResult = unknown,
  TOwnScope extends ScopeInput = ScopeInput,
  TOwnHumanInLoopMode extends HumanInLoopModeInput = undefined
> {
  name: TName;
  params: TParamsSchema;
  result: TResult;
  ownScope: TOwnScope;
  ownHumanInLoopMode: TOwnHumanInLoopMode;
}

export interface GroupTypeInfo<
  TServices extends object = EmptyServices,
  TName extends string = string,
  TChildren extends readonly unknown[] = readonly CommandNode<TServices>[],
  TOwnScope extends ScopeInput = ScopeInput,
  TOwnHumanInLoopMode extends HumanInLoopModeInput = undefined
> {
  name: TName;
  children: TChildren;
  ownScope: TOwnScope;
  ownHumanInLoopMode: TOwnHumanInLoopMode;
}

type TypedCommandMetadata<
  TName extends string,
  TParamsSchema extends ObjectSchema<any>,
  TResult,
  TOwnScope extends ScopeInput,
  TOwnHumanInLoopMode extends HumanInLoopModeInput
> = {
  readonly __agentKitCommandTypeInfo: CommandTypeInfo<
    TName,
    TParamsSchema,
    TResult,
    TOwnScope,
    TOwnHumanInLoopMode
  >;
};

type TypedGroupMetadata<
  TServices extends object,
  TName extends string,
  TChildren extends readonly unknown[],
  TOwnScope extends ScopeInput,
  TOwnHumanInLoopMode extends HumanInLoopModeInput
> = {
  readonly __agentKitGroupTypeInfo: GroupTypeInfo<
    TServices,
    TName,
    TChildren,
    TOwnScope,
    TOwnHumanInLoopMode
  >;
};

export interface CommandRequirementOptions {
  apiVersion?: string;
  authEnvVar?: string;
  env?: Record<string, string | undefined>;
}

export declare function resolveCommandSecrets(
  command: Command<any, any, any, any>,
  env?: Record<string, string | undefined>
): Record<string, string | undefined>;

export declare function assertCommandRequirements(
  command: Command<any, any, any, any>,
  context: GroupCheckContext<any>,
  options?: CommandRequirementOptions
): Promise<void>;

export declare function defineCommand<
  TServices extends object = EmptyServices,
  TName extends string = string,
  TParamsSchema extends ObjectSchema<any> = AnyObjectSchema,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TResult = unknown,
  TOwnScope extends ScopeInput = undefined,
  TOwnHumanInLoop extends { mode: HumanInLoopMode } | null | undefined = undefined
>(
  config: Omit<
    CommandConfig<TServices, TParamsSchema, TSecrets, TResult>,
    "name" | "scope" | "humanInLoop"
  > & {
    name: TName;
    scope?: TOwnScope;
    // Reverse mapping infers mode before contextually typing callbacks; the direct
    // branch preserves inference for null opt-outs and pretyped configurations.
    humanInLoop?: (TOwnHumanInLoop | { [K in keyof TOwnHumanInLoop]: TOwnHumanInLoop[K] }) &
      (HumanInLoopConfig<TParamsSchema> | null);
  }
): Command<TServices, TParamsSchema, TSecrets, TResult> &
  TypedCommandMetadata<
    TName,
    TParamsSchema,
    TResult,
    TOwnScope,
    ResolveOwnHumanInLoopMode<TOwnHumanInLoop>
  >;

export declare function defineStreamCommand<
  TServices extends object = EmptyServices,
  TName extends string = string,
  TParamsSchema extends ObjectSchema<any> = AnyObjectSchema,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TEventSchema extends AnySchema = AnySchema,
  TOwnScope extends ScopeInput = undefined
>(
  config: Omit<
    StreamCommandConfig<TServices, TParamsSchema, TSecrets, TEventSchema>,
    "name" | "scope"
  > & {
    name: TName;
    scope?: TOwnScope;
  }
): Command<TServices, TParamsSchema, TSecrets, AsyncIterable<Static<TEventSchema>>> &
  TypedCommandMetadata<
    TName,
    TParamsSchema,
    ToolcraftStream<Static<TEventSchema>>,
    TOwnScope,
    undefined
  >;

export declare function defineGroup<
  TServices extends object = EmptyServices,
  TName extends string = string,
  TChildren extends readonly unknown[] = readonly CommandNode<TServices>[],
  TOwnScope extends ScopeInput = undefined,
  TOwnHumanInLoop extends HumanInLoopConfig<AnyObjectSchema> | null | undefined = undefined
>(
  config: Omit<GroupConfig<TServices>, "name" | "children" | "scope" | "humanInLoop"> & {
    name: TName;
    children: TChildren & readonly CommandNode<TServices>[];
    scope?: TOwnScope;
    humanInLoop?: TOwnHumanInLoop;
  }
): Group<TServices> &
  TypedGroupMetadata<
    TServices,
    TName,
    TChildren,
    TOwnScope,
    ResolveOwnHumanInLoopMode<TOwnHumanInLoop>
  >;

export type ClonedCommandNode<TNode extends CommandNode<any>> =
  TNode extends Command<infer TServices, infer TParams, infer TSecrets, infer TResult>
    ? Command<TServices, TParams, TSecrets, TResult> &
        Pick<TNode, Extract<keyof TNode, "__agentKitCommandTypeInfo">>
    : TNode extends Group<infer TServices>
      ? Group<TServices> & Pick<TNode, Extract<keyof TNode, "__agentKitGroupTypeInfo">>
      : never;

export declare function cloneCommandNode<TNode extends CommandNode<any>>(
  node: TNode
): ClonedCommandNode<TNode>;

export declare function cloneCommandNode<TServices extends object>(
  node: CommandNode<TServices>,
  scopeOverride: Scope[]
): CommandNode<TServices>;

export declare function getCommandSourcePath(
  command: Command<any, any, any, any>
): string | undefined;

export declare function hasMcpProxyConfig(group: Group<any>): boolean;

export interface HumanInLoopConfig<TParamsSchema extends ObjectSchema<any>> {
  mode: "sync" | "async";
  message: (ctx: { params: Static<TParamsSchema>; commandPath: string }) => string;
  plan?: (ctx: {
    params: Static<TParamsSchema>;
    commandPath: string;
  }) => unknown | Promise<unknown>;
  declineInputPrompt?: string;
}

export interface HumanInLoopRuntime {
  invoke<T>(
    node: Command<any, any, any, T>,
    ctx: HandlerContext<any, any, any>,
    commandPath: string
  ): Promise<T | HumanInLoopPending>;
  mergeApprovalsGroup<TServices extends object>(root: Group<TServices>): Group<TServices>;
}

export interface HumanInLoopPending {
  status: "pending-approval";
  approvalId: string;
  message: string;
  enqueuedAt: string;
  planHash?: string;
}

export type StreamStatusType = "connected" | "progress" | "reconnecting";

export interface StreamStatusEvent {
  type: StreamStatusType;
  message?: string;
}

export interface StreamConsumerOptions {
  signal?: AbortSignal;
  onStatus?: (event: StreamStatusEvent) => void;
}

export interface ToolcraftStream<TEvent> extends AsyncIterable<TEvent> {
  readonly signal: AbortSignal;
  cancel(reason?: unknown): Promise<void>;
}
