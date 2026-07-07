import "./node-require-shim.js";
import type { AnySchema, ObjectSchema, Static } from "toolcraft-schema";
import type { Command, Group, HandlerFs, LogLevel, RuntimeLoggerInput, Scope } from "./index.js";
import {
  ToolcraftBugError,
  UserError,
  assertCommandRequirements,
  resolveCommandSecrets
} from "./index.js";
import { writeErrorReport, type ErrorReportsOption } from "./error-report.js";
import { mergeApprovalsGroup } from "./human-in-loop/approvals-commands.js";
import { invokeWithHumanInLoop } from "./human-in-loop/index.js";
import type { HumanInLoopPending, HumanInLoopRuntimeOptions } from "./human-in-loop/index.js";
import { hasMcpProxyGroups, resolveMcpProxies } from "./mcp-proxy.js";
import { getExpectedNumberDescription, isValidNumberSchemaValue } from "./number-schema.js";
import { filterSchemaForScope } from "./schema-scope.js";
import { enableSourceMaps } from "./stack-trim.js";
import { suggest } from "./suggest.js";
import { throwValidationErrors, type ValidationError } from "./validation-errors.js";
import { createRuntimeLogger } from "./runtime-logging.js";
import { createEnv, createFs, validateServices } from "./runtime/io.js";
import { createManagedStream } from "./stream.js";
import type { StreamConsumerOptions, ToolcraftStream } from "./stream.js";

type ScopeInput = readonly Scope[] | undefined;
type HumanInLoopMode = "sync" | "async";
type HumanInLoopModeInput = HumanInLoopMode | null | undefined;
type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type EmptyRecord = Record<never, never>;

type EffectiveCommandScope<
  TOwnScope extends ScopeInput,
  TInheritedScope extends ScopeInput
> = TOwnScope extends readonly Scope[]
  ? TOwnScope
  : TInheritedScope extends readonly Scope[]
    ? TInheritedScope
    : readonly ["cli", "sdk"];

type EffectiveGroupScope<
  TOwnScope extends ScopeInput,
  TInheritedScope extends ScopeInput
> = TOwnScope extends readonly Scope[]
  ? TOwnScope
  : TInheritedScope extends readonly Scope[]
    ? TInheritedScope
    : undefined;

type IncludesSDK<TScope> = TScope extends readonly Scope[]
  ? "sdk" extends TScope[number]
    ? true
    : false
  : false;

type EffectiveCommandHumanInLoopMode<
  TOwnHumanInLoopMode extends HumanInLoopModeInput,
  TInheritedHumanInLoopMode extends HumanInLoopMode | undefined
> = TOwnHumanInLoopMode extends HumanInLoopMode
  ? TOwnHumanInLoopMode
  : TOwnHumanInLoopMode extends null
    ? undefined
    : TInheritedHumanInLoopMode;

type EffectiveGroupHumanInLoopMode<
  TOwnHumanInLoopMode extends HumanInLoopModeInput,
  TInheritedHumanInLoopMode extends HumanInLoopMode | undefined
> = TOwnHumanInLoopMode extends HumanInLoopMode
  ? TOwnHumanInLoopMode
  : TOwnHumanInLoopMode extends null
    ? undefined
    : TInheritedHumanInLoopMode;

type Separator = "-" | "_" | " " | ".";

type IsUppercase<TValue extends string> =
  TValue extends Uppercase<TValue> ? (TValue extends Lowercase<TValue> ? false : true) : false;

type IsLowercase<TValue extends string> =
  TValue extends Lowercase<TValue> ? (TValue extends Uppercase<TValue> ? false : true) : false;

type LastCharacter<TValue extends string> = TValue extends `${infer THead}${infer TTail}`
  ? TTail extends ""
    ? THead
    : LastCharacter<TTail>
  : never;

type PushCurrentWord<
  TCurrent extends string,
  TWords extends readonly string[]
> = TCurrent extends "" ? TWords : [...TWords, Lowercase<TCurrent>];

type SplitCamelWords<
  TValue extends string,
  TCurrent extends string = "",
  TWords extends readonly string[] = []
