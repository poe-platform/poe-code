import type { ObjectSchema, Static } from "@poe-code/cmdkit-schema";
import type { LoggerOutput, RenderTableOptions, ThemePalette } from "@poe-code/design-system";

const commandConfigSymbol = Symbol("cmdkit.command.config");
const groupConfigSymbol = Symbol("cmdkit.group.config");

type ScopeValue = "cli" | "mcp" | "sdk";
type AnyObjectSchema = ObjectSchema<Record<string, never>>;
type EmptyServices = Record<string, never>;

export type Scope = ScopeValue;

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
  writeFile(path: string, contents: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface HandlerEnv {
  get(key: string): string | undefined;
}

export interface RenderPrimitives {
  logger: LoggerOutput;
  renderTable(options: RenderTableOptions): string;
  getTheme(): ThemePalette;
}

export interface CheckResult {
  ok: boolean;
  message?: string;
}

export type GroupCheckContext<TServices extends object = EmptyServices> = TServices & {
  params?: unknown;
  secrets?: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
  fs: HandlerFs;
  env: HandlerEnv;
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
  TServices extends object = EmptyServices,
> = TServices & {
  params: Static<TParamsSchema>;
  secrets: InferSecrets<TSecrets>;
  fetch: typeof globalThis.fetch;
  fs: HandlerFs;
  env: HandlerEnv;
  progress(message: string): void;
};

export interface CommandConfig<
  TServices extends object,
  TParamsSchema extends ObjectSchema<any>,
  TSecrets extends SecretDeclarations | undefined,
  TResult,
> {
  name: string;
  description?: string;
  aliases?: string[];
  positional?: string[];
  params: TParamsSchema;
  secrets?: TSecrets;
  scope?: Scope[];
  confirm?: boolean;
  requires?: Requires<HandlerContext<TParamsSchema, TSecrets, TServices>>;
  handler: (ctx: HandlerContext<TParamsSchema, TSecrets, TServices>) => Promise<TResult>;
  render?: Renderers<TResult>;
}

export interface Command<
  TServices extends object = EmptyServices,
  TParamsSchema extends ObjectSchema<any> = AnyObjectSchema,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TResult = unknown,
> {
  kind: "command";
  name: string;
  description?: string;
  aliases: string[];
  positional: string[];
  params: TParamsSchema;
  secrets: SecretDeclarations;
  scope: Scope[];
  confirm: boolean;
  requires?: Requires<HandlerContext<TParamsSchema, TSecrets, TServices>>;
  handler: (ctx: HandlerContext<TParamsSchema, TSecrets, TServices>) => Promise<TResult>;
  render?: Renderers<TResult>;
}

export interface GroupConfig<TServices extends object> {
  name: string;
  description?: string;
  aliases?: string[];
  scope?: Scope[];
  secrets?: SecretDeclarations;
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
  secrets: SecretDeclarations;
  requires?: Requires<GroupCheckContext<TServices>>;
  children: Array<CommandNode<TServices>>;
  default?: Command<TServices, any, any, any>;
}

export type CommandNode<TServices extends object = EmptyServices> =
  | Command<TServices, any, any, any>
  | Group<TServices>;

interface InternalCommandConfig {
  scope?: Scope[];
  secrets: SecretDeclarations;
  requires?: Requires<any>;
}

interface InternalGroupConfig<TServices extends object> {
  scope?: Scope[];
  secrets: SecretDeclarations;
  requires?: Requires<any>;
  children: Array<CommandNode<TServices>>;
  default?: Command<TServices, any, any, any>;
}

interface InheritedMetadata {
  scope?: Scope[];
  secrets: SecretDeclarations;
  requires?: Requires<any>;
}

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

function cloneScope(scope: Scope[] | undefined): Scope[] | undefined {
  return scope === undefined ? undefined : [...scope];
}

function cloneSecretDefinition(secret: SecretDefinition): SecretDefinition {
  return {
    env: secret.env,
    description: secret.description,
    optional: secret.optional,
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

function cloneRequires<TContext>(requires: Requires<TContext> | undefined): Requires<TContext> | undefined {
  if (requires === undefined) {
    return undefined;
  }

  return {
    auth: requires.auth,
    apiVersion: requires.apiVersion,
    check: requires.check,
  };
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

function mergeRequires(parent: Requires<any> | undefined, child: Requires<any> | undefined): Requires<any> | undefined {
  if (parent === undefined && child === undefined) {
    return undefined;
  }

  const merged: Requires<any> = {
    auth: child?.auth ?? parent?.auth,
    apiVersion: child?.apiVersion ?? parent?.apiVersion,
    check: composeChecks(parent?.check, child?.check),
  };

  if (
    merged.auth === undefined &&
    merged.apiVersion === undefined &&
    merged.check === undefined
  ) {
    return undefined;
  }

  return merged;
}

function mergeSecrets(parent: SecretDeclarations, child: SecretDeclarations): SecretDeclarations {
  return cloneSecrets({
    ...parent,
    ...child,
  });
}

function resolveCommandScope(ownScope: Scope[] | undefined, inheritedScope: Scope[] | undefined): Scope[] {
  return cloneScope(ownScope ?? inheritedScope) ?? ["cli", "sdk"];
}

function resolveGroupScope(ownScope: Scope[] | undefined, inheritedScope: Scope[] | undefined): Scope[] | undefined {
  return cloneScope(ownScope ?? inheritedScope);
}

function createBaseCommand<
  TServices extends object,
  TParamsSchema extends ObjectSchema<any>,
  TSecrets extends SecretDeclarations | undefined,
  TResult,
>(
  config: CommandConfig<TServices, TParamsSchema, TSecrets, TResult>
): Command<TServices, TParamsSchema, TSecrets, TResult> {
  const command: Command<TServices, TParamsSchema, TSecrets, TResult> = {
    kind: "command",
    name: config.name,
    description: config.description,
    aliases: [...(config.aliases ?? [])],
    positional: [...(config.positional ?? [])],
    params: config.params,
    secrets: cloneSecrets(config.secrets),
    scope: resolveCommandScope(config.scope, undefined),
    confirm: config.confirm ?? false,
    requires: cloneRequires(config.requires),
    handler: config.handler,
    render: config.render,
  };

  Object.defineProperty(command, commandConfigSymbol, {
    value: {
      scope: cloneScope(config.scope),
      secrets: cloneSecrets(config.secrets),
      requires: cloneRequires(config.requires),
    } satisfies InternalCommandConfig,
  });

  return command;
}

function createBaseGroup<TServices extends object>(config: GroupConfig<TServices>): Group<TServices> {
  const group: Group<TServices> = {
    kind: "group",
    name: config.name,
    description: config.description,
    aliases: [...(config.aliases ?? [])],
    scope: resolveGroupScope(config.scope, undefined),
    secrets: cloneSecrets(config.secrets),
    requires: cloneRequires(config.requires),
    children: [],
    default: undefined,
  };

  Object.defineProperty(group, groupConfigSymbol, {
    value: {
      scope: cloneScope(config.scope),
      secrets: cloneSecrets(config.secrets),
      requires: cloneRequires(config.requires),
      children: [...config.children],
      default: config.default,
    } satisfies InternalGroupConfig<TServices>,
  });

  return group;
}

function getInternalCommandConfig(command: Command<any, any, any, any>): InternalCommandConfig {
  return (command as Command<any, any, any, any> & { [commandConfigSymbol]: InternalCommandConfig })[
    commandConfigSymbol
  ];
}

function getInternalGroupConfig<TServices extends object>(group: Group<TServices>): InternalGroupConfig<TServices> {
  return (group as Group<TServices> & { [groupConfigSymbol]: InternalGroupConfig<TServices> })[
    groupConfigSymbol
  ];
}

function materializeCommand<
  TServices extends object,
  TParamsSchema extends ObjectSchema<any>,
  TSecrets extends SecretDeclarations | undefined,
  TResult,
>(
  command: Command<TServices, TParamsSchema, TSecrets, TResult>,
  inherited: InheritedMetadata
): Command<TServices, TParamsSchema, TSecrets, TResult> {
  const internal = getInternalCommandConfig(command);

  const materialized: Command<TServices, TParamsSchema, TSecrets, TResult> = {
    kind: "command",
    name: command.name,
    description: command.description,
    aliases: [...command.aliases],
    positional: [...command.positional],
    params: command.params,
    secrets: mergeSecrets(inherited.secrets, internal.secrets),
    scope: resolveCommandScope(internal.scope, inherited.scope),
    confirm: command.confirm,
    requires: mergeRequires(inherited.requires, internal.requires),
    handler: command.handler,
    render: command.render,
  };

  Object.defineProperty(materialized, commandConfigSymbol, {
    value: {
      scope: cloneScope(internal.scope),
      secrets: cloneSecrets(internal.secrets),
      requires: cloneRequires(internal.requires),
    } satisfies InternalCommandConfig,
  });

  return materialized;
}

function materializeGroup<TServices extends object>(
  group: Group<TServices>,
  inherited: InheritedMetadata
): Group<TServices> {
  const internal = getInternalGroupConfig(group);
  const scope = resolveGroupScope(internal.scope, inherited.scope);
  const secrets = mergeSecrets(inherited.secrets, internal.secrets);
  const requires = mergeRequires(inherited.requires, internal.requires);
  const materializedChildren = internal.children.map((child) =>
    materializeNode(child, {
      scope,
      secrets,
      requires,
    })
  );

  let defaultChild: Command<TServices, any, any, any> | undefined;

  if (internal.default !== undefined) {
    const defaultIndex = internal.children.indexOf(internal.default);

    if (defaultIndex === -1) {
      throw new UserError(`Default command "${internal.default.name}" must be listed in children.`);
    }

    const resolvedDefault = materializedChildren[defaultIndex];
    if (resolvedDefault?.kind !== "command") {
      throw new UserError(`Default child "${internal.default.name}" must be a command.`);
    }

    defaultChild = resolvedDefault;
  }

  const materialized: Group<TServices> = {
    kind: "group",
    name: group.name,
    description: group.description,
    aliases: [...group.aliases],
    scope,
    secrets,
    requires,
    children: materializedChildren,
    default: defaultChild,
  };

  Object.defineProperty(materialized, groupConfigSymbol, {
    value: {
      scope: cloneScope(internal.scope),
      secrets: cloneSecrets(internal.secrets),
      requires: cloneRequires(internal.requires),
      children: [...internal.children],
      default: internal.default,
    } satisfies InternalGroupConfig<TServices>,
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
  TParamsSchema extends ObjectSchema<any> = AnyObjectSchema,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TResult = unknown,
>(
  config: CommandConfig<TServices, TParamsSchema, TSecrets, TResult>
): Command<TServices, TParamsSchema, TSecrets, TResult> {
  return materializeCommand(createBaseCommand(config), {
    scope: undefined,
    secrets: {},
    requires: undefined,
  });
}

export function defineGroup<TServices extends object = EmptyServices>(
  config: GroupConfig<TServices>
): Group<TServices> {
  return materializeGroup(createBaseGroup(config), {
    scope: undefined,
    secrets: {},
    requires: undefined,
  });
}

export type { AnySchema, ArraySchema, BooleanSchema, EnumSchema, JsonSchema, NumberSchema, ObjectSchema, OptionalSchema, Static, StringSchema } from "@poe-code/cmdkit-schema";
