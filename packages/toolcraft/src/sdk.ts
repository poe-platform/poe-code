import { access, readFile, writeFile } from "node:fs/promises";
import type { AnySchema, ObjectSchema, Static } from "toolcraft-schema";
import type { Command, Group, HandlerEnv, HandlerFs, Scope } from "./index.js";
import { UserError, assertCommandRequirements, resolveCommandSecrets } from "./index.js";
import { mergeApprovalsGroup } from "./human-in-loop/approvals-commands.js";
import { invokeWithHumanInLoop } from "./human-in-loop/index.js";
import type { HumanInLoopPending, HumanInLoopRuntimeOptions } from "./human-in-loop/index.js";
import { hasMcpProxyGroups, resolveMcpProxies } from "./mcp-proxy.js";
import { getExpectedNumberDescription, isValidNumberSchemaValue } from "./number-schema.js";
import { filterSchemaForScope } from "./schema-scope.js";

const RESERVED_SERVICE_NAMES = new Set(["params", "secrets", "fetch", "fs", "env", "progress"]);

type ScopeInput = readonly Scope[] | undefined;
type HumanInLoopMode = "sync" | "async";
type HumanInLoopModeInput = HumanInLoopMode | null | undefined;
type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type EmptyRecord = Record<never, never>;

type EffectiveCommandScope<
  TOwnScope extends ScopeInput,
  TInheritedScope extends ScopeInput,
> = TOwnScope extends readonly Scope[]
  ? TOwnScope
  : TInheritedScope extends readonly Scope[]
    ? TInheritedScope
    : readonly ["cli", "sdk"];

type EffectiveGroupScope<
  TOwnScope extends ScopeInput,
  TInheritedScope extends ScopeInput,
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
  TInheritedHumanInLoopMode extends HumanInLoopMode | undefined,
> = TOwnHumanInLoopMode extends HumanInLoopMode
  ? TOwnHumanInLoopMode
  : TOwnHumanInLoopMode extends null
    ? undefined
    : TInheritedHumanInLoopMode;

type EffectiveGroupHumanInLoopMode<
  TOwnHumanInLoopMode extends HumanInLoopModeInput,
  TInheritedHumanInLoopMode extends HumanInLoopMode | undefined,
> = TOwnHumanInLoopMode extends HumanInLoopMode
  ? TOwnHumanInLoopMode
  : TOwnHumanInLoopMode extends null
    ? undefined
    : TInheritedHumanInLoopMode;

type Separator = "-" | "_" | " " | ".";

type IsUppercase<TValue extends string> = TValue extends Uppercase<TValue>
  ? TValue extends Lowercase<TValue>
    ? false
    : true
  : false;

type IsLowercase<TValue extends string> = TValue extends Lowercase<TValue>
  ? TValue extends Uppercase<TValue>
    ? false
    : true
  : false;

type LastCharacter<TValue extends string> = TValue extends `${infer THead}${infer TTail}`
  ? TTail extends ""
    ? THead
    : LastCharacter<TTail>
  : never;

type PushCurrentWord<
  TCurrent extends string,
  TWords extends readonly string[],
> = TCurrent extends "" ? TWords : [...TWords, Lowercase<TCurrent>];

type SplitCamelWords<
  TValue extends string,
  TCurrent extends string = "",
  TWords extends readonly string[] = [],
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
  ...infer TTail extends readonly string[],
]
  ? `${THead}${CapitalizeJoinCamelWords<TTail>}`
  : "";

type CapitalizeJoinCamelWords<TWords extends readonly string[]> = TWords extends readonly [
  infer THead extends string,
  ...infer TTail extends readonly string[],
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
          [TKey in keyof TValue as TKey extends string ? CamelCase<TKey> : TKey]: Camelize<TValue[TKey]>;
        }
      : TValue;

type SDKResult<TResult, THumanInLoopMode extends HumanInLoopMode | undefined> = THumanInLoopMode extends "async"
  ? HumanInLoopPending
  : TResult;

type SDKMethod<TParamsSchema extends ObjectSchema<any>, TResult> = (
  params: Camelize<Static<TParamsSchema>>
) => Promise<TResult>;

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
  TInheritedHumanInLoopMode extends HumanInLoopMode | undefined,