> = TValue extends `${infer TChar}${infer TRest}`
  ? TChar extends Separator
    ? SplitCamelWords<TRest, "", PushCurrentWord<TCurrent, TWords>>
    : IsUppercase<TChar> extends true
      ? TCurrent extends ""
        ? SplitCamelWords<TRest, TChar, TWords>
        : TRest extends `${infer TNext}${string}`
          ? IsLowercase<LastCharacter<TCurrent>> extends true
            ? SplitCamelWords<TRest, TChar, PushCurrentWord<TCurrent, TWords>>
            : IsLowercase<TNext> extends true
              ? SplitCamelWords<TRest, TChar, PushCurrentWord<TCurrent, TWords>>
              : SplitCamelWords<TRest, `${TCurrent}${TChar}`, TWords>
          : SplitCamelWords<TRest, `${TCurrent}${TChar}`, TWords>
      : SplitCamelWords<TRest, `${TCurrent}${TChar}`, TWords>
  : PushCurrentWord<TCurrent, TWords>;

type JoinCamelWords<TWords extends readonly string[]> = TWords extends readonly [
  infer THead extends string,
  ...infer TTail extends readonly string[]
]
  ? `${THead}${CapitalizeJoinCamelWords<TTail>}`
  : "";

type CapitalizeJoinCamelWords<TWords extends readonly string[]> = TWords extends readonly [
  infer THead extends string,
  ...infer TTail extends readonly string[]
]
  ? `${Capitalize<THead>}${CapitalizeJoinCamelWords<TTail>}`
  : "";

type CamelCase<TValue extends string> = JoinCamelWords<SplitCamelWords<TValue>>;

type Camelize<TValue> = TValue extends Primitive
  ? TValue
  : TValue extends readonly (infer TItem)[]
    ? Array<Camelize<TItem>>
    : TValue extends object
      ? {
          [TKey in keyof TValue as TKey extends string ? CamelCase<TKey> : TKey]: Camelize<
            TValue[TKey]
          >;
        }
      : TValue;

type SDKResult<
  TResult,
  THumanInLoopMode extends HumanInLoopMode | undefined
> = [THumanInLoopMode] extends ["async"]
  ? ["async"] extends [THumanInLoopMode]
    ? HumanInLoopPending
    : TResult
  : TResult;

type SDKMethod<TParamsSchema extends ObjectSchema<any>, TResult> =
  TResult extends ToolcraftStream<infer TEvent>
    ? (
        params: Camelize<Static<TParamsSchema>>,
        options?: StreamConsumerOptions
      ) => ToolcraftStream<TEvent>
    : (params: Camelize<Static<TParamsSchema>>) => Promise<TResult>;

type UnionToIntersection<TValue> = (
  TValue extends unknown ? (value: TValue) => void : never
) extends (value: infer TResult) => void
  ? TResult
  : never;

type Simplify<TValue> = { [TKey in keyof TValue]: TValue[TKey] };

type RawChildrenValue<TChildren> = TChildren extends readonly unknown[] ? TChildren[number] : never;

type SDKNodeShape<
  TNode,
  TInheritedScope extends ScopeInput,
  TInheritedHumanInLoopMode extends HumanInLoopMode | undefined
> = TNode extends {
  kind: "command";
  readonly __agentKitCommandTypeInfo: {
    name: infer TName extends string;
    params: infer TParamsSchema extends ObjectSchema<any>;
    result: infer TResult;
    ownScope: infer TOwnScope extends ScopeInput;
    ownHumanInLoopMode: infer TOwnHumanInLoopMode extends HumanInLoopModeInput;
  };
}
  ? IncludesSDK<EffectiveCommandScope<TOwnScope, TInheritedScope>> extends true
    ? {
        [TKey in CamelCase<TName>]: SDKMethod<
          TParamsSchema,
          SDKResult<
            TResult,
            EffectiveCommandHumanInLoopMode<TOwnHumanInLoopMode, TInheritedHumanInLoopMode>
          >
        >;
      }
    : EmptyRecord
  : TNode extends {
        kind: "group";
        readonly __agentKitGroupTypeInfo: {
          name: infer TName extends string;
          children: infer TChildren extends readonly unknown[];
          ownScope: infer TOwnScope extends ScopeInput;
          ownHumanInLoopMode: infer TOwnHumanInLoopMode extends HumanInLoopModeInput;
        };
      }
    ? SDKChildrenShape<
        TChildren,
        EffectiveGroupScope<TOwnScope, TInheritedScope>,
        EffectiveGroupHumanInLoopMode<TOwnHumanInLoopMode, TInheritedHumanInLoopMode>
      > extends infer TChildShape extends object
      ? keyof TChildShape extends never
        ? EmptyRecord
        : { [TKey in CamelCase<TName>]: TChildShape }
      : never
    : EmptyRecord;

