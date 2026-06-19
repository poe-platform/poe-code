import { fileURLToPath } from "node:url";
import type { McpServerConfig } from "@poe-code/agent-mcp-config";
import type { ObjectSchema, Static } from "toolcraft-schema";
import type { LoggerOutput, RenderTableOptions, ThemePalette } from "toolcraft-design";
import { ApprovalDeclinedError } from "./human-in-loop/types.js";
import type {
  HumanInLoopConfig,
  HumanInLoopPending,
  HumanInLoopRuntimeOptions
} from "./human-in-loop/types.js";
import { mergeHumanInLoopFromGroup, validateHumanInLoopOnDefine } from "./human-in-loop/config.js";
import { ToolcraftBugError, UserError } from "./user-error.js";
import { suggest } from "./suggest.js";
import type { RuntimeLogger } from "./runtime-logging.js";

const commandConfigSymbol = Symbol("toolcraft.command.config");
const groupConfigSymbol = Symbol("toolcraft.group.config");
const commandSourcePathSymbol = Symbol("toolcraft.command.sourcePath");

type ScopeValue = "cli" | "mcp" | "sdk";
type AnyObjectSchema = ObjectSchema<Record<string, never>>;
type EmptyServices = Record<string, never>;
type ScopeInput = readonly Scope[] | undefined;
type HumanInLoopMode = "sync" | "async";
type HumanInLoopModeInput = HumanInLoopMode | null | undefined;

export type Scope = ScopeValue;

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
  [TKey in keyof TSecrets]: TSecrets[TKey] extends { optional: true } ? TKey : never;
}[keyof TSecrets];

type RequiredSecretKeys<TSecrets extends SecretDeclarations> = Exclude<
  keyof TSecrets,
  OptionalSecretKeys<TSecrets>
>;

export type InferSecrets<TSecrets extends SecretDeclarations | undefined> =
  TSecrets extends SecretDeclarations
    ? { [TKey in RequiredSecretKeys<TSecrets>]: string } & {
        [TKey in OptionalSecretKeys<TSecrets>]?: string;
      }
    : Record<string, never>;

export interface HandlerFs {
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    contents: string,
    options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
  ): Promise<void>;
  exists(path: string): Promise<boolean>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
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
}

export interface CheckResult {
  ok: boolean;
  message?: string;
}

export interface CommandExample {
  title: string;
  params: Record<string, unknown>;
}

export type GroupCheckContext<TServices extends object = EmptyServices> = TServices & {
  params?: unknown;
  secrets?: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
  fs: HandlerFs;
  env: HandlerEnv;
  diagnostics: RuntimeLogger;
  progress(message: string): void;
};

export type CommandCheckContext<
  TParamsSchema extends ObjectSchema<any> = AnyObjectSchema,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TServices extends object = EmptyServices