> =
  TNode extends {
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
            SDKResult<TResult, EffectiveCommandHumanInLoopMode<TOwnHumanInLoopMode, TInheritedHumanInLoopMode>>
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
  TInheritedHumanInLoopMode extends HumanInLoopMode | undefined,
> = Simplify<
  UnionToIntersection<SDKNodeShape<RawChildrenValue<TChildren>, TInheritedScope, TInheritedHumanInLoopMode>>
>;

export interface CreateSDKOptions<TServices extends object = Record<string, unknown>> {
  services?: TServices;
  casing?: "camel";
  humanInLoop?: HumanInLoopRuntimeOptions;
  projectRoot?: string;
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
      previous !== undefined && previous === previous.toLowerCase() && previous !== previous.toUpperCase();
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

function createFs(): HandlerFs {
  return {
    readFile: async (path: string, encoding = "utf8") => readFile(path, { encoding }),
    writeFile: async (path: string, contents: string) => {
      await writeFile(path, contents);
    },
    exists: async (path: string) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function createEnv(values: Record<string, string | undefined> = process.env): HandlerEnv {
  return {
    get(key: string): string | undefined {
      return values[key];
    },
  };
}

function validateServices(services: Record<string, unknown>): void {
  for (const name of Object.keys(services)) {
    if (RESERVED_SERVICE_NAMES.has(name)) {
      throw new Error(`Service name "${name}" is reserved. Choose a different name.`);
    }
  }
}

function validateEnum(value: unknown, schema: Extract<AnySchema, { kind: "enum" }>, label: string): string | number | boolean {
  if (!schema.values.includes(value as never)) {
    throw new UserError(
      `Invalid value for "${label}". Expected one of: ${schema.values.map((candidate) => String(candidate)).join(", ")}.`
    );
  }

  return value as string | number | boolean;
}

function validateSchemaValue(schema: AnySchema, value: unknown, label: string): unknown {
  const unwrappedSchema = unwrapOptional(schema);

  if (value === null && unwrappedSchema.nullable === true) {
    return null;
  }

  switch (unwrappedSchema.kind) {
    case "string":
      if (typeof value !== "string") {
        throw new UserError(`Invalid value for "${label}". Expected a string.`);
      }
      return value;

    case "number":
      if (!isValidNumberSchemaValue(value, unwrappedSchema)) {
        throw new UserError(
          `Invalid value for "${label}". Expected ${getExpectedNumberDescription(unwrappedSchema)}.`
        );
      }
      return value;

    case "boolean":
      if (typeof value !== "boolean") {
        throw new UserError(`Invalid value for "${label}". Expected a boolean.`);
      }
      return value;

    case "enum":
      return validateEnum(value, unwrappedSchema, label);

    case "array":
      if (!Array.isArray(value)) {
        throw new UserError(`Invalid value for "${label}". Expected an array.`);
      }
      return value.map((item, index) => validateSchemaValue(unwrappedSchema.item, item, `${label}[${index}]`));

    case "object":
      return validateObjectSchema(unwrappedSchema, value, label);
  }
}

function validateObjectSchema(
  schema: ObjectSchema<any>,
  value: unknown,
  label: string
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new UserError(`Invalid value for "${label}". Expected an object.`);
  }

  const result: Record<string, unknown> = {};
  const expectedKeys = new Map<string, [string, AnySchema]>();

  for (const [key, childSchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    expectedKeys.set(formatSegment(key), [key, childSchema]);
  }

  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      const fieldLabel = label.length === 0 ? key : `${label}.${key}`;
      throw new UserError(`Unexpected parameter "${fieldLabel}".`);
    }
  }

  for (const [inputKey, [outputKey, rawChildSchema]] of expectedKeys.entries()) {
    const childSchema = unwrapOptional(rawChildSchema);
    const hasValue = Object.prototype.hasOwnProperty.call(value, inputKey);
    const fieldLabel = label.length === 0 ? inputKey : `${label}.${inputKey}`;

    if (!hasValue) {
      if (childSchema.default !== undefined) {
        result[outputKey] = childSchema.default;
        continue;
      }

      if (isOptional(rawChildSchema)) {
        continue;
      }

      throw new UserError(`Missing required parameter "${fieldLabel}".`);
    }

    result[outputKey] = validateSchemaValue(rawChildSchema, value[inputKey], fieldLabel);
  }

  return result;
}

function validateSDKArguments(
  schema: ObjectSchema<any>,
  argumentsValue: Record<string, unknown> | undefined
): Record<string, unknown> {
  return validateObjectSchema(schema, argumentsValue ?? {}, "");
}

function defineMember(target: Record<string, unknown>, key: string, value: unknown): void {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    throw new Error(`Duplicate SDK member "${key}".`);
  }

  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: false,
    writable: false,
  });
}

export function createSDK<
  TRootInfo,
  TServices extends object = Record<string, unknown>,
>(
  root: Group<any> & {
    readonly __agentKitGroupTypeInfo: TRootInfo;
  },
  options?: CreateSDKOptions<TServices>
): TRootInfo extends { children: infer TChildren extends readonly unknown[] }
  ? SDKChildrenShape<TChildren, undefined, undefined>
  : EmptyRecord;
export function createSDK(
  root: Group<any>,
  options: CreateSDKOptions<any> = {}
): Record<string, unknown> {
  const mergedRoot = mergeApprovalsGroup(root);

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
  void options.casing;
  validateServices(services as Record<string, unknown>);

  function build(node: Group<any> | Command<any, any, any, any>, path: string[]): unknown {
    if (node.kind === "command") {
      return async (params: Record<string, unknown> | undefined) => {
        const secrets = resolveCommandSecrets(node);
        const baseContext = {
          ...services,
          runtimeOptions,
          root,
          secrets,
          fetch: globalThis.fetch,
          fs: createFs(),
          env: createEnv(),
          progress(): void {
            return undefined;
          },
        };

        await assertCommandRequirements(node, { ...baseContext, params: undefined });

        const paramsSchema = filterSchemaForScope(node.params, "sdk");

        if (paramsSchema === undefined || paramsSchema.kind !== "object") {
          throw new Error(`Bug: command "${node.name}" must define an object params schema for SDK.`);
        }

        const validatedParams = validateSDKArguments(paramsSchema, params);
        return invokeWithHumanInLoop(
          node,
          {
            ...baseContext,
            params: validatedParams,
          } as Parameters<typeof node.handler>[0],
          runtimeOptions,
          [...path, node.name].join(".")
        );
      };
    }

    const output: Record<string, unknown> = {};
    const nextPath = node === root ? path : [...path, node.name];

    for (const child of node.children) {
      if (child.kind === "command") {
        if (!child.scope.includes("sdk")) {
          continue;
        }

        defineMember(output, formatSegment(child.name), build(child, nextPath));
        continue;
      }

      const childValue = build(child, nextPath);
      if (isPlainObject(childValue) && Object.keys(childValue).length > 0) {
        defineMember(output, formatSegment(child.name), childValue);
      }
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
      },
    });

  return createPathProxy([]) as Record<string, unknown>;
}