type SDKChildrenShape<
  TChildren,
  TInheritedScope extends ScopeInput,
  TInheritedHumanInLoopMode extends HumanInLoopMode | undefined
> = Simplify<
  UnionToIntersection<
    SDKNodeShape<RawChildrenValue<TChildren>, TInheritedScope, TInheritedHumanInLoopMode>
  >
>;

export interface CreateSDKOptions<TServices extends object = Record<string, unknown>> {
  approvals?: boolean;
  env?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  fs?: HandlerFs;
  services?: TServices;
  casing?: "camel";
  humanInLoop?: HumanInLoopRuntimeOptions;
  apiVersion?: string;
  projectRoot?: string;
  errorReports?: ErrorReportsOption;
  logLevel?: LogLevel;
  logger?: RuntimeLoggerInput;
}

function splitWords(value: string): string[] {
  const words: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    const isSeparator = char === "-" || char === "_" || char === " " || char === ".";

    if (isSeparator) {
      if (current.length > 0) {
        words.push(current.toLowerCase());
        current = "";
      }
      continue;
    }

    const isUppercase = char !== lower && char === upper;
    const previous = value[index - 1];
    const next = value[index + 1];
    const previousIsLowercase =
      previous !== undefined &&
      previous === previous.toLowerCase() &&
      previous !== previous.toUpperCase();
    const nextIsLowercase =
      next !== undefined && next === next.toLowerCase() && next !== next.toUpperCase();

    if (isUppercase && current.length > 0 && (previousIsLowercase || nextIsLowercase)) {
      words.push(current.toLowerCase());
      current = char;
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    words.push(current.toLowerCase());
  }

  return words;
}

function formatSegment(segment: string): string {
  return splitWords(segment)
    .map((word, index) => (index === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
    .join("");
}

function unwrapOptional(schema: AnySchema): AnySchema {
  if (schema.kind === "optional") {
    return unwrapOptional(schema.inner);
  }

  return schema;
}

function isOptional(schema: AnySchema): boolean {
  return schema.kind === "optional";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatAvailableList(values: Iterable<string>): string {
  return `Available: ${[...values].sort().join(", ")}.`;
}

function formatEnumError(
  value: unknown,
  schema: Extract<AnySchema, { kind: "enum" }>,
  label: string
): string {
  const suggestionLine =
    typeof value === "string"
      ? formatEnumSuggestionLine(
          value,
          schema.values.map((candidate) => String(candidate))
        )
      : " ";
  return `Invalid value for "${label}".${suggestionLine}Expected one of: ${schema.values.map((candidate) => String(candidate)).join(", ")}, got ${describeReceived(value)}.`;
}

function formatEnumSuggestionLine(value: string, values: readonly string[]): string {
  const suggestions = suggest(value, values);
  return suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?\n` : " ";
}

function describeReceived(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "missing";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") return "object";
  if (typeof value === "string") {
    const s = value.length > 40 ? `${value.slice(0, 40)}…` : value;
    return `${JSON.stringify(s)}`;
  }
  return JSON.stringify(value);
}

function validateSchemaValue(
  schema: AnySchema,
  value: unknown,
  label: string,
  errors: ValidationError[]
): unknown {
  const unwrappedSchema = unwrapOptional(schema);

  if (value === null && unwrappedSchema.nullable === true) {
    return null;
  }

  switch (unwrappedSchema.kind) {
    case "string":
      if (typeof value !== "string") {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected a string, got ${describeReceived(value)}.`
        });
      } else {
        validateStringConstraints(unwrappedSchema, value, label, errors);
      }
      return value;

    case "number":
      if (!isValidNumberSchemaValue(value, unwrappedSchema)) {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected ${getExpectedNumberDescription(unwrappedSchema)}, got ${describeReceived(value)}.`
        });
      }
      return value;

    case "boolean":
      if (typeof value !== "boolean") {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected a boolean, got ${describeReceived(value)}.`
        });
      }
      return value;

    case "enum":
      if (!unwrappedSchema.values.includes(value as never)) {
        errors.push({ path: label, message: formatEnumError(value, unwrappedSchema, label) });
      }
      return value;

    case "array":
      if (!Array.isArray(value)) {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected an array, got ${describeReceived(value)}.`
        });
        return value;
      }
      validateArrayConstraints(unwrappedSchema, value, label, errors);
      return value.map((item, index) =>
        validateSchemaValue(unwrappedSchema.item, item, `${label}[${index}]`, errors)
      );

    case "object":
      return validateObjectSchema(unwrappedSchema, value, label, errors);

    case "json":
      return value;

    case "record": {
      if (!isPlainObject(value)) {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected an object, got ${describeReceived(value)}.`
        });
        return value;
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          validateSchemaValue(unwrappedSchema.value, item, `${label}.${key}`, errors)
        ])
      );
    }

    case "oneOf": {
      if (!isPlainObject(value)) {
        return value;
      }
      const discriminator = value[unwrappedSchema.discriminator];
      const branch =
        typeof discriminator === "string" ? unwrappedSchema.branches[discriminator] : undefined;
      if (branch === undefined) {
        return value;
      }
      const { [unwrappedSchema.discriminator]: ignoredDiscriminator, ...branchValue } = value;
      void ignoredDiscriminator;
      return {
        [unwrappedSchema.discriminator]: discriminator,
        ...validateObjectSchema(branch, branchValue, label, errors)
      };
    }

    case "union": {
      if (!isPlainObject(value)) {
        return value;
      }
      const branch = unwrappedSchema.branches.find((candidate) =>
        Object.keys(candidate.shape).every(
          (key) =>
            candidate.shape[key]?.kind === "optional" ||
            Object.prototype.hasOwnProperty.call(value, formatSegment(key))
        )
      );
      return branch === undefined ? value : validateObjectSchema(branch, value, label, errors);
    }
  }
}