> = TServices & {
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

export type HandlerContext<
  TParamsSchema extends ObjectSchema<any> = AnyObjectSchema,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TServices extends object = EmptyServices
> = TServices & {
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
  description?: string;
  hidden?: boolean;
  examples?: CommandExample[];
  aliases?: string[];
  positional?: string[];
  params: TParamsSchema;
  result?: ObjectSchema<any>;
  secrets?: TSecrets;
  scope?: Scope[];
  confirm?: boolean;
  humanInLoop?: HumanInLoopConfig<TParamsSchema> | null;
  requires?: Requires<CommandCheckContext<TParamsSchema, TSecrets, TServices>>;
  handler: (ctx: HandlerContext<TParamsSchema, TSecrets, TServices>) => Promise<TResult>;
  render?: Renderers<TResult>;
}

export interface Command<
  TServices extends object = EmptyServices,
  TParamsSchema extends ObjectSchema<any> = AnyObjectSchema,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TResult = unknown
> {
  kind: "command";
  name: string;
  description?: string;
  hidden: boolean;
  examples: CommandExample[];
  aliases: string[];
  positional: string[];
  params: TParamsSchema;
  result?: ObjectSchema<any>;
  secrets: SecretDeclarations;
  scope: Scope[];
  confirm: boolean;
  humanInLoop?: HumanInLoopConfig<TParamsSchema> | null;
  requires?: Requires<any>;
  handler: (ctx: HandlerContext<TParamsSchema, TSecrets, TServices>) => Promise<TResult>;
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

interface InternalCommandConfig {
  scope?: Scope[];
  hidden: boolean;
  examples: CommandExample[];
  result?: ObjectSchema<any>;
  humanInLoop?: HumanInLoopConfig<ObjectSchema<any>> | null;
  secrets: SecretDeclarations;
  requires?: Requires<any>;
  sourcePath?: string;
}

interface InternalGroupConfig<TServices extends object> {
  mcp?: McpServerConfig;
  scope?: Scope[];
  humanInLoop?: HumanInLoopConfig<AnyObjectSchema> | null;
  secrets: SecretDeclarations;
  tools?: string[];
  rename?: Record<string, string>;
  requires?: Requires<any>;
  children: Array<CommandNode<TServices>>;
  default?: Command<TServices, any, any, any>;
}

interface InheritedMetadata {
  scope?: Scope[];
  humanInLoop?: HumanInLoopConfig<AnyObjectSchema> | null;
  secrets: SecretDeclarations;
  requires?: Requires<any>;
}

export interface CommandRequirementOptions {
  apiVersion?: string;
  authEnvVar?: string;
  env?: Record<string, string | undefined>;
}

function cloneScope(scope: Scope[] | undefined): Scope[] | undefined {
  return scope === undefined ? undefined : [...scope];
}

function cloneSecretDefinition(secret: SecretDefinition): SecretDefinition {
  return {
    env: secret.env,
    description: secret.description,
    optional: secret.optional
  };
}

function cloneSecrets(secrets: SecretDeclarations | undefined): SecretDeclarations {
  if (secrets === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(secrets).map(([key, secret]) => [key, cloneSecretDefinition(secret)])
  );
}

function cloneRequires<TContext>(
  requires: Requires<TContext> | undefined
): Requires<TContext> | undefined {
  if (requires === undefined) {
    return undefined;
  }

  return {
    auth: requires.auth,
    apiVersion: requires.apiVersion,
    check: requires.check
  };
}

function cloneStringArray(values: string[] | undefined): string[] | undefined {
  return values === undefined ? undefined : [...values];
}

function cloneCommandExamples(examples: CommandExample[] | undefined): CommandExample[] {
  return (examples ?? []).map((example) => ({
    title: example.title,
    params: { ...example.params }
  }));
}

function cloneStringRecord(
  values: Record<string, string> | undefined
): Record<string, string> | undefined {
  return values === undefined ? undefined : { ...values };
}

function cloneMcpServerConfig(config: McpServerConfig | undefined): McpServerConfig | undefined {
  if (config === undefined) {
    return undefined;
  }

  if (config.transport === "stdio") {
    return {
      transport: "stdio",
      command: config.command,
      args: cloneStringArray(config.args),
      env: cloneStringRecord(config.env)
    };
  }

  return {
    transport: "http",
    url: config.url,
    headers: cloneStringRecord(config.headers)
  };
}

function cloneRenameMap(
  rename: Record<string, string> | undefined
): Record<string, string> | undefined {
  return rename === undefined ? undefined : { ...rename };
}

function validateRenameMap(rename: Record<string, string> | undefined): void {
  if (rename === undefined) {
    return;
  }

  const seenTargets = new Map<string, string>();

  for (const [upstreamName, targetPath] of Object.entries(rename)) {
    if (targetPath.length === 0) {
      throw new UserError(
        `Invalid rename target for upstream tool "${upstreamName}": path cannot be empty.`
      );
    }

    if (targetPath.split(".").some((segment) => segment.length === 0)) {
      throw new UserError(
        `Invalid rename target for upstream tool "${upstreamName}": "${targetPath}" contains an empty segment.`
      );
    }

    const existingUpstreamName = seenTargets.get(targetPath);
    if (existingUpstreamName !== undefined) {
      throw new UserError(
        `Duplicate rename target "${targetPath}" for upstream tools "${existingUpstreamName}" and "${upstreamName}".`
      );
    }

    seenTargets.set(targetPath, upstreamName);
  }
}

function parseStackPath(candidate: string): string | undefined {
  if (candidate.startsWith("file://")) {
    try {
      return fileURLToPath(candidate);
    } catch {
      return undefined;
    }
  }

  if (candidate.startsWith("/")) {
    return candidate;
  }

  return undefined;
}

function extractStackPath(line: string): string | undefined {
  const trimmed = line.trim();
  const fileIndex = trimmed.indexOf("file://");

  if (fileIndex >= 0) {
    const location = trimmed.slice(fileIndex);
    const separatorIndex = location.lastIndexOf(":");
    const previousSeparatorIndex =
      separatorIndex >= 0 ? location.lastIndexOf(":", separatorIndex - 1) : -1;
    const candidate =
      separatorIndex >= 0 && previousSeparatorIndex >= 0
        ? location.slice(0, previousSeparatorIndex)
        : location;

    return parseStackPath(candidate);
  }

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex < 0) {
    return undefined;
  }

  const location = trimmed.slice(slashIndex);
  const separatorIndex = location.lastIndexOf(":");
  const previousSeparatorIndex =
    separatorIndex >= 0 ? location.lastIndexOf(":", separatorIndex - 1) : -1;
  const candidate =
    separatorIndex >= 0 && previousSeparatorIndex >= 0
      ? location.slice(0, previousSeparatorIndex)
      : location;

  return parseStackPath(candidate);
}

function inferCommandSourcePath(): string | undefined {
  const stack = new Error().stack;

  if (typeof stack !== "string") {
    return undefined;
  }

  for (const line of stack.split("\n").slice(1)) {
    const candidate = extractStackPath(line);

    if (candidate === undefined) {
      continue;
    }

    if (
      candidate.includes("/packages/toolcraft/src/index.ts") ||
      candidate.includes("/packages/toolcraft/dist/index.js") ||
      candidate.includes("/node_modules/toolcraft/dist/index.js")
    ) {
      continue;
    }

    return candidate;
  }

  return undefined;
}

function composeChecks(
  parentCheck: Requires<any>["check"] | undefined,
  childCheck: Requires<any>["check"] | undefined
): Requires<any>["check"] | undefined {
  if (parentCheck === undefined) {
    return childCheck;
  }

  if (childCheck === undefined) {
    return parentCheck;
  }

  return async (ctx) => {
    const parentResult = await parentCheck(ctx);
    if (!parentResult.ok) {
      return parentResult;
    }

    return childCheck(ctx);
  };
}

function mergeRequires(
  parent: Requires<any> | undefined,
  child: Requires<any> | undefined
): Requires<any> | undefined {
  if (parent === undefined && child === undefined) {
    return undefined;
  }

  const merged: Requires<any> = {
    auth: child?.auth ?? parent?.auth,
    apiVersion: child?.apiVersion ?? parent?.apiVersion,
    check: composeChecks(parent?.check, child?.check)
  };

  if (merged.auth === undefined && merged.apiVersion === undefined && merged.check === undefined) {
    return undefined;
  }

  return merged;
}

function parseSimpleSemver(value: string): [number, number, number] | undefined {
  const parts = value.split(".");
  if (parts.length !== 3) {
    return undefined;
  }

  const parsed = parts.map((part) => {
    if (part.length === 0) {
      return Number.NaN;
    }

    for (const char of part) {
      if (char < "0" || char > "9") {
        return Number.NaN;
      }
    }

    return Number(part);
  });

  if (parsed.some((part) => !Number.isInteger(part) || part < 0)) {
    return undefined;
  }

  return parsed as [number, number, number];
}

function parseMinimumApiVersion(requirement: string): [number, number, number] | undefined {
  if (!requirement.startsWith(">=")) {
    return undefined;
  }

  return parseSimpleSemver(requirement.slice(2).trim());
}

function compareSemver(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) {
      continue;
    }

    return left[index]! > right[index]! ? 1 : -1;
  }

  return 0;
}