function validateStringConstraints(
  schema: Extract<AnySchema, { kind: "string" }>,
  value: string,
  label: string,
  errors: ValidationError[]
): void {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected a string with length at least ${schema.minLength}, got string with length ${value.length}.`
    });
  }

  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected a string with length at most ${schema.maxLength}, got string with length ${value.length}.`
    });
  }

  if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}": "${value}" does not match pattern "${schema.pattern}".`
    });
  }
}

function validateArrayConstraints(
  schema: Extract<AnySchema, { kind: "array" }>,
  value: unknown[],
  label: string,
  errors: ValidationError[]
): void {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected an array with at least ${schema.minItems} items, got array(${value.length}).`
    });
  }

  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected an array with at most ${schema.maxItems} items, got array(${value.length}).`
    });
  }
}

export function validateObjectSchema(
  schema: ObjectSchema<any>,
  value: unknown,
  label: string,
  errors: ValidationError[]
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected an object, got ${describeReceived(value)}.`
    });
    return {};
  }

  const result: Record<string, unknown> = {};
  const expectedKeys = new Map<string, [string, AnySchema]>();

  for (const [key, childSchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    expectedKeys.set(formatSegment(key), [key, childSchema]);
  }

  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      if (schema.additionalProperties === true) {
        Object.defineProperty(result, key, {
          value: value[key],
          enumerable: true,
          configurable: true,
          writable: true
        });
        continue;
      }
      const fieldLabel = label.length === 0 ? key : `${label}.${key}`;
      errors.push({
        path: fieldLabel,
        message: `Unexpected parameter "${fieldLabel}". ${formatAvailableList(
          [...expectedKeys.keys()].map((expectedKey) =>
            label.length === 0 ? expectedKey : `${label}.${expectedKey}`
          )
        )}`
      });
    }
  }

  for (const [inputKey, [outputKey, rawChildSchema]] of expectedKeys.entries()) {
    const childSchema = unwrapOptional(rawChildSchema);
    const hasValue = Object.prototype.hasOwnProperty.call(value, inputKey);
    const fieldLabel = label.length === 0 ? inputKey : `${label}.${inputKey}`;

    if (!hasValue) {
      if (childSchema.default !== undefined) {
        Object.defineProperty(result, outputKey, {
          value: childSchema.default,
          enumerable: true,
          configurable: true,
          writable: true
        });
        continue;
      }

      if (isOptional(rawChildSchema)) {
        continue;
      }

      errors.push({ path: fieldLabel, message: `Missing required parameter "${fieldLabel}".` });
      continue;
    }

    Object.defineProperty(result, outputKey, {
      value: validateSchemaValue(rawChildSchema, value[inputKey], fieldLabel, errors),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }

  return result;
}

function validateUniqueSDKParameterMembers(schema: ObjectSchema<any>): void {
  const sourceKeysByMember = new Map<string, string>();

  for (const [key, rawChildSchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    const member = formatSegment(key);
    const existingKey = sourceKeysByMember.get(member);

    if (existingKey !== undefined) {
      throw new UserError(
        `Parameters "${existingKey}" and "${key}" use conflicting SDK member "${member}".`
      );
    }

    sourceKeysByMember.set(member, key);

    const childSchema = unwrapOptional(rawChildSchema);
    if (childSchema.kind === "object") {
      validateUniqueSDKParameterMembers(childSchema);
    }
  }
}

function validateSDKArguments(
  schema: ObjectSchema<any>,
  argumentsValue: Record<string, unknown> | undefined
): Record<string, unknown> {
  const errors: ValidationError[] = [];
  const result = validateObjectSchema(schema, argumentsValue ?? {}, "", errors);
  throwValidationErrors(errors);
  return result;
}

function defineMember(target: Record<string, unknown>, key: string, value: unknown): void {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    throw new Error(`Duplicate SDK member "${key}".`);
  }

  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: false,
    writable: false
  });
}

type SDKRootShape<TRoot> = TRoot extends {
  readonly __agentKitGroupTypeInfo: {
    children: infer TChildren extends readonly unknown[];
  };
}
  ? SDKChildrenShape<TChildren, undefined, undefined>
  : Record<string, unknown>;

export function createSDK<
  TRoot extends Group<any>,
  TServices extends object = Record<string, unknown>
>(
  root: TRoot,
  options?: CreateSDKOptions<TServices>
): SDKRootShape<TRoot>;
export function createSDK(
  root: Group<any>,
  options: CreateSDKOptions<any> = {}
): Record<string, unknown> {
  enableSourceMaps();
  const mergedRoot = options.approvals === true ? mergeApprovalsGroup(root) : root;

  if (!hasMcpProxyGroups(mergedRoot)) {
    return createResolvedSDK(mergedRoot, options);
  }

  return createDeferredSDK(mergedRoot, options);
}

function createResolvedSDK(
  root: Group<any>,
  options: CreateSDKOptions<any> = {}
): Record<string, unknown> {
  const services = options.services ?? {};
  const runtimeOptions = options.humanInLoop ?? {};
  const runtimeFetch = options.fetch ?? globalThis.fetch;
  const diagnostics = createRuntimeLogger({
    level: options.logLevel,
    logger: options.logger
  });
  void options.casing;
  validateServices(services as Record<string, unknown>);

  function build(node: Group<any> | Command<any, any, any, any>, path: string[]): unknown {
    if (node.kind === "command") {
      const sdkParamsSchema = filterSchemaForScope(node.params, "sdk");
      if (sdkParamsSchema?.kind === "object") {
        validateUniqueSDKParameterMembers(sdkParamsSchema);
      }

      if (node.stream !== undefined) {
        return (
          params: Record<string, unknown> | undefined,
          streamOptions: StreamConsumerOptions = {}
        ) =>
          createManagedStream({
            eventSchema: node.stream!.event,
            ...streamOptions,
            async create(signal, status) {
              const commandPath = [...path, node.name].join(".");
              let secrets: Record<string, string | undefined> | undefined;
              let validatedParams: unknown;
              try {
                secrets = resolveCommandSecrets(node, options.env);
                const baseContext = {
                  ...services,
                  runtimeOptions,
                  root,
                  secrets,
                  fetch: runtimeFetch,
                  fs: createFs(options.fs),
                  env: createEnv(options.env),
                  diagnostics,
                  progress(message: string): void {
                    diagnostics.emit({ level: "info", message, category: "progress" });
                  }
                };
                await assertCommandRequirements(
                  node,
                  { ...baseContext, params: undefined },
                  { apiVersion: options.apiVersion, env: options.env }
                );
                const paramsSchema = filterSchemaForScope(node.params, "sdk");
                if (paramsSchema === undefined || paramsSchema.kind !== "object") {
                  throw new ToolcraftBugError(
                    `command "${node.name}" must define an object params schema for SDK.`
                  );
                }
                validatedParams = validateSDKArguments(paramsSchema, params);
                return await node.handler({
                  ...baseContext,
                  params: validatedParams,
                  signal,
                  status,
                  async refreshSecrets() {
                    return resolveCommandSecrets(node, options.env);
                  }
                } as never);
              } catch (error) {
                await writeErrorReport({
                  command: node,
                  commandPath,
                  env: process.env,
                  error,
                  errorReports: options.errorReports,
                  params: validatedParams,
                  projectRoot: options.projectRoot,
                  secrets
                });
                throw error;
              }
            }
          });
      }

      return async (params: Record<string, unknown> | undefined) => {
        const commandPath = [...path, node.name].join(".");
        let secrets: Record<string, string | undefined> | undefined;
        let validatedParams: unknown;

        try {
          secrets = resolveCommandSecrets(node, options.env);
          const baseContext = {
            ...services,
            runtimeOptions,
            root,
            secrets,
            fetch: runtimeFetch,
            fs: createFs(options.fs),
            env: createEnv(options.env),
            diagnostics,
            progress(message: string): void {
              diagnostics.emit({ level: "info", message, category: "progress" });
            }
          };

          await assertCommandRequirements(
            node,
            { ...baseContext, params: undefined },
            {
              apiVersion: options.apiVersion,
              env: options.env
            }
          );

          const paramsSchema = filterSchemaForScope(node.params, "sdk");

          if (paramsSchema === undefined || paramsSchema.kind !== "object") {
            throw new ToolcraftBugError(
              `command "${node.name}" must define an object params schema for SDK.`
            );
          }

          validatedParams = validateSDKArguments(paramsSchema, params);
          return await invokeWithHumanInLoop(
            node,
            {
              ...baseContext,
              params: validatedParams
            } as Parameters<typeof node.handler>[0],
            runtimeOptions,
            commandPath
          );
        } catch (error) {
          await writeErrorReport({
            command: node,
            commandPath,
            env: process.env,
            error,
            errorReports: options.errorReports,
            params: validatedParams,
            projectRoot: options.projectRoot,
            secrets
          });
          throw error;
        }
      };
    }

    const output: Record<string, unknown> = {};
    const sourceNamesByMember = new Map<string, string>();
    const nextPath = node === root ? path : [...path, node.name];

    for (const child of node.children) {
      let childValue: unknown;

      if (child.kind === "command") {
        if (!child.scope.includes("sdk")) {
          continue;
        }
        childValue = build(child, nextPath);
      } else {
        childValue = build(child, nextPath);
        if (!isPlainObject(childValue) || Object.keys(childValue).length === 0) {
          continue;
        }
      }

      const member = formatSegment(child.name);
      if (member === "then") {
        throw new UserError(`SDK member "${child.name}" uses reserved member "then".`);
      }

      const existingName = sourceNamesByMember.get(member);
      if (existingName !== undefined) {
        throw new UserError(
          `SDK members "${existingName}" and "${child.name}" use conflicting member "${member}".`
        );
      }

      sourceNamesByMember.set(member, child.name);
      defineMember(output, member, childValue);
    }

    return output;
  }

  return build(root, []) as Record<string, unknown>;
}

function createDeferredSDK(
  root: Group<any>,
  options: CreateSDKOptions<any>
): Record<string, unknown> {
  let sdkPromise: Promise<Record<string, unknown>> | undefined;

  const resolveSDK = (): Promise<Record<string, unknown>> => {
    sdkPromise ??= (async () => {
      await resolveMcpProxies(root, { projectRoot: options.projectRoot });
      return createResolvedSDK(root, options);
    })();

    return sdkPromise;
  };

  const resolvePath = async (path: PropertyKey[]): Promise<unknown> => {
    let current: unknown = await resolveSDK();

    for (const segment of path) {
      if (typeof segment !== "string" && typeof segment !== "number") {
        return undefined;
      }

      current = (current as Record<string | number, unknown>)[segment];
    }

    return current;
  };

  const createPathProxy = (path: PropertyKey[]): unknown =>
    new Proxy(() => undefined, {
      apply(_target, _thisArg, argumentsList) {
        return resolvePath(path).then((value) => {
          if (typeof value !== "function") {
            throw new TypeError(`SDK member "${path.map(String).join(".")}" is not callable.`);
          }

          return value(...argumentsList);
        });
      },
      get(_target, property) {
        if (property === "then") {
          return path.length === 0 ? resolveSDK().then.bind(resolveSDK()) : undefined;
        }

        return createPathProxy([...path, property]);
      }
    });

  return createPathProxy([]) as Record<string, unknown>;
}