export function resolveCommandSecrets(
  command: Command<any, any, any, any>,
  env: Record<string, string | undefined> = process.env
): Record<string, string | undefined> {
  const secrets: Record<string, string | undefined> = {};

  for (const [name, secret] of Object.entries(command.secrets)) {
    const value = env[secret.env];

    if (value === undefined && secret.optional !== true) {
      const details = secret.description ? `\n  ${secret.description}` : "";
      const candidates = Object.keys(env).filter(
        (candidate) => candidate !== secret.env && env[candidate] !== undefined
      );
      const suggestions = suggestSecretEnv(secret.env, candidates);
      const suggestionLine =
        suggestions.length > 0 ? `\nDid you mean: ${suggestions.join(", ")}?` : "";
      throw new UserError(`Missing required secret ${secret.env}${details}${suggestionLine}`);
    }

    Object.defineProperty(secrets, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }

  return secrets;
}

function suggestSecretEnv(input: string, candidates: readonly string[]): string[] {
  const directSuggestions = suggest(input, candidates);
  if (!input.includes("_")) {
    return directSuggestions;
  }

  const inputParts = input.split("_");
  const firstPart = inputParts[0];
  const lastPart = inputParts[inputParts.length - 1];
  const relatedCandidates = candidates.filter((candidate) => {
    const candidateParts = candidate.split("_");
    return (
      candidateParts[0] === firstPart && candidateParts[candidateParts.length - 1] === lastPart
    );
  });
  const expandedSuggestions = suggest(input, relatedCandidates, {
    threshold: Math.max(4, Math.floor(input.length / 4))
  });

  return [...new Set([...directSuggestions, ...expandedSuggestions])].slice(0, 3);
}

export async function assertCommandRequirements(
  command: Command<any, any, any, any>,
  context: GroupCheckContext<any>,
  options: CommandRequirementOptions = {}
): Promise<void> {
  const requires = command.requires;
  if (requires === undefined) {
    return;
  }

  const env = options.env ?? process.env;
  const authEnvVar = options.authEnvVar ?? "POE_API_KEY";

  if (requires.auth === true && env[authEnvVar] === undefined) {
    throw new UserError(
      `Command "${command.name}" requires authentication.\n  Run 'poe-code login' first.`
    );
  }

  if (requires.apiVersion !== undefined) {
    const minimumVersion = parseMinimumApiVersion(requires.apiVersion);
    if (minimumVersion === undefined) {
      throw new UserError(
        `Command "${command.name}" has invalid apiVersion requirement "${requires.apiVersion}". Expected format ">=X.Y.Z".`
      );
    }

    if (options.apiVersion === undefined) {
      throw new UserError(
        `Command "${command.name}" requires API version ${requires.apiVersion}, but no runner API version was provided.`
      );
    }

    const runnerVersion = parseSimpleSemver(options.apiVersion);
    if (runnerVersion === undefined) {
      throw new UserError(
        `Command "${command.name}" requires API version ${requires.apiVersion}, but runner API version "${options.apiVersion}" is not valid semver.`
      );
    }

    if (compareSemver(runnerVersion, minimumVersion) < 0) {
      throw new UserError(
        `Command "${command.name}" requires API version ${requires.apiVersion}, but runner API version is ${options.apiVersion}.`
      );
    }
  }

  const checkResult = await requires.check?.(context);
  if (checkResult && !checkResult.ok) {
    throw new UserError(checkResult.message ?? "Command precondition failed.");
  }
}

function mergeSecrets(parent: SecretDeclarations, child: SecretDeclarations): SecretDeclarations {
  return cloneSecrets({
    ...parent,
    ...child
  });
}

function resolveCommandScope(
  ownScope: Scope[] | undefined,
  inheritedScope: Scope[] | undefined
): Scope[] {
  return cloneScope(ownScope ?? inheritedScope) ?? ["cli", "sdk"];
}

function resolveGroupScope(
  ownScope: Scope[] | undefined,
  inheritedScope: Scope[] | undefined
): Scope[] | undefined {
  return cloneScope(ownScope ?? inheritedScope);
}

function createBaseCommand<
  TServices extends object,
  TParamsSchema extends ObjectSchema<any>,
  TSecrets extends SecretDeclarations | undefined,
  TResult
>(
  config: CommandConfig<TServices, TParamsSchema, TSecrets, TResult>
): Command<TServices, TParamsSchema, TSecrets, TResult> {
  const command: Command<TServices, TParamsSchema, TSecrets, TResult> = {
    kind: "command",
    name: config.name,
    description: config.description,
    hidden: config.hidden ?? false,
    examples: cloneCommandExamples(config.examples),
    aliases: [...(config.aliases ?? [])],
    positional: [...(config.positional ?? [])],
    params: config.params,
    result: config.result,
    secrets: cloneSecrets(config.secrets),
    scope: resolveCommandScope(config.scope, undefined),
    confirm: config.confirm ?? false,
    humanInLoop: config.humanInLoop,
    requires: cloneRequires(config.requires),
    handler: config.handler,
    render: config.render
  };

  Object.defineProperty(command, commandConfigSymbol, {
    value: {
      scope: cloneScope(config.scope),
      hidden: config.hidden ?? false,
      examples: cloneCommandExamples(config.examples),
      result: config.result,
      humanInLoop: config.humanInLoop,
      secrets: cloneSecrets(config.secrets),
      requires: cloneRequires(config.requires),
      sourcePath: inferCommandSourcePath()
    } satisfies InternalCommandConfig
  });

  return command;
}

function createBaseGroup<TServices extends object>(
  config: GroupConfig<TServices>
): Group<TServices> {
  const group: Group<TServices> = {
    kind: "group",
    name: config.name,
    description: config.description,
    aliases: [...(config.aliases ?? [])],
    scope: resolveGroupScope(config.scope, undefined),
    humanInLoop: config.humanInLoop,
    secrets: cloneSecrets(config.secrets),
    requires: cloneRequires(config.requires),
    children: [],
    default: undefined
  };

  Object.defineProperty(group, groupConfigSymbol, {
    value: {
      mcp: cloneMcpServerConfig(config.mcp),
      scope: cloneScope(config.scope),
      humanInLoop: config.humanInLoop,
      secrets: cloneSecrets(config.secrets),
      tools: cloneStringArray(config.tools),
      rename: cloneRenameMap(config.rename),
      requires: cloneRequires(config.requires),
      children: [...config.children],
      default: config.default
    } satisfies InternalGroupConfig<TServices>
  });

  return group;
}

function getInternalCommandConfig(command: Command<any, any, any, any>): InternalCommandConfig {
  return (
    command as Command<any, any, any, any> & { [commandConfigSymbol]: InternalCommandConfig }
  )[commandConfigSymbol];
}

function getInternalGroupConfig<TServices extends object>(
  group: Group<TServices>
): InternalGroupConfig<TServices> {
  return (group as Group<TServices> & { [groupConfigSymbol]: InternalGroupConfig<TServices> })[
    groupConfigSymbol
  ];
}

function materializeCommand<
  TServices extends object,
  TParamsSchema extends ObjectSchema<any>,
  TSecrets extends SecretDeclarations | undefined,
  TResult
>(
  command: Command<TServices, TParamsSchema, TSecrets, TResult>,
  inherited: InheritedMetadata
): Command<TServices, TParamsSchema, TSecrets, TResult> {
  const internal = getInternalCommandConfig(command);

  const materialized: Command<TServices, TParamsSchema, TSecrets, TResult> = {
    kind: "command",
    name: command.name,
    description: command.description,
    hidden: internal.hidden,
    examples: cloneCommandExamples(internal.examples),
    aliases: [...command.aliases],
    positional: [...command.positional],
    params: command.params,
    result: internal.result,
    secrets: mergeSecrets(inherited.secrets, internal.secrets),
    scope: resolveCommandScope(internal.scope, inherited.scope),
    confirm: command.confirm,
    humanInLoop: mergeHumanInLoopFromGroup(inherited.humanInLoop, internal.humanInLoop),
    requires: mergeRequires(inherited.requires, internal.requires),
    handler: command.handler,
    render: command.render
  };

  Object.defineProperty(materialized, commandConfigSymbol, {
    value: {
      scope: cloneScope(internal.scope),
      hidden: internal.hidden,
      examples: cloneCommandExamples(internal.examples),
      result: internal.result,
      humanInLoop: internal.humanInLoop,
      secrets: cloneSecrets(internal.secrets),
      requires: cloneRequires(internal.requires),
      sourcePath: internal.sourcePath
    } satisfies InternalCommandConfig
  });

  Object.defineProperty(materialized, commandSourcePathSymbol, {
    value: internal.sourcePath
  });

  return materialized;
}

function mergeInheritedMetadata<TServices extends object>(
  group: InternalGroupConfig<TServices>,
  inherited: InheritedMetadata
): InheritedMetadata {
  return {
    scope: resolveGroupScope(group.scope, inherited.scope),
    humanInLoop: mergeHumanInLoopFromGroup(inherited.humanInLoop, group.humanInLoop),
    secrets: mergeSecrets(inherited.secrets, group.secrets),
    requires: mergeRequires(inherited.requires, group.requires)
  };
}

function materializeGroup<TServices extends object>(
  group: Group<TServices>,
  inherited: InheritedMetadata
): Group<TServices> {
  const internal = getInternalGroupConfig(group);
  const mergedInherited = mergeInheritedMetadata(internal, inherited);
  const materializedChildren = internal.children.map((child) =>
    materializeNode(child, mergedInherited)
  );

  let defaultChild: Command<TServices, any, any, any> | undefined;

  if (internal.default !== undefined) {
    const defaultIndex = internal.children.indexOf(internal.default);

    if (defaultIndex === -1) {
      throw new ToolcraftBugError(
        `Default command "${internal.default.name}" must be listed in children.`
      );
    }

    const resolvedDefault = materializedChildren[defaultIndex];
    if (resolvedDefault?.kind !== "command") {
      throw new ToolcraftBugError(`Default child "${internal.default.name}" must be a command.`);
    }

    defaultChild = resolvedDefault;
  }

  const materialized: Group<TServices> = {
    kind: "group",
    name: group.name,
    description: group.description,
    aliases: [...group.aliases],
    scope: mergedInherited.scope,
    humanInLoop: mergedInherited.humanInLoop,
    secrets: mergedInherited.secrets,
    requires: mergedInherited.requires,
    children: materializedChildren,
    default: defaultChild
  };

  Object.defineProperty(materialized, groupConfigSymbol, {
    value: {
      mcp: cloneMcpServerConfig(internal.mcp),
      scope: cloneScope(internal.scope),
      humanInLoop: internal.humanInLoop,
      secrets: cloneSecrets(internal.secrets),
      tools: cloneStringArray(internal.tools),
      rename: cloneRenameMap(internal.rename),
      requires: cloneRequires(internal.requires),
      children: [...internal.children],
      default: internal.default
    } satisfies InternalGroupConfig<TServices>
  });

  return materialized;
}

function materializeNode<TServices extends object>(
  node: CommandNode<TServices>,
  inherited: InheritedMetadata
): CommandNode<TServices> {
  if (node.kind === "command") {
    return materializeCommand(node, inherited);
  }

  return materializeGroup(node, inherited);
}

export function defineCommand<
  TServices extends object = EmptyServices,
  TName extends string = string,
  TParamsSchema extends ObjectSchema<any> = AnyObjectSchema,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TResult = unknown,
  TOwnScope extends ScopeInput = undefined,
  TOwnHumanInLoop extends HumanInLoopConfig<TParamsSchema> | null | undefined = undefined
>(
  config: Omit<
    CommandConfig<TServices, TParamsSchema, TSecrets, TResult>,
    "name" | "scope" | "humanInLoop"
  > & {
    name: TName;
    scope?: TOwnScope;
    humanInLoop?: TOwnHumanInLoop;
  }
): Command<TServices, TParamsSchema, TSecrets, TResult> &
  TypedCommandMetadata<
    TName,
    TParamsSchema,
    TResult,
    TOwnScope,
    ResolveOwnHumanInLoopMode<TOwnHumanInLoop>
  > {
  validateHumanInLoopOnDefine(config);

  return materializeCommand(
    createBaseCommand(config as CommandConfig<TServices, TParamsSchema, TSecrets, TResult>),
    {
      scope: undefined,
      humanInLoop: undefined,
      secrets: {},
      requires: undefined
    }
  ) as Command<TServices, TParamsSchema, TSecrets, TResult> &
    TypedCommandMetadata<
      TName,
      TParamsSchema,
      TResult,
      TOwnScope,
      ResolveOwnHumanInLoopMode<TOwnHumanInLoop>
    >;
}

export function defineGroup<
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
  > {
  validateRenameMap(config.rename);
  validateHumanInLoopOnDefine(config);

  return materializeGroup(createBaseGroup(config as unknown as GroupConfig<TServices>), {
    scope: undefined,
    humanInLoop: undefined,
    secrets: {},
    requires: undefined
  }) as Group<TServices> &
    TypedGroupMetadata<
      TServices,
      TName,
      TChildren,
      TOwnScope,
      ResolveOwnHumanInLoopMode<TOwnHumanInLoop>
    >;
}

export function getCommandSourcePath(command: Command<any, any, any, any>): string | undefined {
  return (command as Command<any, any, any, any> & { [commandSourcePathSymbol]?: string })[
    commandSourcePathSymbol
  ];
}

export { S, toJsonSchema } from "toolcraft-schema";
export {
  AuthenticationError,
  BadRequestError,
  ClientError,
  ConflictError,
  HttpError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  ServiceUnavailableError,
  UnprocessableEntityError,
  createHttpError
} from "./http-errors.js";
export type { HttpErrorRequest, HttpErrorResponse } from "./http-errors.js";
export { ApprovalDeclinedError, ToolcraftBugError, UserError };
export { createRuntimeLogger, isLogLevel, shouldEmitDiagnostic } from "./runtime-logging.js";
export { findPackageMetadata, packageMetadata } from "./package-metadata.js";
export type { PackageMetadata } from "./package-metadata.js";
export type {
  DiagnosticLogEvent,
  LogLevel,
  RuntimeLogger,
  RuntimeLoggerInput
} from "./runtime-logging.js";
export type {
  AnySchema,
  ArraySchema,
  BooleanSchema,
  EnumSchema,
  JsonSchema,
  NumberSchema,
  ObjectSchema,
  OptionalSchema,
  Static,
  StringSchema
} from "toolcraft-schema";
export type { HumanInLoopConfig, HumanInLoopPending, HumanInLoopRuntimeOptions };
